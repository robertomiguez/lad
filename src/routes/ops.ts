import { forbidden, requireRole, type Claims } from "../auth";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import { ReportsRepository } from "../repositories/reports";
import { CreditNotesRepository } from "../repositories/credit-notes";
import { REPORT_STATUS } from "../domain/reports";
import { logTransition } from "../lib/observability";
import type { Env } from "../types";

export async function opsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const results = await new ReportsRepository(env.DB).listNeedingAttention();
  return html(
    results.length
      ? `<div class="ops-list">${results.map((report) => `<article class="ops-card"><strong>${escape(report.id)}</strong><span>${escape(report.status)}${report.validation_error_code ? ` · ${escape(report.validation_error_code)}` : ""}${report.escalated_at ? ` · overdue; escalation role: ${escape(report.escalation_target_role ?? "unassigned")}` : ""}${report.credit_note_status ? ` · credit note: ${escape(report.credit_note_status)}` : ""}</span>${report.status === REPORT_STATUS.erpError && report.credit_note_status === "failed" ? `<form hx-post="/api/reports/${encodeURIComponent(report.id)}/retry-erp" hx-target="#ops-worklist" hx-swap="innerHTML"><button>Retry ERP write</button></form>` : ""}</article>`).join("")}</div>`
      : '<p class="empty-state">No stuck reports.</p>',
  );
}

export function opsPage(claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  return html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting operations</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Quality operations</span></header><main class="page"><div class="page-header"><div><p class="eyebrow">Operations</p><h1>Reports needing attention</h1><p class="lede">Validation/sync errors, pending or failed ERP writes, and overdue approvals.</p></div><div class="header-actions"><a class="button button-secondary" href="/approvals">Approval worklist</a></div></div><section class="card"><div id="ops-worklist" hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`,
  );
}

export async function retryErpWrite(env: Env, claims: Claims, reportId: string, correlationId: string) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const reports = new ReportsRepository(env.DB);
  const creditNotes = new CreditNotesRepository(env.DB);
  const report = await reports.findForErp(reportId);
  const creditNote = await creditNotes.findByReportId(reportId);
  if (report?.status !== REPORT_STATUS.erpError || creditNote?.status !== "failed")
    return Response.json({ error: "ERP retry is not available" }, { status: 409 });
  await env.DB.batch([
    creditNotes.retryFailedStatement(reportId),
    reports.retryErpStatement(reportId, new Date().toISOString()),
  ]);
  await env.ERP_WRITE_QUEUE.send({ reportId, correlationId });
  logTransition({
    reportId,
    correlationId,
    fromStatus: REPORT_STATUS.erpError,
    toStatus: REPORT_STATUS.creditNoteProcessing,
    actor: claims.user_id,
    component: "worker",
  });
  return opsFragment(env, claims);
}
