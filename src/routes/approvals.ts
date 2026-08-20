import { forbidden, requireRole, type Claims } from "../auth";
import {
  APPROVAL_ROLES,
  ROLE,
  canAccessStore as roleCanAccessStore,
  roleLabel,
  type ApprovalRole,
} from "../domain/roles";
import { REPORT_STATUS } from "../domain/reports";
import { escape, html } from "../lib/http";
import { decideWorkflow, workflowDecisionStatus } from "../lib/workflow-client";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";

export async function approvalsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  const results = await new ReportsRepository(env.DB).listForApproval(claims.role as ApprovalRole, claims.store_id);
  return html(
    results.length
      ? `<div class="worklist">${results.map((report) => `<article class="approval-card"><div class="approval-meta"><span class="report-id">${escape(report.id)}</span><span class="amount">CHF ${(report.total_amount / 100).toFixed(2)}</span>${report.escalated_at ? `<mark>Escalated to ${escape(report.escalation_target_role ?? "fallback role")}</mark>` : ""}</div><div class="approval-actions"><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><input type="hidden" name="decision" value="approve"><button>Approve</button></form><form hx-post="/api/reports/${encodeURIComponent(report.id)}/decision" hx-target="#approval-worklist" hx-swap="innerHTML"><label><span class="visually-hidden">Rejection reason</span><input name="reason" placeholder="Rejection reason" required></label><input type="hidden" name="decision" value="reject"><button>Reject</button></form></div></article>`).join("")}</div>`
      : '<p class="empty-state">No approval work currently assigned.</p>',
  );
}

export function approvalsPage(claims: Claims) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  const approverRoleLabel = roleLabel(claims.role);
  const operationsLink =
    claims.role === ROLE.quality ? `<a class="button button-secondary" href="/ops">Operations</a>` : "";
  return html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approval worklist</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Signed in as <strong>${escape(approverRoleLabel)}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">Approval queue</p><h1>Approval worklist</h1><p class="lede">Review reports assigned to your role. This list refreshes automatically every 15 seconds.</p></div><div class="header-actions">${operationsLink}</div></div><section class="card"><div id="approval-worklist" hx-get="/fragments/approvals" hx-trigger="load, every 15s" hx-swap="innerHTML"></div></section></main></html>`,
  );
}

export async function decideReport(
  request: Request,
  env: Env,
  claims: Claims,
  reportId: string,
  correlationId: string,
) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  const reports = new ReportsRepository(env.DB);
  const report = await reports.findDecisionTarget(reportId);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  if (
    !roleCanAccessStore(claims.role, claims.store_id, report.store_id) ||
    (claims.role === ROLE.regionalManager && report.status !== REPORT_STATUS.pendingRegional) ||
    (claims.role === ROLE.quality && report.status !== REPORT_STATUS.pendingQuality)
  )
    return forbidden();

  let input: { decision?: "approve" | "reject"; reason?: string };
  try {
    input = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return Response.json({ error: "Invalid decision" }, { status: 422 });
  }
  if (input.decision !== "approve" && input.decision !== "reject")
    return Response.json({ error: "Decision must be approve or reject" }, { status: 422 });

  const response = await decideWorkflow(
    env,
    reportId,
    { role: claims.role as ApprovalRole, actor: claims.user_id, decision: input.decision, reason: input.reason },
    correlationId,
  );
  if (!response.ok) return Response.json({ error: response.error }, { status: workflowDecisionStatus(response.error) });
  if (request.headers.get("HX-Request") === "true") return approvalsFragment(env, claims);

  const updated = await reports.findDecisionResult(reportId);
  return Response.json({
    id: updated!.id,
    status: updated!.status,
    totalAmountCents: updated!.total_amount,
    rejectionReason: updated!.rejection_reason,
  });
}
