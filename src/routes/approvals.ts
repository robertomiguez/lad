import { forbidden, requireRole, type Claims } from "../auth";
import {
  APPROVAL_ROLES,
  ROLE,
  canAccessStore as roleCanAccessStore,
  roleLabel,
  type ApprovalRole,
} from "../domain/roles";
import { REPORT_STATUS } from "../domain/reports";
import { jsonError, jsonResponse } from "../lib/http";
import { decideWorkflow, reconcilePendingWorkflow, workflowDecisionStatus } from "../lib/workflow-client";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";
import { approvalWorklistView, approvalsPageView } from "../views/approvals";

async function approvalWorklist(env: Env, claims: Claims, notice?: string) {
  const reports = new ReportsRepository(env.DB);
  const [assignedReports, escalatedRegionalReports] = await Promise.all([
    reports.listForApproval(claims.role as ApprovalRole, claims.store_id),
    claims.role === ROLE.quality ? reports.listEscalatedRegionalForQuality() : Promise.resolve([]),
  ]);
  return approvalWorklistView(assignedReports, notice, escalatedRegionalReports);
}

export async function approvalsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, APPROVAL_ROLES)) return forbidden();
  return approvalWorklist(env, claims);
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
  if (!report) return jsonError("Report not found", 404);
  if (!roleCanAccessStore(claims.role, claims.store_id, report.store_id)) return forbidden();
  const assignedStatus =
    claims.role === ROLE.regionalManager ? REPORT_STATUS.pendingRegional : REPORT_STATUS.pendingQuality;
  if (report.status !== assignedStatus) {
    if (request.headers.get("HX-Request") === "true") {
      const message =
        report.status === REPORT_STATUS.pendingQuality
          ? "This report has moved to Quality review and is no longer assigned to you."
          : report.status === REPORT_STATUS.pendingRegional
            ? "This report is still waiting for Regional review."
            : "This report has already been decided and is no longer awaiting approval.";
      return approvalWorklist(env, claims, message);
    }
    return forbidden();
  }

  let input: { decision?: "approve" | "reject"; reason?: string };
  try {
    input = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return jsonError("Invalid decision", 422);
  }
  if (input.decision !== "approve" && input.decision !== "reject")
    return jsonError("Decision must be approve or reject", 422);

  let response = await decideWorkflow(
    env,
    reportId,
    { role: claims.role as ApprovalRole, actor: claims.user_id, decision: input.decision, reason: input.reason },
    correlationId,
  );
  if (!response.ok && response.error === "approval_not_assigned_to_role") {
    const restored = await reconcilePendingWorkflow(env, reportId, assignedStatus);
    if (restored) {
      response = await decideWorkflow(
        env,
        reportId,
        { role: claims.role as ApprovalRole, actor: claims.user_id, decision: input.decision, reason: input.reason },
        correlationId,
      );
    }
  }
  if (!response.ok) return jsonError(response.error, workflowDecisionStatus(response.error));
  if (request.headers.get("HX-Request") === "true") return approvalsFragment(env, claims);

  const updated = await reports.findDecisionResult(reportId);
  return jsonResponse({
    id: updated!.id,
    status: updated!.status,
    totalAmountCents: updated!.total_amount,
    rejectionReason: updated!.rejection_reason,
  });
}
