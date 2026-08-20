import { forbidden, requireRole, type Claims } from "../auth";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";

export async function opsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const results = await new ReportsRepository(env.DB).listNeedingAttention();
  return html(results.length ? `<div class="ops-list">${results.map(report => `<article class="ops-card"><strong>${escape(report.id)}</strong><span>${escape(report.status)}${report.validation_error_code ? ` · ${escape(report.validation_error_code)}` : ""}${report.escalated_at ? ` · overdue; escalation role: ${escape(report.escalation_target_role ?? "unassigned")}` : ""}${report.credit_note_status ? ` · credit note: ${escape(report.credit_note_status)}` : ""}</span></article>`).join("")}</div>` : "<p class=\"empty-state\">No stuck reports.</p>");
}

export function opsPage(claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting operations</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Quality operations</span></header><main class="page"><div class="page-header"><div><p class="eyebrow">Operations</p><h1>Reports needing attention</h1><p class="lede">Validation/sync errors, pending or failed ERP writes, and overdue approvals.</p></div><div class="header-actions"><a class="button button-secondary" href="/approvals">Approval worklist</a></div></div><section class="card"><div hx-get="/fragments/ops" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`);
}
