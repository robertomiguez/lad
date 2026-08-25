import type { Claims } from "../auth";
import { storeStatusLabel } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { Product } from "../repositories/catalog";
import type {
  StoreReport,
  StoreReportApprovalEvent,
  StoreReportDetail,
  StoreReportLineItem,
} from "../repositories/reports";
import type { StoreWorkspaceUser } from "../repositories/users";
import { pageDocument, pageHeaderView, topBarView } from "./layout";

const formatChf = (amountCents: number) => `CHF ${(amountCents / 100).toFixed(2)}`;
const reportStatusLabel = (status: string) =>
  `<span class="report-status-label status-${escape(status)}">${escape(storeStatusLabel(status))}</span>`;
const reasonLabel = (reasonCode: string) =>
  ({ damaged: "Damaged", incorrect_delivery: "Incorrect delivery", expired: "Expired" })[reasonCode] ?? reasonCode;
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

const productOptions = (products: Product[]) =>
  products
    .map(
      (product) =>
        `<option value="${escape(product.id)}" data-sku="${escape(product.sku)}" data-barcode="${escape(product.barcode ?? "")}">${escape(product.sku)} — ${escape(product.name)} · ${formatChf(product.unit_price_cents)} incl. VAT</option>`,
    )
    .join("");

const lineItemMarkup = (options: string) =>
  `<fieldset class="line-item"><input type="hidden" name="line_item_id" data-line-id><label class="barcode-field">Barcode / SKU <input name="barcode" data-barcode-input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type SKU"><span class="barcode-result" data-barcode-result aria-live="polite"></span></label><label class="product-field">Product <select name="product_id" required><option value="">Choose product</option>${options}</select></label><label class="quantity-field">Quantity <input name="quantity" type="number" min="1" step="1" required></label><label class="reason-field">Reason <select name="reason_code" required><option value="">Choose reason</option><option value="damaged">Damaged</option><option value="incorrect_delivery">Incorrect delivery</option><option value="expired">Expired</option></select></label><div class="photo-field"><label>Photo <input name="photo" type="file" accept="image/*"></label><img class="photo-preview" data-photo-preview alt="Selected damage photo" hidden><button type="button" class="remove-line" aria-label="Remove item" title="Remove item">×</button></div><label class="item-description-field">Additional details <textarea name="description" maxlength="500" rows="3" placeholder="Optional context for this item"></textarea><span class="field-hint">Optional · up to 500 characters</span></label><button type="button" class="barcode-camera-button" data-camera-scan aria-label="Scan barcode with camera">Scan</button><div class="barcode-scanner" data-barcode-scanner hidden><video data-barcode-video muted playsinline></video><p>Point the camera at the product barcode.</p><button type="button" class="button-secondary" data-close-camera>Cancel scan</button></div></fieldset>`;

const photoLabel = (photoId: string | null, status: string | null) =>
  !photoId
    ? "No photo"
    : ({ pending: "Photo pending", uploaded: "Photo uploaded", failed: "Photo needs attention" }[status ?? ""] ??
      "Photo updating");
const photoView = (reportId: string, item: StoreReportLineItem) =>
  item.photo_id && item.photo_status === "uploaded"
    ? `<img class="report-detail-photo" src="/api/reports/${encodeURIComponent(reportId)}/line-items/${encodeURIComponent(item.id)}/photo" alt="Damage photo for ${escape(item.sku)}" loading="lazy">`
    : "";
const valueEvidence = (item: StoreReportLineItem) =>
  `<div><dt>Unit value</dt><dd>${formatChf(item.unit_price_cents)} incl. ${(item.tax_rate_bps / 100).toFixed(1)}% VAT</dd></div><div><dt>Line total</dt><dd>${formatChf(item.line_total_amount)}</dd></div>`;

const approvalTimelineView = (report: StoreReportDetail, events: StoreReportApprovalEvent[]) => {
  const regional = events.find((event) => event.role === "regional_manager");
  const quality = events.find((event) => event.role === "quality");
  const requiresRegional =
    report.total_amount >= 20_000 ||
    Boolean(regional) ||
    ["pending_regional", "pending_quality", "rejected"].includes(report.status);
  const escalatedToQuality = Boolean(report.escalated_at && report.escalation_target_role === "quality" && !regional);
  const requiresQuality =
    escalatedToQuality || (requiresRegional && report.total_amount >= 100_000 && regional?.decision !== "reject");
  const finalDecision = ["approved", "rejected", "credit_note_pending", "completed"].includes(report.status)
    ? (quality ?? regional)
    : undefined;
  const automaticallyApproved =
    !requiresRegional && !finalDecision && ["approved", "credit_note_pending", "completed"].includes(report.status);
  const step = (
    title: string,
    detail: string,
    timestamp: string | undefined,
    state: "completed" | "current" | "upcoming" | "skipped" | "rejected",
    note?: string,
  ) =>
    `<li class="timeline-${state}"><span class="timeline-marker" aria-hidden="true"></span><div><strong>${escape(title)}</strong><span>${escape(detail)}</span>${note ? `<span class="timeline-note">${escape(note)}</span>` : ""}${timestamp ? `<time datetime="${escape(timestamp)}">${escape(formatDateTime(timestamp))}</time>` : ""}</div></li>`;
  const regionalDetail = !requiresRegional
    ? "Not required"
    : regional
      ? regional.decision === "approve"
        ? "Approved"
        : "Rejected"
      : report.status === "pending_regional"
        ? "Awaiting decision"
        : "Awaiting Regional decision";
  const qualityDetail =
    !requiresQuality && !quality
      ? "Not required"
      : quality
        ? quality.decision === "approve"
          ? "Approved"
          : "Rejected"
        : report.status === "pending_quality"
          ? "Awaiting decision"
          : !regional && report.status === "pending_regional"
            ? "Waiting for Regional approval"
            : "Awaiting Quality decision";
  const finalDetail = finalDecision
    ? finalDecision.decision === "approve"
      ? "Approved"
      : "Rejected"
    : automaticallyApproved
      ? "Approved automatically"
      : "Decision pending";
  const finalState = finalDecision
    ? finalDecision.decision === "reject"
      ? "rejected"
      : "completed"
    : automaticallyApproved
      ? "completed"
      : ["pending_regional", "pending_quality"].includes(report.status)
        ? "upcoming"
        : "current";
  return `<section class="approval-timeline-section" aria-labelledby="approval-timeline-title"><h2 id="approval-timeline-title">Approval timeline</h2><ol class="approval-timeline">${step("Report submitted", "Sent to approval", report.created_at, "completed")}${step("Regional approval", regionalDetail, escalatedToQuality ? (report.escalated_at ?? undefined) : regional?.created_at, !requiresRegional ? "skipped" : regional ? (regional.decision === "reject" ? "rejected" : "completed") : report.status === "pending_regional" ? "current" : "upcoming", escalatedToQuality ? "Escalated to Quality Management" : undefined)}${step("Quality approval", qualityDetail, quality?.created_at, !requiresQuality && !quality ? "skipped" : quality ? (quality.decision === "reject" ? "rejected" : "completed") : report.status === "pending_quality" ? "current" : "upcoming")}${step("Final decision", finalDetail, finalDecision?.created_at ?? (automaticallyApproved ? report.created_at : undefined), finalState)}</ol></section>`;
};

export const lineItemView = (products: Product[]) => html(lineItemMarkup(productOptions(products)));

export const storeAppView = (claims: Claims, user: StoreWorkspaceUser | null, products: Product[]) => {
  const item = lineItemMarkup(productOptions(products));
  return pageDocument({
    title: "New damage report",
    scripts: [{ src: "/app.js", module: true }],
    body: `${topBarView({ session: "Store workspace ·", emphasis: user?.store_name ?? claims.store_id ?? "", backHref: "/" })}<main class="page">${pageHeaderView({ eyebrow: "New claim", title: "Report damaged goods", lede: "Start a new report or continue a saved draft when you are ready.", actions: '<button type="button" id="new-report">New record</button>' })}<div id="form-feedback" class="form-feedback" aria-live="polite"></div><div class="capture-grid"><section class="card form-card" hidden><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><fieldset id="report-editor" class="report-editor" hidden disabled><legend class="visually-hidden">Report editor</legend><p class="form-note">The report value is calculated from the server-owned POC catalogue when it synchronises. You cannot enter an approval total.</p><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="line-items-actions"><button type="button" class="add-line-item" data-add-line-item><span aria-hidden="true">+</span> Add another item</button></div><div class="form-actions"><button type="button" id="save-draft" class="button-secondary">Save draft</button><button type="submit">Submit report</button><button type="button" id="cancel-edit" class="button-secondary">Cancel editing</button></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos remain local until you submit.</p></fieldset></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main><dialog id="confirmation-dialog" class="confirmation-dialog" aria-labelledby="confirmation-title"><form method="dialog"><p class="eyebrow">Confirmation</p><h2 id="confirmation-title">Confirm action</h2><p id="confirmation-message"></p><div class="form-actions"><button class="button-secondary" value="cancel">Cancel</button><button id="confirmation-confirm" value="confirm">Confirm</button></div></form></dialog>`,
  });
};

export const myReportsView = (reports: StoreReport[]) =>
  html(
    reports.length
      ? reports
          .map(
            (report) =>
              `<article class="report"><a class="report-reference" href="/reports/${encodeURIComponent(report.id)}">${escape(report.id)}</a> · ${reportStatusLabel(report.status)} · ${formatChf(report.total_amount)}<br><small>${escape(report.created_at)}</small></article>`,
          )
          .join("")
      : '<p class="empty-state">No reports submitted yet.</p>',
  );

export const reportDetailsView = (
  claims: Claims,
  user: StoreWorkspaceUser | null,
  report: StoreReportDetail,
  items: StoreReportLineItem[],
  events: StoreReportApprovalEvent[],
) =>
  pageDocument({
    title: "Report details",
    body: `${topBarView({ session: "Store workspace ·", emphasis: user?.store_name ?? claims.store_id ?? "", backHref: "/app" })}<main class="page">${pageHeaderView({ eyebrow: "Report details", title: `Report ${report.id}`, lede: "A read-only record of this submitted damage report." })}<section class="card report-detail-card"><dl class="report-detail-summary"><div class="report-reference-field"><dt>Report reference</dt><dd class="report-id">${escape(report.id)}</dd></div><div><dt>Status</dt><dd>${reportStatusLabel(report.status)}</dd></div><div><dt>Created</dt><dd>${escape(report.created_at)}</dd></div><div><dt>Total amount</dt><dd>${formatChf(report.total_amount)} incl. ${formatChf(report.tax_amount)} VAT</dd></div><div><dt>Pricing source</dt><dd>Server-owned POC catalogue snapshot</dd></div>${report.escalated_at ? `<div><dt>Escalation</dt><dd>Escalated to ${escape(report.escalation_target_role ?? "fallback approver role")}</dd></div>` : ""}${report.rejection_reason ? `<div class="report-detail-wide"><dt>Rejection reason</dt><dd>${escape(report.rejection_reason)}</dd></div>` : ""}</dl>${approvalTimelineView(report, events)}<h2>Damaged items</h2>${items.length ? `<div class="report-detail-items">${items.map((item) => `<article><h3>${escape(item.sku)} — ${escape(item.product_name)}</h3><dl><div><dt>Quantity</dt><dd>${item.quantity}</dd></div>${valueEvidence(item)}<div><dt>Reason</dt><dd>${escape(reasonLabel(item.reason_code))}</dd></div><div><dt>Photo</dt><dd>${escape(photoLabel(item.photo_id, item.photo_status))}${photoView(report.id, item)}</dd></div>${item.description?.trim() ? `<div class="report-detail-wide"><dt>Additional details</dt><dd>${escape(item.description)}</dd></div>` : ""}</dl></article>`).join("")}</div>` : '<p class="empty-state">No line items were recorded for this report.</p>'}</section></main>`,
  });
