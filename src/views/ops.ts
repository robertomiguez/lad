import { REPORT_STATUS } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { OpsReport } from "../repositories/reports";
import { pageDocument, pageHeaderView, secondaryLinkView, topBarView } from "./layout";

export const opsWorklistView = (reports: OpsReport[]) =>
  html(
    reports.length
      ? `<div class="ops-list">${reports
          .map(
            (report) =>
              `<article class="ops-card"><strong>${escape(report.id)}</strong><span>${escape(report.status)}${report.validation_error_code ? ` · ${escape(report.validation_error_code)}` : ""}${report.escalated_at ? ` · overdue; escalation role: ${escape(report.escalation_target_role ?? "unassigned")}` : ""}${report.credit_note_status ? ` · credit note: ${escape(report.credit_note_status)}` : ""}</span>${report.status === REPORT_STATUS.erpError && report.credit_note_status === "failed" ? `<form hx-post="/api/reports/${encodeURIComponent(report.id)}/retry-erp" hx-target="#ops-worklist" hx-swap="innerHTML"><button>Retry ERP write</button></form>` : ""}</article>`,
          )
          .join("")}</div>`
      : '<p class="empty-state">No stuck reports.</p>',
  );

export const opsPageView = () =>
  pageDocument({
    title: "Damage Reporting operations",
    scripts: [{ src: "https://unpkg.com/htmx.org@2.0.4" }],
    body: `${topBarView({ session: "Quality operations" })}<main class="page">${pageHeaderView({ eyebrow: "Operations", title: "Reports needing attention", lede: "Validation/sync errors, pending or failed ERP writes, and overdue approvals.", actions: secondaryLinkView("/approvals", "Approval worklist") })}<section class="card"><div id="ops-worklist" hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main>`,
  });
