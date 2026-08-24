import { escape, html } from "../lib/http";
import { storeStatusLabel } from "../domain/reports";
import type { ApprovalReport, StoreReportDetail, StoreReportLineItem } from "../repositories/reports";
import { pageDocument, pageHeaderView, secondaryLinkView, topBarView } from "./layout";

const reportLink = (report: ApprovalReport) =>
  `<a class="report-id approval-reference" href="/approvals/${encodeURIComponent(report.id)}" aria-label="Review report ${escape(report.id)}">${escape(report.id)}</a>`;

const decisionActions = (reportId: string, target: string, swap: string) =>
  `<div class="approval-actions"><form class="approval-form" hx-post="/api/reports/${encodeURIComponent(reportId)}/decision" hx-target="${escape(target)}" hx-swap="${escape(swap)}"><input type="hidden" name="decision" value="approve"><button>Approve</button></form><form class="rejection-form" hx-post="/api/reports/${encodeURIComponent(reportId)}/decision" hx-target="${escape(target)}" hx-swap="${escape(swap)}"><label>Rejection reason<textarea name="reason" rows="3" placeholder="Explain why this report is rejected" required></textarea></label><input type="hidden" name="decision" value="reject"><button>Reject</button></form></div>`;

const approvalCard = (report: ApprovalReport) =>
  `<article class="approval-card"><div class="approval-meta">${reportLink(report)}<span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span>${report.escalated_at ? `<mark>Escalated to ${escape(report.escalation_target_role ?? "fallback role")}</mark>` : ""}</div>${decisionActions(report.id, "#approval-worklist", "innerHTML")}</article>`;

const escalatedRegionalCard = (report: ApprovalReport) =>
  `<article class="approval-card"><div class="approval-meta">${reportLink(report)}<span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span><mark>Overdue Regional approval</mark></div><p class="approval-notice">Awaiting Regional approval — overdue 3 working days. Regional retains ownership of this decision.</p></article>`;

export const approvalWorklistView = (
  reports: ApprovalReport[],
  notice?: string,
  escalatedRegionalReports: ApprovalReport[] = [],
) =>
  html(
    `${notice ? `<p class="approval-notice" role="status">${escape(notice)}</p>` : ""}${
      reports.length
        ? `<div class="worklist">${reports.map(approvalCard).join("")}</div>`
        : '<p class="empty-state">No approval work currently assigned.</p>'
    }${
      escalatedRegionalReports.length
        ? `<section class="approval-supervisory-queue" aria-labelledby="escalated-regional-title"><h2 id="escalated-regional-title">Escalations requiring Regional approval</h2><p class="muted">These reports remain assigned to Regional Managers. They are visible to Quality for supervision only.</p><div class="worklist">${escalatedRegionalReports.map(escalatedRegionalCard).join("")}</div></section>`
        : ""
    }`,
  );

export const approvalsPageView = (approverRoleLabel: string, showOperationsLink: boolean) => {
  return pageDocument({
    title: "Approval worklist",
    scripts: [{ src: "https://unpkg.com/htmx.org@2.0.4" }],
    body: `${topBarView({ session: "Signed in as", emphasis: approverRoleLabel, backHref: "/" })}<main class="page">${pageHeaderView({ eyebrow: "Approval queue", title: "Approval worklist", lede: "Review reports assigned to your role. This list refreshes automatically every 15 seconds.", actions: showOperationsLink ? secondaryLinkView("/ops", "Operations") : undefined })}<section class="card"><div id="approval-worklist" hx-get="/fragments/approvals" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main>`,
  });
};

const formatChf = (amountCents: number) => `CHF ${(amountCents / 100).toFixed(2)}`;

const reasonLabel = (reasonCode: string) =>
  ({ damaged: "Damaged", incorrect_delivery: "Incorrect delivery", expired: "Expired" })[reasonCode] ?? reasonCode;

const photoLabel = (photoId: string | null, status: string | null) => {
  if (!photoId) return "No photo supplied";
  return (
    { pending: "Photo pending", uploaded: "Photo available", failed: "Photo needs attention" }[status ?? ""] ??
    "Photo updating"
  );
};

const photoView = (reportId: string, item: StoreReportLineItem) =>
  item.photo_id && item.photo_status === "uploaded"
    ? `<img class="report-detail-photo" src="/api/reports/${encodeURIComponent(reportId)}/line-items/${encodeURIComponent(item.id)}/photo" alt="Damage photo for ${escape(item.sku)}" loading="lazy">`
    : "";

const evidenceItemView = (reportId: string, item: StoreReportLineItem) =>
  `<article><h3>${escape(item.sku)} — ${escape(item.product_name)}</h3><dl><div><dt>Quantity</dt><dd>${item.quantity}</dd></div><div><dt>Reason</dt><dd>${escape(reasonLabel(item.reason_code))}</dd></div><div><dt>Photo</dt><dd>${escape(photoLabel(item.photo_id, item.photo_status))}${photoView(reportId, item)}</dd></div><div class="report-detail-wide"><dt>Notes</dt><dd>${item.description?.trim() ? escape(item.description) : "No notes provided."}</dd></div></dl></article>`;

export const approvalDetailsPageView = (
  approverRoleLabel: string,
  report: StoreReportDetail,
  items: StoreReportLineItem[],
  canDecide: boolean,
) =>
  pageDocument({
    title: "Approval review",
    scripts: [{ src: "https://unpkg.com/htmx.org@2.0.4" }],
    body: `${topBarView({ session: "Signed in as", emphasis: approverRoleLabel, backHref: "/approvals" })}<main class="page">${pageHeaderView({ eyebrow: "Approval review", title: `Report ${report.id}`, lede: "Review the submitted evidence before recording your decision." })}<section class="card report-detail-card"><dl class="report-detail-summary"><div class="report-reference-field"><dt>Report reference</dt><dd class="report-id">${escape(report.id)}</dd></div><div><dt>Status</dt><dd>${escape(storeStatusLabel(report.status))}</dd></div><div><dt>Submitted</dt><dd>${escape(report.created_at)}</dd></div><div><dt>Total amount</dt><dd>${formatChf(report.total_amount)}</dd></div>${report.escalated_at ? `<div><dt>Escalation</dt><dd>Escalated to ${escape(report.escalation_target_role ?? "fallback approver role")}</dd></div>` : ""}${report.rejection_reason ? `<div class="report-detail-wide"><dt>Rejection reason</dt><dd>${escape(report.rejection_reason)}</dd></div>` : ""}</dl><h2>Submitted evidence</h2>${items.length ? `<div class="report-detail-items">${items.map((item) => evidenceItemView(report.id, item)).join("")}</div>` : '<p class="empty-state">No line items were recorded for this report.</p>'}</section><section id="approval-decision" class="card approval-decision-card"><h2>Decision</h2>${canDecide ? `<p class="lede">The evidence above supports this approval decision.</p>${decisionActions(report.id, "#approval-decision", "outerHTML")}` : '<p class="approval-notice">This report is not currently assigned to your role for a decision.</p>'}</section></main>`,
  });
