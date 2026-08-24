import { escape, html } from "../lib/http";
import type { ApprovalReport } from "../repositories/reports";
import { pageDocument, pageHeaderView, secondaryLinkView, topBarView } from "./layout";

const approvalCard = (report: ApprovalReport) =>
  `<article class="approval-card"><div class="approval-meta"><span class="report-id">${escape(report.id)}</span><span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span>${report.escalated_at ? `<mark>Escalated to ${escape(report.escalation_target_role ?? "fallback role")}</mark>` : ""}</div><div class="approval-actions"><form class="approval-form" hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><input type="hidden" name="decision" value="approve"><button>Approve</button></form><form class="rejection-form" hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><label>Rejection reason<textarea name="reason" rows="3" placeholder="Explain why this report is rejected" required></textarea></label><input type="hidden" name="decision" value="reject"><button>Reject</button></form></div></article>`;

const escalatedRegionalCard = (report: ApprovalReport) =>
  `<article class="approval-card"><div class="approval-meta"><span class="report-id">${escape(report.id)}</span><span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span><mark>Overdue Regional approval</mark></div><p class="approval-notice">Awaiting Regional approval — overdue 3 working days. Regional retains ownership of this decision.</p></article>`;

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
