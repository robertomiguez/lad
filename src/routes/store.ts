import { forbidden, requireRole, type Claims } from "../auth";
import { escape, html } from "../lib/http";
import type { Env } from "../types";

type Product = { id: string; sku: string; barcode: string | null; name: string };
type Report = { id: string; status: string; total_amount: number; created_at: string };

async function products(env: Env) {
  return (await env.DB.prepare("SELECT id, sku, barcode, name FROM products WHERE active = 1 ORDER BY sku").all<Product>()).results;
}

const productOptions = (items: Product[]) => items.map(product => `<option value="${escape(product.id)}" data-sku="${escape(product.sku)}" data-barcode="${escape(product.barcode ?? "")}">${escape(product.sku)} — ${escape(product.name)}</option>`).join("");

const lineItemMarkup = (options: string) => `<fieldset class="line-item"><input type="hidden" name="line_item_id" data-line-id><label>Barcode / SKU <input name="barcode" data-barcode-input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type SKU"><span class="barcode-result" data-barcode-result aria-live="polite"></span></label><label>Product <select name="product_id" required><option value="">Choose product</option>${options}</select></label><label>Quantity <input name="quantity" type="number" min="1" step="1" required></label><label>Reason <select name="reason_code" required><option value="">Choose reason</option><option value="damaged">Damaged</option><option value="incorrect_delivery">Incorrect delivery</option><option value="expired">Expired</option></select></label><label>Photo <input name="photo" type="file" accept="image/*"></label><button type="button" class="remove-line">Remove</button><button type="button" class="barcode-camera-button" data-camera-scan aria-label="Scan barcode with camera">Scan</button><div class="barcode-scanner" data-barcode-scanner hidden><video data-barcode-video muted playsinline></video><p>Point the camera at the product barcode.</p><button type="button" class="button-secondary" data-close-camera>Cancel scan</button></div></fieldset>`;

export async function lineItemRow(env: Env) {
  return html(lineItemMarkup(productOptions(await products(env))));
}

export async function productsResponse(env: Env) {
  return Response.json(await products(env), { headers: { "cache-control": "no-store" } });
}

export async function appPage(env: Env, claims: Claims) {
  if (claims.role !== "store") return new Response(null, { status: 303, headers: { location: "/approvals" } });
  const user = await env.DB.prepare("SELECT u.name, s.name AS store_name FROM users u JOIN stores s ON s.id = u.store_id WHERE u.id = ?").bind(claims.user_id).first<{ name: string; store_name: string }>();
  const item = lineItemMarkup(productOptions(await products(env)));
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New damage report</title><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Store workspace · <strong>${escape(user?.store_name ?? claims.store_id ?? "")}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">New claim</p><h1>Report damaged goods</h1><p class="lede">Saved to this device first, then synchronized safely when a connection is available.</p></div></div><div class="capture-grid"><section class="card form-card"><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><div class="form-grid"><label>Date <input name="report_date" type="date" required></label><label>Total amount (CHF) <input name="total_amount" type="number" min="0" step="0.01" required></label></div><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="form-actions"><button type="button" id="add-line-item" class="button-secondary">Add another item</button><button type="submit">Save report</button></div><div id="form-feedback" class="form-feedback" aria-live="polite"></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos upload independently.</p></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main></html>`);
}

const storeStatus = (status: string) => ({ pending_sync: "Pending Sync", submitted: "With Regional Manager", pending_regional: "With Regional Manager", pending_quality: "With Quality Management", approved: "Credit Note Processing", credit_note_processing: "Credit Note Processing", completed: "Completed", rejected: "Rejected", sync_error: "Needs attention — retrying", erp_error: "Needs attention — retrying" })[status] ?? "Updating status";

export async function myReports(env: Env, claims: Claims) {
  const { results } = await env.DB.prepare("SELECT id, status, total_amount, created_at FROM reports WHERE store_id = ? ORDER BY created_at DESC").bind(claims.store_id).all<Report>();
  return html(results.length ? results.map(report => `<article class="report"><strong>${escape(report.id)}</strong> · ${escape(storeStatus(report.status))} · CHF ${(report.total_amount / 100).toFixed(2)}<br><small>${escape(report.created_at)}</small></article>`).join("") : "<p class=\"empty-state\">No reports submitted yet.</p>");
}

export async function reportStatuses(env: Env, claims: Claims) {
  if (!requireRole(claims, ["store"])) return forbidden();
  const { results } = await env.DB.prepare("SELECT id, status, total_amount, created_at, escalated_at, escalation_target_role, rejection_reason FROM reports WHERE store_id = ? ORDER BY updated_at DESC").bind(claims.store_id).all<{ id: string; status: string; total_amount: number; created_at: string; escalated_at: string | null; escalation_target_role: string | null; rejection_reason: string | null }>();
  return Response.json(results.map(report => ({ id: report.id, status: report.status, totalAmountCents: report.total_amount, createdAt: report.created_at, escalatedAt: report.escalated_at, escalationTargetRole: report.escalation_target_role, rejectionReason: report.rejection_reason })));
}
