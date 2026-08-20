import { forbidden, requireRole, type Claims } from "../auth";
import {
  APPROVAL_ROLES,
  ROLE,
  canAccessStore as roleCanAccessStore,
  roleLabel,
  type ApprovalRole,
} from "../domain/roles";
import { REPORT_STATUS } from "../domain/reports";
import { decideWorkflow, workflowDecisionStatus } from "../lib/workflow-client";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";
import { approvalWorklistView, approvalsPageView } from "../views/approvals";

export async function approvalsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  const results = await new ReportsRepository(env.DB).listForApproval(claims.role as ApprovalRole, claims.store_id);
  return approvalWorklistView(results);
}

export function approvalsPage(claims: Claims) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  const approverRoleLabel = roleLabel(claims.role);
  return approvalsPageView(approverRoleLabel, claims.role === ROLE.quality);
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
