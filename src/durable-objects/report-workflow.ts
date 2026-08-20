import { DurableObject } from "cloudflare:workers";
import { REPORT_STATUS, isPendingApprovalStatus, type WorkflowStatus } from "../domain/reports";
import { ROLE, type ApprovalRole } from "../domain/roles";
import { logTransition } from "../lib/observability";
import { initialWorkflowStatus, statusAfterRegionalApproval } from "../lib/workflow-policy";
import { ReportsRepository } from "../repositories/reports";

export type WorkflowState = {
  reportId: string;
  storeId: string;
  totalAmountCents: number;
  status: WorkflowStatus;
  escalated?: boolean;
  escalationTargetRole?: ApprovalRole;
  erpEnqueued?: boolean;
};

export type WorkflowInitialization = {
  reportId: string;
  storeId: string;
  totalAmountCents: number;
};

export type WorkflowDecision = {
  role: ApprovalRole;
  actor: string;
  decision: "approve" | "reject";
  reason?: string;
};

export type WorkflowDecisionError =
  "workflow_not_initialized" | "approval_not_assigned_to_role" | "rejection_reason_required";

export type WorkflowDecisionResult =
  { ok: true; workflow: WorkflowState } | { ok: false; error: WorkflowDecisionError };

export interface WorkflowEnv {
  DB: D1Database;
  ERP_WRITE_QUEUE: Queue;
  AUTO_APPROVE_BELOW_REGIONAL?: string;
  ESCALATION_DEMO_DELAY_SECONDS?: string;
}

export const REAL_ESCALATION_WORKING_DAYS = 3;

export class ReportWorkflow extends DurableObject<WorkflowEnv> {
  async initialize(input: WorkflowInitialization, correlationId: string): Promise<WorkflowState> {
    const existing = await this.ctx.storage.get<WorkflowState>("workflow");
    if (existing) return existing;

    const autoApprove = this.env.AUTO_APPROVE_BELOW_REGIONAL !== "false";
    const status: WorkflowState["status"] = initialWorkflowStatus(input.totalAmountCents, autoApprove);
    const workflow: WorkflowState = { ...input, status };
    await this.transition(workflow, correlationId, "system", REPORT_STATUS.submitted);
    if (isPendingApprovalStatus(status)) await this.scheduleEscalation();
    return workflow;
  }

  async decide(input: WorkflowDecision, correlationId: string): Promise<WorkflowDecisionResult> {
    const current = await this.ctx.storage.get<WorkflowState>("workflow");
    if (!current) return { ok: false, error: "workflow_not_initialized" };

    const previousStatus = current.status;
    const correctRole =
      (current.status === REPORT_STATUS.pendingRegional && input.role === ROLE.regionalManager) ||
      (current.status === REPORT_STATUS.pendingQuality && input.role === ROLE.quality);
    if (!correctRole) return { ok: false, error: "approval_not_assigned_to_role" };

    if (input.decision === "reject") {
      if (!input.reason?.trim()) return { ok: false, error: "rejection_reason_required" };
      current.status = REPORT_STATUS.rejected;
      current.escalated = false;
      current.escalationTargetRole = undefined;
      await this.transition(current, correlationId, input.actor, previousStatus, input.reason.trim());
      await this.ctx.storage.deleteAlarm();
      return { ok: true, workflow: current };
    }

    current.status =
      current.status === REPORT_STATUS.pendingRegional
        ? statusAfterRegionalApproval(current.totalAmountCents)
        : REPORT_STATUS.approved;
    current.escalated = false;
    current.escalationTargetRole = undefined;
    await this.transition(current, correlationId, input.actor, previousStatus);
    if (current.status === REPORT_STATUS.pendingQuality) await this.scheduleEscalation();
    else await this.ctx.storage.deleteAlarm();
    return { ok: true, workflow: current };
  }

  async alarm() {
    const current = await this.ctx.storage.get<WorkflowState>("workflow");
    if (!current || !isPendingApprovalStatus(current.status) || current.escalated) return;

    // The POC has no deputy hierarchy. Escalate to the quality role as a role,
    // never to an individual user; production ownership remains an open decision.
    current.escalated = true;
    current.escalationTargetRole = ROLE.quality;
    const timestamp = new Date().toISOString();
    await new ReportsRepository(this.env.DB).markEscalated(
      current.reportId,
      current.status,
      current.escalationTargetRole,
      timestamp,
    );
    logTransition({
      reportId: current.reportId,
      correlationId: `alarm-${current.reportId}`,
      fromStatus: current.status,
      toStatus: "escalated",
      actor: "system",
      component: "workflow",
    });
    await this.ctx.storage.put("workflow", current);
  }

  private async scheduleEscalation() {
    const seconds = Math.max(1, Number(this.env.ESCALATION_DEMO_DELAY_SECONDS ?? "120"));
    await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
  }

  private async transition(
    workflow: WorkflowState,
    correlationId: string,
    actor: string,
    fromStatus: string,
    rejectionReason?: string,
  ) {
    const timestamp = new Date().toISOString();
    await new ReportsRepository(this.env.DB).transitionWorkflow(
      workflow.reportId,
      workflow.status,
      rejectionReason,
      timestamp,
    );
    if (workflow.status === REPORT_STATUS.approved && !workflow.erpEnqueued) {
      // Queue payloads deliberately contain no business state. The consumer reads
      // the current D1 report before writing the mock ERP credit note.
      await this.env.ERP_WRITE_QUEUE.send({ reportId: workflow.reportId, correlationId });
      workflow.erpEnqueued = true;
    }
    await this.ctx.storage.put("workflow", workflow);
    logTransition({
      reportId: workflow.reportId,
      correlationId,
      fromStatus,
      toStatus: workflow.status,
      actor,
      component: "workflow",
      reason: rejectionReason,
    });
  }
}
