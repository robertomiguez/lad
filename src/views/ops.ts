import { REPORT_STATUS } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { OpsReport } from "../repositories/reports";

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
  html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting operations</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Quality operations</span></header><main class="page"><div class="page-header"><div><p class="eyebrow">Operations</p><h1>Reports needing attention</h1><p class="lede">Validation/sync errors, pending or failed ERP writes, and overdue approvals.</p></div><div class="header-actions"><a class="button button-secondary" href="/approvals">Approval worklist</a></div></div><section class="card"><div id="ops-worklist" hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`,
  );
