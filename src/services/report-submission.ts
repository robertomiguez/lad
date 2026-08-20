import { forbidden, requireRole, type Claims } from "../auth";
import { REPORT_STATUS } from "../domain/reports";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import { initializeWorkflow } from "../lib/workflow-client";
import { logError, logTransition } from "../lib/observability";
import type { Env, Submission } from "../types";

async function submissionFrom(request: Request): Promise<Submission | null> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const input = await request.json() as Partial<Submission>;
    return Array.isArray(input.items) ? input as Submission : null;
  }
  const form = await request.formData();
  const productIds = form.getAll("product_id").map(String);
  const quantities = form.getAll("quantity").map(String);
  const reasons = form.getAll("reason_code").map(String);
  const lineIds = form.getAll("line_item_id").map(String);
  return {
    id: String(form.get("report_id") ?? ""),
    storeId: String(form.get("store_id") ?? ""),
    reporterId: String(form.get("reporter_id") ?? ""),
    reportDate: String(form.get("report_date") ?? ""),
    totalAmountCents: Math.round(Number(form.get("total_amount")) * 100),
    items: productIds.map((productId, index) => ({ id: lineIds[index], productId, quantity: Number(quantities[index]), reasonCode: reasons[index] }))
  };
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

export async function createReport(request: Request, env: Env, claims: Claims, correlationId: string) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
  const jsonRequest = request.headers.get("content-type")?.includes("application/json") ?? false;
  let submission: Submission | null;
  try {
    submission = await submissionFrom(request);
  } catch {
    submission = null;
  }
  if (!submission) return jsonRequest ? Response.json({ error: "Invalid report payload" }, { status: 422 }) : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422);

  const { id: reportId, storeId, reporterId, reportDate, totalAmountCents, items } = submission;
  const validId = (value: string) => /^[a-zA-Z0-9-]{8,80}$/.test(value);
  const invalid = !validId(reportId) || request.headers.get("Idempotency-Key") && request.headers.get("Idempotency-Key") !== reportId || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || storeId !== claims.store_id || reporterId !== claims.user_id || !Number.isInteger(totalAmountCents) || totalAmountCents < 0 || items.length < 1 || items.some(item => !validId(item.id) || !item.productId || !item.reasonCode || !Number.isInteger(item.quantity) || item.quantity < 1 || (item.photoId !== undefined && !validId(item.photoId)));
  if (invalid) {
    logError(correlationId, "worker", "invalid_payload", reportId);
    return jsonRequest ? Response.json({ errorCode: "invalid_payload" }, { status: 422 }) : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422);
  }

  const kvHit = await env.IDEMPOTENCY.get(`report:${reportId}`);
  const existing = kvHit ? await existingReport(env, claims, reportId) : await env.DB.prepare("SELECT key FROM idempotency_keys WHERE key = ?").bind(reportId).first() ? await existingReport(env, claims, reportId) : null;
  if (existing === "forbidden") return forbidden();
  if (existing && existing.status !== REPORT_STATUS.syncError) {
    if (existing.status === REPORT_STATUS.submitted) {
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
    }
    const recovered = await existingReport(env, claims, reportId);
    if (!recovered || recovered === "forbidden") return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
    return jsonRequest ? reportJson(recovered) : html(`<p role="status">Report <strong>${escape(recovered.id)}</strong> was already submitted.</p>`);
  }

  const errorCode = await validationError(env, submission);
  const timestamp = new Date().toISOString();
  if (existing?.status === REPORT_STATUS.syncError) {
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
        env.DB.prepare("UPDATE reports SET status = ?, validation_error_code = NULL, updated_at = ? WHERE id = ?").bind(REPORT_STATUS.submitted, timestamp, reportId)
      ]);
      logTransition({ reportId, correlationId, fromStatus: REPORT_STATUS.syncError, toStatus: REPORT_STATUS.submitted, actor: claims.user_id, component: "worker" });
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
      const recovered = await existingReport(env, claims, reportId);
      if (!recovered || recovered === "forbidden") return Response.json({ errorCode: "workflow_recovery_missing" }, { status: 503 });
      return jsonRequest ? reportJson(recovered) : html(`<p role="status">Report <strong>${escape(reportId)}</strong> passed validation and was submitted.</p>`);
    } catch {
      return jsonRequest ? Response.json({ errorCode: "validation_recovery_failed" }, { status: 422 }) : html(`<p class="error">Unable to retry this report.</p>`, 422);
    }
  }

  if (errorCode) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(reportId, timestamp),
      env.DB.prepare("INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at, validation_error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(reportId, storeId, reporterId, REPORT_STATUS.syncError, totalAmountCents, timestamp, timestamp, errorCode)
    ]);
    await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
    logTransition({ reportId, correlationId, fromStatus: REPORT_STATUS.pendingSync, toStatus: REPORT_STATUS.syncError, actor: claims.user_id, component: "worker", reason: errorCode });
    const failed = { id: reportId, status: REPORT_STATUS.syncError, total_amount: totalAmountCents, validation_error_code: errorCode };
    return jsonRequest ? reportJson(failed, 422) : html(`<p class="error">Report needs attention: ${escape(errorCode)}.</p>`, 422);
  }

  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(reportId, timestamp),
      env.DB.prepare("INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(reportId, storeId, reporterId, REPORT_STATUS.pendingSync, totalAmountCents, timestamp, timestamp),
      ...items.map(item => env.DB.prepare("INSERT INTO line_items (id, report_id, product_id, quantity, reason_code, photo_id) VALUES (?, ?, ?, ?, ?, ?)").bind(item.id, reportId, item.productId, item.quantity, item.reasonCode, item.photoId ?? null)),
      ...items.filter(item => item.photoId).map(item => env.DB.prepare("INSERT OR IGNORE INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')").bind(item.photoId!, item.id, `pending/${reportId}/${item.photoId}`)),
      env.DB.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").bind(REPORT_STATUS.submitted, timestamp, reportId)
    ]);
  } catch {
    const replay = await existingReport(env, claims, reportId);
    if (replay && replay !== "forbidden") return jsonRequest ? reportJson(replay) : html(`<p role="status">Report <strong>${escape(replay.id)}</strong> was already submitted.</p>`);
    return jsonRequest ? Response.json({ errorCode: "save_failed" }, { status: 422 }) : html(`<p class="error">Unable to save the report. Check the selected products and try again.</p>`, 422);
  }
  await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
  logTransition({ reportId, correlationId, fromStatus: REPORT_STATUS.pendingSync, toStatus: REPORT_STATUS.submitted, actor: claims.user_id, component: "worker" });
  const workflowResponse = await initializeWorkflow(env, submission, correlationId);
  if (!workflowResponse.ok) return jsonRequest ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 }) : html(`<p class="error">Report saved but needs attention before approval.</p>`, 503);
  const created = await existingReport(env, claims, reportId);
  if (!created || created === "forbidden") return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
  return jsonRequest ? reportJson(created, 201) : html(`<p role="status">Report <strong>${escape(reportId)}</strong> submitted successfully.</p>`, 201, { "HX-Trigger": "reportsChanged" });
}

export async function uploadPhoto(request: Request, env: Env, claims: Claims, reportId: string, lineItemId: string, correlationId: string) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
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
