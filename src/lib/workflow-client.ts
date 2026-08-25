import type {
  ReportWorkflow,
  WorkflowDecision,
  WorkflowDecisionResult,
  WorkflowInitialization,
} from "../durable-objects/report-workflow";
import type { Env } from "../types";

export const reportWorkflow = (env: Env, id: string): DurableObjectStub<ReportWorkflow> => env.REPORT_DO.getByName(id);

export async function initializeWorkflow(env: Env, initialization: WorkflowInitialization, correlationId: string) {
  try {
    await reportWorkflow(env, initialization.reportId).initialize(initialization, correlationId);
    return true;
  } catch {
    return false;
  }
}

export const decideWorkflow = (
  env: Env,
  reportId: string,
  decision: WorkflowDecision,
  correlationId: string,
): Promise<WorkflowDecisionResult> => reportWorkflow(env, reportId).decide(decision, correlationId);

export const reconcilePendingWorkflow = (env: Env, reportId: string, status: "pending_regional" | "pending_quality") =>
  reportWorkflow(env, reportId).reconcilePendingStatus(status);

export const workflowDecisionStatus = (error: Exclude<WorkflowDecisionResult, { ok: true }>["error"]) =>
  ({
    workflow_not_initialized: 409,
    approval_not_assigned_to_role: 403,
    rejection_reason_required: 422,
  })[error];
