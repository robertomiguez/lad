import { escape, html } from "../lib/http";
import type { ApprovalReport } from "../repositories/reports";

export const approvalWorklistView = (reports: ApprovalReport[]) =>
  html(
    reports.length
      ? `<div class="worklist">${reports
          .map(
            (report) =>
              `<article class="approval-card"><div class="approval-meta"><span class="report-id">${escape(report.id)}</span><span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span>${report.escalated_at ? `<mark>Escalated to ${escape(report.escalation_target_role ?? "fallback role")}</mark>` : ""}</div><div class="approval-actions"><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><input type="hidden" name="decision" value="approve"><button>Approve</button></form><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><label><span class="visually-hidden">Rejection reason</span><input name="reason" placeholder="Rejection reason" required></label><input type="hidden" name="decision" value="reject"><button>Reject</button></form></div></article>`,
          )
          .join("")}</div>`
      : '<p class="empty-state">No approval work currently assigned.</p>',
  );

export const approvalsPageView = (approverRoleLabel: string, showOperationsLink: boolean) => {
  const operationsLink = showOperationsLink ? '<a class="button button-secondary" href="/ops">Operations</a>' : "";
  return html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approval worklist</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Signed in as <strong>${escape(approverRoleLabel)}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">Approval queue</p><h1>Approval worklist</h1><p class="lede">Review reports assigned to your role. This list refreshes automatically every 15 seconds.</p></div><div class="header-actions">${operationsLink}</div></div><section class="card"><div id="approval-worklist" hx-get="/fragments/approvals" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`,
  );
};
