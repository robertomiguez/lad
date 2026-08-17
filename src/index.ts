import { canAccessStore, claimsFrom, forbidden, issueSession, requireRole, unauthorized, type Claims } from "./auth";
import { hello } from "./routes/hello";
import { ReportWorkflow } from "./durable-objects/report-workflow";
import { logError, logTransition, RETRY_LIMITS } from "./lib/observability";

export interface Env { DB: D1Database; IDEMPOTENCY: KVNamespace; PHOTOS: R2Bucket; ERP_WRITE_QUEUE: Queue; REPORT_DO: DurableObjectNamespace; JWT_SECRET: string; ENVIRONMENT: string; AUTO_APPROVE_BELOW_REGIONAL?: string; ESCALATION_DEMO_DELAY_SECONDS?: string; ERP_SIMULATED_DELAY_MS?: string; ERP_FAILURE_RATE?: string; ERP_MAX_RETRIES?: string; }
type DbUser = { id: string; name: string; role: Claims["role"]; store_id: string | null };
type Product = { id: string; sku: string; name: string };
type Report = { id: string; status: string; total_amount: number; created_at: string };
type Submission = { id: string; storeId: string; reporterId: string; reportDate: string; totalAmountCents: number; items: { id: string; productId: string; quantity: number; reasonCode: string; photoId?: string }[] };
const html = (body: string, status = 200, headers: HeadersInit = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const withCorrelation = (response: Response, correlationId: string) => { const headers = new Headers(response.headers); headers.set("X-Correlation-Id", correlationId); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const protectedClaims = (request: Request, env: Env) => claimsFrom(request, env);
const reportWorkflow = (env: Env, id: string) => env.REPORT_DO.get(env.REPORT_DO.idFromName(id));
async function initializeWorkflow(env: Env, submission: Submission, correlationId: string) {
  return reportWorkflow(env, submission.id).fetch("https://report-workflow/initialize", { method: "POST", headers: { "X-Correlation-Id": correlationId }, body: JSON.stringify({ reportId: submission.id, storeId: submission.storeId, totalAmountCents: submission.totalAmountCents }) });
}

async function loginPage(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, name, role FROM users ORDER BY CASE role WHEN 'store' THEN 1 WHEN 'regional_manager' THEN 2 WHEN 'quality' THEN 3 ELSE 4 END, name").all<Pick<DbUser, "id" | "name" | "role">>();
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting POC</title><link rel="stylesheet" href="/styles.css"><main class="login-shell"><section class="login-aside"><div class="brand"><span class="brand-mark">DR</span>Digital Damage Reporting</div><div><p class="eyebrow" style="color:#9fddff">Operational POC</p><h1>Make every damaged item visible.</h1><p>Capture a report anywhere, route it to the right approver, and keep the store informed from first photo to completed credit note.</p></div></section><section class="login-content"><div class="card login-card"><p class="eyebrow">Start a demo session</p><h2>Choose a role</h2><p class="muted">Authentication is deliberately simplified for this proof of concept.</p><form method="post" action="/api/login"><label>Seeded user <select name="username">${results.map(u => `<option value="${escape(u.id)}">${escape(u.name)} (${escape(u.role.replaceAll("_", " "))})</option>`).join("")}</select></label><button>Continue to workspace</button></form></div></section></main></html>`);
}
async function login(request: Request, env: Env) {
  const jsonRequest = request.headers.get("content-type")?.includes("application/json");
  const username = jsonRequest ? (await request.json() as { username?: string }).username : String((await request.formData()).get("username") ?? "");
  if (!username) return Response.json({ error: "username is required" }, { status: 400 });
  const user = await env.DB.prepare("SELECT id, name, role, store_id FROM users WHERE id = ?").bind(username).first<DbUser>();
  if (!user) return Response.json({ error: "Unknown seeded user" }, { status: 401 });
  const token = await issueSession({ user_id: user.id, role: user.role, store_id: user.store_id }, env.JWT_SECRET);
  const headers = { "set-cookie": `damage_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` };
  const destination = user.role === "store" ? "/app" : "/approvals";
  return jsonRequest ? Response.json({ token, user }, { headers }) : new Response(null, { status: 303, headers: { ...headers, location: destination } });
}
async function products(env: Env) { return (await env.DB.prepare("SELECT id, sku, name FROM products ORDER BY sku").all<Product>()).results; }
const productOptions = (products: Product[]) => products.map(product => `<option value="${escape(product.id)}" data-sku="${escape(product.sku)}">${escape(product.sku)} — ${escape(product.name)}</option>`).join("");
async function lineItemRow(env: Env) {
  const options = productOptions(await products(env));
  return html(lineItemMarkup(options));
}
const lineItemMarkup = (options: string) => `<fieldset class="line-item"><input type="hidden" name="line_item_id" data-line-id><label>Barcode / SKU <input name="barcode" data-barcode-input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type SKU"><span class="barcode-result" data-barcode-result aria-live="polite"></span></label><label>Product <select name="product_id" required><option value="">Choose product</option>${options}</select></label><label>Quantity <input name="quantity" type="number" min="1" step="1" required></label><label>Reason <select name="reason_code" required><option value="">Choose reason</option><option value="damaged">Damaged</option><option value="incorrect_delivery">Incorrect delivery</option><option value="expired">Expired</option></select></label><label>Photo <input name="photo" type="file" accept="image/*"></label><button type="button" class="remove-line">Remove</button></fieldset>`;
async function appPage(env: Env, claims: Claims) {
  if (claims.role !== "store") return new Response(null, { status: 303, headers: { location: "/approvals" } });
  const user = await env.DB.prepare("SELECT u.name, s.name AS store_name FROM users u JOIN stores s ON s.id = u.store_id WHERE u.id = ?").bind(claims.user_id).first<{ name: string; store_name: string }>();
  const options = productOptions(await products(env));
  const item = lineItemMarkup(options);
  // The capture shell is complete in the document so a cached /app can create a
  // report after a fresh offline reload. htmx remains in use for online approval UI.
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New damage report</title><link rel="stylesheet" href="/styles.css"><script defer src="/app.js"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Store workspace · <strong>${escape(user?.store_name ?? claims.store_id ?? "")}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">New claim</p><h1>Report damaged goods</h1><p class="lede">Saved to this device first, then synchronized safely when a connection is available.</p></div></div><div class="capture-grid"><section class="card form-card"><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><div class="form-grid"><label>Date <input name="report_date" type="date" required></label><label>Total amount (CHF) <input name="total_amount" type="number" min="0" step="0.01" required></label></div><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="form-actions"><button type="button" id="add-line-item" class="button-secondary">Add another item</button><button type="submit">Save report</button></div><div id="form-feedback" class="form-feedback" aria-live="polite"></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos upload independently.</p></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main></html>`);
}
async function myReports(env: Env, claims: Claims) {
  const { results } = await env.DB.prepare("SELECT id, status, total_amount, created_at FROM reports WHERE store_id = ? ORDER BY created_at DESC").bind(claims.store_id).all<Report>();
  return html(results.length ? results.map(r => `<article class="report"><strong>${escape(r.id)}</strong> · ${escape(storeStatus(r.status))} · CHF ${(r.total_amount / 100).toFixed(2)}<br><small>${escape(r.created_at)}</small></article>`).join("") : "<p class=\"empty-state\">No reports submitted yet.</p>");
}
const storeStatus = (status: string) => ({ pending_sync: "Pending Sync", submitted: "With Regional Manager", pending_regional: "With Regional Manager", pending_quality: "With Quality Management", approved: "Credit Note Processing", credit_note_processing: "Credit Note Processing", completed: "Completed", rejected: "Rejected", sync_error: "Needs attention — retrying", erp_error: "Needs attention — retrying" })[status] ?? "Updating status";
async function reportStatuses(env: Env, claims: Claims) {
  if (!requireRole(claims, ["store"])) return forbidden();
  const { results } = await env.DB.prepare("SELECT id, status, total_amount, created_at, escalated_at, escalation_target_role, rejection_reason FROM reports WHERE store_id = ? ORDER BY updated_at DESC").bind(claims.store_id).all<{ id: string; status: string; total_amount: number; created_at: string; escalated_at: string | null; escalation_target_role: string | null; rejection_reason: string | null }>();
  return Response.json(results.map(report => ({ id: report.id, status: report.status, totalAmountCents: report.total_amount, createdAt: report.created_at, escalatedAt: report.escalated_at, escalationTargetRole: report.escalation_target_role, rejectionReason: report.rejection_reason })));
}
async function approvalsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, ["regional_manager", "quality"])) return forbidden();
  const query = claims.role === "regional_manager"
    ? env.DB.prepare("SELECT id, store_id, status, total_amount, escalated_at, escalation_target_role FROM reports WHERE store_id = ? AND status = 'pending_regional' ORDER BY updated_at ASC").bind(claims.store_id)
    : env.DB.prepare("SELECT id, store_id, status, total_amount, escalated_at, escalation_target_role FROM reports WHERE status = 'pending_quality' ORDER BY updated_at ASC");
  const { results } = await query.all<{ id: string; store_id: string; status: string; total_amount: number; escalated_at: string | null; escalation_target_role: string | null }>();
  return html(results.length ? `<div class="worklist">${results.map(report => `<article class="approval-card"><div class="approval-meta"><span class="report-id">${escape(report.id)}</span><span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span>${report.escalated_at ? `<mark>Escalated to ${escape(report.escalation_target_role ?? "fallback role")}</mark>` : ""}</div><div class="approval-actions"><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><input type="hidden" name="decision" value="approve"><button>Approve</button></form><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><label><span class="visually-hidden">Rejection reason</span><input name="reason" placeholder="Rejection reason" required></label><input type="hidden" name="decision" value="reject"><button>Reject</button></form></div></article>`).join("")}</div>` : "<p class=\"empty-state\">No approval work currently assigned.</p>");
}
function approvalsPage(claims: Claims) {
  if (!requireRole(claims, ["regional_manager", "quality"])) return forbidden();
  const roleLabel = claims.role === "regional_manager" ? "Regional Manager" : "Quality Management";
  const operationsLink = claims.role === "quality" ? `<a class="button button-secondary" href="/ops">Operations</a>` : "";
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approval worklist</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Signed in as <strong>${escape(roleLabel)}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">Approval queue</p><h1>Approval worklist</h1><p class="lede">Review reports assigned to your role. This list refreshes automatically every 15 seconds.</p></div><div class="header-actions">${operationsLink}</div></div><section class="card"><div id="approval-worklist" hx-get="/fragments/approvals" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`);
}
async function opsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, ["quality"])) return forbidden();
  const { results } = await env.DB.prepare("SELECT r.id, r.status, r.validation_error_code, r.escalated_at, r.escalation_target_role, c.status AS credit_note_status FROM reports r LEFT JOIN credit_notes c ON c.report_id = r.id WHERE r.status IN ('sync_error', 'erp_error') OR (r.status = 'credit_note_processing' AND c.status = 'pending') OR (r.escalated_at IS NOT NULL AND r.status IN ('pending_regional', 'pending_quality')) ORDER BY r.updated_at ASC").all<{ id: string; status: string; validation_error_code: string | null; escalated_at: string | null; escalation_target_role: string | null; credit_note_status: string | null }>();
  return html(results.length ? `<div class="ops-list">${results.map(report => `<article class="ops-card"><strong>${escape(report.id)}</strong><span>${escape(report.status)}${report.validation_error_code ? ` · ${escape(report.validation_error_code)}` : ""}${report.escalated_at ? ` · overdue; escalation role: ${escape(report.escalation_target_role ?? "unassigned")}` : ""}${report.credit_note_status ? ` · credit note: ${escape(report.credit_note_status)}` : ""}</span></article>`).join("")}</div>` : "<p class=\"empty-state\">No stuck reports.</p>");
}
function opsPage(claims: Claims) {
  if (!requireRole(claims, ["quality"])) return forbidden();
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting operations</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Quality operations</span></header><main class="page"><div class="page-header"><div><p class="eyebrow">Operations</p><h1>Reports needing attention</h1><p class="lede">Validation/sync errors, pending or failed ERP writes, and overdue approvals.</p></div><div class="header-actions"><a class="button button-secondary" href="/approvals">Approval worklist</a></div></div><section class="card"><div hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`);
}
async function submissionFrom(request: Request): Promise<Submission | null> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const input = await request.json() as Partial<Submission>;
    return Array.isArray(input.items) ? input as Submission : null;
  }
  const form = await request.formData();
  const productIds = form.getAll("product_id").map(String), quantities = form.getAll("quantity").map(String), reasons = form.getAll("reason_code").map(String), lineIds = form.getAll("line_item_id").map(String);
  return { id: String(form.get("report_id") ?? ""), storeId: String(form.get("store_id") ?? ""), reporterId: String(form.get("reporter_id") ?? ""), reportDate: String(form.get("report_date") ?? ""), totalAmountCents: Math.round(Number(form.get("total_amount")) * 100), items: productIds.map((productId, index) => ({ id: lineIds[index], productId, quantity: Number(quantities[index]), reasonCode: reasons[index] })) };
}
const reportJson = (report: { id: string; status: string; total_amount: number; validation_error_code?: string | null }, status = 200) => Response.json({ id: report.id, status: report.status, totalAmountCents: report.total_amount, errorCode: report.validation_error_code ?? undefined }, { status });
async function existingReport(env: Env, claims: Claims, id: string) {
  const report = await env.DB.prepare("SELECT id, store_id, status, total_amount, validation_error_code FROM reports WHERE id = ?").bind(id).first<{ id: string; store_id: string; status: string; total_amount: number; validation_error_code: string | null }>();
  if (!report) return null;
  return report.store_id === claims.store_id ? report : "forbidden" as const;
}
async function validationError(env: Env, submission: Submission) {
  const allowedReasons = new Set(["damaged", "incorrect_delivery", "expired"]);
  if (submission.items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1)) return "invalid_quantity";
  if (submission.items.some(item => !allowedReasons.has(item.reasonCode))) return "invalid_reason_code";
  const store = await env.DB.prepare("SELECT id FROM stores WHERE id = ?").bind(submission.storeId).first();
  if (!store) return "store_not_found";
  for (const item of submission.items) {
    const product = await env.DB.prepare("SELECT active FROM products WHERE id = ?").bind(item.productId).first<{ active: number }>();
    if (!product) return "product_not_found";
    if (product.active !== 1) return "product_inactive";
  }
  return null;
}
async function createReport(request: Request, env: Env, claims: Claims, correlationId: string) {
  if (!requireRole(claims, ["store"])) return forbidden();
  const jsonRequest = request.headers.get("content-type")?.includes("application/json") ?? false;
  let submission: Submission | null;
  try { submission = await submissionFrom(request); } catch { submission = null; }
  if (!submission) return jsonRequest ? Response.json({ error: "Invalid report payload" }, { status: 422 }) : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422);
  const { id: reportId, storeId, reporterId, reportDate, totalAmountCents, items } = submission;
  const validId = (value: string) => /^[a-zA-Z0-9-]{8,80}$/.test(value);
  const invalid = !validId(reportId) || request.headers.get("Idempotency-Key") && request.headers.get("Idempotency-Key") !== reportId || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || storeId !== claims.store_id || reporterId !== claims.user_id || !Number.isInteger(totalAmountCents) || totalAmountCents < 0 || items.length < 1 || items.some(item => !validId(item.id) || !item.productId || !item.reasonCode || !Number.isInteger(item.quantity) || item.quantity < 1 || (item.photoId !== undefined && !validId(item.photoId)));
  if (invalid) { logError(correlationId, "worker", "invalid_payload", reportId); return jsonRequest ? Response.json({ errorCode: "invalid_payload" }, { status: 422 }) : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422); }
  const kvHit = await env.IDEMPOTENCY.get(`report:${reportId}`);
  const existing = kvHit ? await existingReport(env, claims, reportId) : await env.DB.prepare("SELECT key FROM idempotency_keys WHERE key = ?").bind(reportId).first() ? await existingReport(env, claims, reportId) : null;
  if (existing === "forbidden") return forbidden();
  // A response can be lost after D1 commits but before the Durable Object has
  // initialized. Replaying the same idempotency key is therefore also the safe
  // recovery path for the workflow; initialize itself is idempotent.
  if (existing && existing.status !== "sync_error") {
    if (existing.status === "submitted") {
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
    }
    const recovered = await existingReport(env, claims, reportId);
    if (!recovered || recovered === "forbidden") return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
    return jsonRequest ? reportJson(recovered) : html(`<p role="status">Report <strong>${escape(recovered.id)}</strong> was already submitted.</p>`);
  }
  const errorCode = await validationError(env, submission);
  const timestamp = new Date().toISOString();
  if (existing?.status === "sync_error") {
    if (errorCode) {
      await env.DB.prepare("UPDATE reports SET validation_error_code = ?, updated_at = ? WHERE id = ?").bind(errorCode, timestamp, reportId).run();
      logError(correlationId, "worker", errorCode, reportId);
      const failed = { ...existing, validation_error_code: errorCode };
      return jsonRequest ? reportJson(failed, 422) : html(`<p class="error">Report needs attention: ${escape(errorCode)}.</p>`, 422);
    }
    try {
      await env.DB.batch([
      ...items.map(item => env.DB.prepare("INSERT OR IGNORE INTO line_items (id, report_id, product_id, quantity, reason_code, photo_id) VALUES (?, ?, ?, ?, ?, ?)").bind(item.id, reportId, item.productId, item.quantity, item.reasonCode, item.photoId ?? null)),
        ...items.filter(item => item.photoId).map(item => env.DB.prepare("INSERT OR IGNORE INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')").bind(item.photoId!, item.id, `pending/${reportId}/${item.photoId}`)),
        env.DB.prepare("UPDATE reports SET status = 'submitted', validation_error_code = NULL, updated_at = ? WHERE id = ?").bind(timestamp, reportId)
      ]);
      logTransition({ reportId, correlationId, fromStatus: "sync_error", toStatus: "submitted", actor: claims.user_id, component: "worker" });
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
      const recovered = await existingReport(env, claims, reportId);
      if (!recovered || recovered === "forbidden") return Response.json({ errorCode: "workflow_recovery_missing" }, { status: 503 });
      return jsonRequest ? reportJson(recovered) : html(`<p role="status">Report <strong>${escape(reportId)}</strong> passed validation and was submitted.</p>`);
    } catch { return jsonRequest ? Response.json({ errorCode: "validation_recovery_failed" }, { status: 422 }) : html(`<p class="error">Unable to retry this report.</p>`, 422); }
  }
  if (errorCode) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(reportId, timestamp),
      env.DB.prepare("INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at, validation_error_code) VALUES (?, ?, ?, 'sync_error', ?, ?, ?, ?)").bind(reportId, storeId, reporterId, totalAmountCents, timestamp, timestamp, errorCode)
    ]);
    await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
    logTransition({ reportId, correlationId, fromStatus: "pending_sync", toStatus: "sync_error", actor: claims.user_id, component: "worker", reason: errorCode });
    const failed = { id: reportId, status: "sync_error", total_amount: totalAmountCents, validation_error_code: errorCode };
    return jsonRequest ? reportJson(failed, 422) : html(`<p class="error">Report needs attention: ${escape(errorCode)}.</p>`, 422);
  }
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(reportId, timestamp),
      env.DB.prepare("INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, 'pending_sync', ?, ?, ?)").bind(reportId, storeId, reporterId, totalAmountCents, timestamp, timestamp),
      ...items.map(item => env.DB.prepare("INSERT INTO line_items (id, report_id, product_id, quantity, reason_code, photo_id) VALUES (?, ?, ?, ?, ?, ?)").bind(item.id, reportId, item.productId, item.quantity, item.reasonCode, item.photoId ?? null)),
      ...items.filter(item => item.photoId).map(item => env.DB.prepare("INSERT INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')").bind(item.photoId!, item.id, `pending/${reportId}/${item.photoId}`)),
      env.DB.prepare("UPDATE reports SET status = 'submitted', updated_at = ? WHERE id = ?").bind(timestamp, reportId)
    ]);
  } catch {
    const replay = await existingReport(env, claims, reportId);
    if (replay && replay !== "forbidden") return jsonRequest ? reportJson(replay) : html(`<p role="status">Report <strong>${escape(replay.id)}</strong> was already submitted.</p>`);
    return jsonRequest ? Response.json({ errorCode: "save_failed" }, { status: 422 }) : html(`<p class="error">Unable to save the report. Check the selected products and try again.</p>`, 422);
  }
  await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
  logTransition({ reportId, correlationId, fromStatus: "pending_sync", toStatus: "submitted", actor: claims.user_id, component: "worker" });
  const workflowResponse = await initializeWorkflow(env, submission, correlationId);
  if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved but needs attention before approval.</p>`, 503);
  const created = await existingReport(env, claims, reportId);
  if (!created || created === "forbidden") return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
  return jsonRequest ? reportJson(created, 201) : html(`<p role="status">Report <strong>${escape(reportId)}</strong> submitted successfully.</p>`, 201, { "HX-Trigger": "reportsChanged" });
}
async function uploadPhoto(request: Request, env: Env, claims: Claims, reportId: string, lineItemId: string, correlationId: string) {
  if (!requireRole(claims, ["store"])) return forbidden();
  const photoId = request.headers.get("X-Photo-Id") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(photoId) || !contentType.startsWith("image/")) return Response.json({ errorCode: "invalid_photo_payload" }, { status: 422 });
  const target = await env.DB.prepare("SELECT li.photo_id FROM line_items li JOIN reports r ON r.id = li.report_id WHERE li.id = ? AND li.report_id = ? AND r.store_id = ?").bind(lineItemId, reportId, claims.store_id).first<{ photo_id: string | null }>();
  if (!target || target.photo_id !== photoId) return Response.json({ errorCode: "photo_target_not_found" }, { status: 404 });
  const existing = await env.DB.prepare("SELECT status FROM photos WHERE id = ?").bind(photoId).first<{ status: string }>();
  if (existing?.status === "uploaded") return Response.json({ id: photoId, status: "uploaded" });
  const r2Key = `reports/${reportId}/${photoId}`;
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')").bind(photoId, lineItemId, r2Key).run();
    await env.PHOTOS.put(r2Key, request.body!, { httpMetadata: { contentType } });
    await env.DB.prepare("UPDATE photos SET r2_key = ?, status = 'uploaded' WHERE id = ?").bind(r2Key, photoId).run();
    return Response.json({ id: photoId, status: "uploaded" }, { status: 201 });
  } catch {
    await env.DB.prepare("UPDATE photos SET status = 'failed' WHERE id = ?").bind(photoId).run();
    logError(correlationId, "worker", "photo_upload_failed", reportId);
    return Response.json({ id: photoId, status: "failed", errorCode: "photo_upload_failed" }, { status: 503 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const correlationId = request.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
    try {
    const response = await (async () => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && (pathname === "/hello" || pathname === "/health")) return hello();
    if (request.method === "GET" && (pathname === "/" || pathname === "/login")) return loginPage(env);
    if (request.method === "POST" && pathname === "/api/login") return login(request, env);
    const claims = await protectedClaims(request, env); if (!claims) return unauthorized();
    if (request.method === "GET" && pathname === "/app") return appPage(env, claims);
    if (request.method === "GET" && pathname === "/approvals") return approvalsPage(claims);
    if (request.method === "GET" && pathname === "/ops") return opsPage(claims);
    if (request.method === "GET" && pathname === "/fragments/line-item" && requireRole(claims, ["store"])) return lineItemRow(env);
    if (request.method === "GET" && pathname === "/api/reports" && requireRole(claims, ["store"])) return myReports(env, claims);
    if (request.method === "GET" && pathname === "/api/reports/statuses") return reportStatuses(env, claims);
    if (request.method === "GET" && pathname === "/fragments/approvals") return approvalsFragment(env, claims);
    if (request.method === "GET" && pathname === "/fragments/ops") return opsFragment(env, claims);
    if (request.method === "POST" && pathname === "/api/reports") return createReport(request, env, claims, correlationId);
    const photoRoute = pathname.match(/^\/api\/reports\/([^/]+)\/line-items\/([^/]+)\/photo$/);
    if (request.method === "PUT" && photoRoute) return uploadPhoto(request, env, claims, photoRoute[1], photoRoute[2], correlationId);
    const decisionRoute = pathname.match(/^\/api\/reports\/([^/]+)\/decision$/);
    if (request.method === "POST" && decisionRoute) {
      if (!requireRole(claims, ["regional_manager", "quality"])) return forbidden();
      const report = await env.DB.prepare("SELECT store_id, status, total_amount FROM reports WHERE id = ?").bind(decisionRoute[1]).first<{ store_id: string; status: string; total_amount: number }>();
      if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
      if (!canAccessStore(claims, report.store_id) || (claims.role === "regional_manager" && report.status !== "pending_regional") || (claims.role === "quality" && report.status !== "pending_quality")) return forbidden();
      let input: { decision?: "approve" | "reject"; reason?: string };
      try { input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData()); } catch { return Response.json({ error: "Invalid decision" }, { status: 422 }); }
      if (input.decision !== "approve" && input.decision !== "reject") return Response.json({ error: "Decision must be approve or reject" }, { status: 422 });
      const response = await reportWorkflow(env, decisionRoute[1]).fetch("https://report-workflow/decision", { method: "POST", headers: { "X-Correlation-Id": correlationId }, body: JSON.stringify({ role: claims.role, actor: claims.user_id, decision: input.decision, reason: input.reason }) });
      if (!response.ok) return new Response(response.body, response);
      if (request.headers.get("HX-Request") === "true") return approvalsFragment(env, claims);
      const updated = await env.DB.prepare("SELECT id, status, total_amount, rejection_reason FROM reports WHERE id = ?").bind(decisionRoute[1]).first<{ id: string; status: string; total_amount: number; rejection_reason: string | null }>();
      return Response.json({ id: updated!.id, status: updated!.status, totalAmountCents: updated!.total_amount, rejectionReason: updated!.rejection_reason });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
    })();
    return withCorrelation(response, correlationId);
    } catch {
      logError(correlationId, "worker", "unhandled_request_error");
      return withCorrelation(Response.json({ errorCode: "technical_error" }, { status: 500 }), correlationId);
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { reportId, correlationId = crypto.randomUUID() } = message.body as { reportId?: string; correlationId?: string };
      if (!reportId) { message.ack(); continue; }
      const maxRetries = Math.max(0, Number(env.ERP_MAX_RETRIES ?? String(RETRY_LIMITS.erpDefaultMaxRetries)));
      const failPermanently = async (reason: string) => {
        await env.DB.batch([
          env.DB.prepare("UPDATE credit_notes SET status = 'failed' WHERE report_id = ?").bind(reportId),
          env.DB.prepare("UPDATE reports SET status = 'erp_error', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), reportId)
        ]);
        logTransition({ reportId, correlationId, fromStatus: "credit_note_processing", toStatus: "erp_error", actor: "system", component: "erp-queue", reason });
        message.ack();
      };
      try {
        const report = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?").bind(reportId).first<{ id: string; status: string }>();
        if (!report) { message.ack(); continue; }
        let creditNote = await env.DB.prepare("SELECT id, status FROM credit_notes WHERE report_id = ?").bind(reportId).first<{ id: string; status: string }>();
        if (!creditNote) {
          const creditNoteId = crypto.randomUUID();
          await env.DB.batch([
            env.DB.prepare("INSERT OR IGNORE INTO credit_notes (id, report_id, status, erp_document_id) VALUES (?, ?, 'pending', NULL)").bind(creditNoteId, reportId),
            env.DB.prepare("UPDATE reports SET status = 'credit_note_processing', updated_at = ? WHERE id = ? AND status = 'approved'").bind(new Date().toISOString(), reportId)
          ]);
          logTransition({ reportId, correlationId, fromStatus: report.status, toStatus: "credit_note_processing", actor: "system", component: "erp-queue" });
          creditNote = await env.DB.prepare("SELECT id, status FROM credit_notes WHERE report_id = ?").bind(reportId).first<{ id: string; status: string }>();
        }
        if (!creditNote || creditNote.status === "created" || creditNote.status === "failed") { message.ack(); continue; }
        await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Number(env.ERP_SIMULATED_DELAY_MS ?? "100"))));
        const shouldFail = Math.random() < Math.min(1, Math.max(0, Number(env.ERP_FAILURE_RATE ?? "0")));
        if (shouldFail) {
          if (message.attempts >= maxRetries) {
            await failPermanently("erp_retry_limit_exhausted");
          } else message.retry();
          continue;
        }
        await env.DB.batch([
          env.DB.prepare("UPDATE credit_notes SET status = 'created', erp_document_id = ? WHERE report_id = ?").bind(`ERP-${reportId}`, reportId),
          env.DB.prepare("UPDATE reports SET status = 'completed', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), reportId)
        ]);
        logTransition({ reportId, correlationId, fromStatus: "credit_note_processing", toStatus: "completed", actor: "system", component: "erp-queue" });
        message.ack();
      } catch {
        logError(correlationId, "erp-queue", "queue_consumer_error", reportId);
        if (message.attempts >= maxRetries) await failPermanently("queue_consumer_retry_limit_exhausted");
        else message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env>;

export { ReportWorkflow };
