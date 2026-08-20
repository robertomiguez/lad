import { forbidden, requireRole, type Claims } from "../auth";
import { REPORT_STATUS } from "../domain/reports";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import type { Env } from "../types";

export async function opsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const { results } = await env.DB.prepare("SELECT r.id, r.status, r.validation_error_code, r.escalated_at, r.escalation_target_role, c.status AS credit_note_status FROM reports r LEFT JOIN credit_notes c ON c.report_id = r.id WHERE r.status IN (?, ?) OR (r.status = ? AND c.status = 'pending') OR (r.escalated_at IS NOT NULL AND r.status IN (?, ?)) ORDER BY r.updated_at ASC").bind(REPORT_STATUS.syncError, REPORT_STATUS.erpError, REPORT_STATUS.creditNoteProcessing, REPORT_STATUS.pendingRegional, REPORT_STATUS.pendingQuality).all<{ id: string; status: string; validation_error_code: string | null; escalated_at: string | null; escalation_target_role: string | null; credit_note_status: string | null }>();
  return html(results.length ? `<div class="ops-list">${results.map(report => `<article class="ops-card"><strong>${escape(report.id)}</strong><span>${escape(report.status)}${report.validation_error_code ? ` · ${escape(report.validation_error_code)}` : ""}${report.escalated_at ? ` · overdue; escalation role: ${escape(report.escalation_target_role ?? "unassigned")}` : ""}${report.credit_note_status ? ` · credit note: ${escape(report.credit_note_status)}` : ""}</span></article>`).join("")}</div>` : "<p class=\"empty-state\">No stuck reports.</p>");
}

export function opsPage(claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting operations</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Quality operations</span></header><main class="page"><div class="page-header"><div><p class="eyebrow">Operations</p><h1>Reports needing attention</h1><p class="lede">Validation/sync errors, pending or failed ERP writes, and overdue approvals.</p></div><div class="header-actions"><a class="button button-secondary" href="/approvals">Approval worklist</a></div></div><section class="card"><div hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`);
}
