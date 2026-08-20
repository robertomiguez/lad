import type {
  ReportWorkflow,
  WorkflowDecision,
  WorkflowDecisionResult,
  WorkflowInitialization,
} from "../durable-objects/report-workflow";
import type { Env, Submission } from "../types";

export const reportWorkflow = (env: Env, id: string): DurableObjectStub<ReportWorkflow> => env.REPORT_DO.getByName(id);

const initializationFrom = (submission: Submission): WorkflowInitialization => ({
  reportId: submission.id,
  storeId: submission.storeId,
  totalAmountCents: submission.totalAmountCents,
});

export async function initializeWorkflow(env: Env, submission: Submission, correlationId: string) {
  try {
    await reportWorkflow(env, submission.id).initialize(initializationFrom(submission), correlationId);
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

export const workflowDecisionStatus = (error: Exclude<WorkflowDecisionResult, { ok: true }>["error"]) =>
  ({
    workflow_not_initialized: 409,
    approval_not_assigned_to_role: 403,
    rejection_reason_required: 422,
  })[error];
