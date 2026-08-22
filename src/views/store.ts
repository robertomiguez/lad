import type { Claims } from "../auth";
import { storeStatusLabel } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { Product } from "../repositories/catalog";
import type { StoreReport, StoreReportDetail, StoreReportLineItem } from "../repositories/reports";
import type { StoreWorkspaceUser } from "../repositories/users";
import { pageDocument, pageHeaderView, topBarView } from "./layout";

const productOptions = (products: Product[]) =>
  products
    .map(
      (product) =>
        `<option value="${escape(product.id)}" data-sku="${escape(product.sku)}" data-barcode="${escape(product.barcode ?? "")}">${escape(product.sku)} — ${escape(product.name)}</option>`,
    )
    .join("");

export const lineItemView = (products: Product[]) => html(lineItemMarkup(productOptions(products)));

export const storeAppView = (claims: Claims, user: StoreWorkspaceUser | null, products: Product[]) => {
  const item = lineItemMarkup(productOptions(products));
  return pageDocument({
    title: "New damage report",
    scripts: [{ src: "/app.js", module: true }],
    body: `${topBarView({ session: "Store workspace ·", emphasis: user?.store_name ?? claims.store_id ?? "", backHref: "/" })}<main class="page">${pageHeaderView({ eyebrow: "New claim", title: "Report damaged goods", lede: "Start a new report or continue a saved draft when you are ready.", actions: '<button type="button" id="new-report">New record</button>' })}<div id="form-feedback" class="form-feedback" aria-live="polite"></div><div class="capture-grid"><section class="card form-card" hidden><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><fieldset id="report-editor" class="report-editor" hidden disabled><legend class="visually-hidden">Report editor</legend><div class="form-grid"><label>Date <input name="report_date" type="date" required></label><label>Total amount (CHF) <input name="total_amount" type="number" min="0" step="0.01" required></label></div><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="line-items-actions"><button type="button" class="add-line-item" data-add-line-item><span aria-hidden="true">+</span> Add another item</button></div><div class="form-actions"><button type="button" id="save-draft" class="button-secondary">Save draft</button><button type="submit">Submit report</button><button type="button" id="cancel-edit" class="button-secondary">Cancel editing</button></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos remain local until you submit.</p></fieldset></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main><dialog id="confirmation-dialog" class="confirmation-dialog" aria-labelledby="confirmation-title"><form method="dialog"><p class="eyebrow">Confirmation</p><h2 id="confirmation-title">Confirm action</h2><p id="confirmation-message"></p><div class="form-actions"><button class="button-secondary" value="cancel">Cancel</button><button id="confirmation-confirm" value="confirm">Confirm</button></div></form></dialog>`,
  });
};

export const myReportsView = (reports: StoreReport[]) =>
  html(
    reports.length
      ? reports
          .map(
            (report) =>
              `<article class="report"><a class="report-reference" href="/reports/${encodeURIComponent(report.id)}" title="${escape(report.id)}">${escape(`${report.id.slice(0, 7)}...`)}</a> · ${escape(storeStatusLabel(report.status))} · CHF ${(report.total_amount / 100).toFixed(2)}<br><small>${escape(report.created_at)}</small></article>`,
          )
          .join("")
      : '<p class="empty-state">No reports submitted yet.</p>',
  );

const reasonLabel = (reasonCode: string) =>
  ({ damaged: "Damaged", incorrect_delivery: "Incorrect delivery", expired: "Expired" })[reasonCode] ?? reasonCode;

const photoLabel = (photoId: string | null, status: string | null) => {
  if (!photoId) return "No photo";
  return (
    { pending: "Photo pending", uploaded: "Photo uploaded", failed: "Photo needs attention" }[status ?? ""] ??
    "Photo updating"
  );
};

export const reportDetailsView = (
  claims: Claims,
  user: StoreWorkspaceUser | null,
  report: StoreReportDetail,
  items: StoreReportLineItem[],
) =>
  pageDocument({
    title: "Report details",
    body: `${topBarView({ session: "Store workspace ·", emphasis: user?.store_name ?? claims.store_id ?? "", backHref: "/app" })}<main class="page">${pageHeaderView({ eyebrow: "Report details", title: `Report ${report.id.slice(0, 7)}...`, lede: "A read-only record of this submitted damage report." })}<section class="card report-detail-card"><dl class="report-detail-summary"><div><dt>Report reference</dt><dd class="report-id">${escape(report.id)}</dd></div><div><dt>Status</dt><dd>${escape(storeStatusLabel(report.status))}</dd></div><div><dt>Created</dt><dd>${escape(report.created_at)}</dd></div><div><dt>Total amount</dt><dd>CHF ${(report.total_amount / 100).toFixed(2)}</dd></div>${report.escalated_at ? `<div><dt>Escalation</dt><dd>Escalated to ${escape(report.escalation_target_role ?? "fallback approver role")}</dd></div>` : ""}${report.rejection_reason ? `<div class="report-detail-wide"><dt>Rejection reason</dt><dd>${escape(report.rejection_reason)}</dd></div>` : ""}</dl><h2>Damaged items</h2>${items.length ? `<div class="report-detail-items">${items.map((item) => `<article><h3>${escape(item.sku)} — ${escape(item.product_name)}</h3><dl><div><dt>Quantity</dt><dd>${item.quantity}</dd></div><div><dt>Reason</dt><dd>${escape(reasonLabel(item.reason_code))}</dd></div><div><dt>Photo</dt><dd>${escape(photoLabel(item.photo_id, item.photo_status))}</dd></div></dl></article>`).join("")}</div>` : '<p class="empty-state">No line items were recorded for this report.</p>'}</section></main>`,
  });

const lineItemMarkup = (options: string) =>
  `<fieldset class="line-item"><input type="hidden" name="line_item_id" data-line-id><label class="barcode-field">Barcode / SKU <input name="barcode" data-barcode-input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type SKU"><span class="barcode-result" data-barcode-result aria-live="polite"></span></label><label class="product-field">Product <select name="product_id" required><option value="">Choose product</option>${options}</select></label><label class="quantity-field">Quantity <input name="quantity" type="number" min="1" step="1" required></label><label class="reason-field">Reason <select name="reason_code" required><option value="">Choose reason</option><option value="damaged">Damaged</option><option value="incorrect_delivery">Incorrect delivery</option><option value="expired">Expired</option></select></label><div class="photo-field"><label>Photo <input name="photo" type="file" accept="image/*"></label><img class="photo-preview" data-photo-preview alt="Selected damage photo" hidden><button type="button" class="remove-line" aria-label="Remove item" title="Remove item">×</button></div><button type="button" class="barcode-camera-button" data-camera-scan aria-label="Scan barcode with camera">Scan</button><div class="barcode-scanner" data-barcode-scanner hidden><video data-barcode-video muted playsinline></video><p>Point the camera at the product barcode.</p><button type="button" class="button-secondary" data-close-camera>Cancel scan</button></div></fieldset>`;
