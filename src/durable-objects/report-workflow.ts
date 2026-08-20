import { logTransition } from "../lib/observability";
import { initialWorkflowStatus, statusAfterRegionalApproval } from "../lib/workflow-policy";
import { ROLE, type ApprovalRole } from "../domain/roles";
import { REPORT_STATUS, isPendingApprovalStatus, type WorkflowStatus } from "../domain/reports";
import { ReportsRepository } from "../repositories/reports";

type WorkflowState = { reportId: string; storeId: string; totalAmountCents: number; status: WorkflowStatus; escalated?: boolean; escalationTargetRole?: ApprovalRole; erpEnqueued?: boolean };
export interface WorkflowEnv { DB: D1Database; ERP_WRITE_QUEUE: Queue; AUTO_APPROVE_BELOW_REGIONAL?: string; ESCALATION_DEMO_DELAY_SECONDS?: string; }
export const REAL_ESCALATION_WORKING_DAYS = 3;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export class ReportWorkflow implements DurableObject {
  constructor(private state: DurableObjectState, private env: WorkflowEnv) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const correlationId = request.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
    if (request.method === "POST" && path === "/initialize") return this.initialize(await request.json() as { reportId: string; storeId: string; totalAmountCents: number }, correlationId);
    if (request.method === "POST" && path === "/decision") return this.decide(await request.json() as { role: ApprovalRole; actor: string; decision: "approve" | "reject"; reason?: string }, correlationId);
    if (request.method === "GET" && path === "/state") return json(await this.state.storage.get<WorkflowState>("workflow") ?? { error: "workflow_not_initialized" }, (await this.state.storage.get("workflow")) ? 200 : 404);
    return json({ error: "not_found" }, 404);
  }

  private async initialize(input: { reportId: string; storeId: string; totalAmountCents: number }, correlationId: string) {
    const existing = await this.state.storage.get<WorkflowState>("workflow");
    if (existing) return json(existing);
    const autoApprove = this.env.AUTO_APPROVE_BELOW_REGIONAL !== "false";
    const status: WorkflowState["status"] = initialWorkflowStatus(input.totalAmountCents, autoApprove);
    const workflow: WorkflowState = { ...input, status };
    await this.transition(workflow, correlationId, "system", REPORT_STATUS.submitted);
    if (isPendingApprovalStatus(status)) await this.scheduleEscalation();
    return json(workflow, 201);
  }

  private async decide(input: { role: ApprovalRole; actor: string; decision: "approve" | "reject"; reason?: string }, correlationId: string) {
    const current = await this.state.storage.get<WorkflowState>("workflow");
    if (!current) return json({ error: "workflow_not_initialized" }, 409);
    const previousStatus = current.status;
    const correctRole = (current.status === REPORT_STATUS.pendingRegional && input.role === ROLE.regionalManager) || (current.status === REPORT_STATUS.pendingQuality && input.role === ROLE.quality);
    if (!correctRole) return json({ error: "approval_not_assigned_to_role" }, 403);
    if (input.decision === "reject") {
      if (!input.reason?.trim()) return json({ error: "rejection_reason_required" }, 422);
      current.status = REPORT_STATUS.rejected;
      current.escalated = false;
      current.escalationTargetRole = undefined;
      await this.transition(current, correlationId, input.actor, previousStatus, input.reason.trim());
      await this.state.storage.deleteAlarm();
      return json(current);
    }
    current.status = current.status === REPORT_STATUS.pendingRegional ? statusAfterRegionalApproval(current.totalAmountCents) : REPORT_STATUS.approved;
    current.escalated = false;
    current.escalationTargetRole = undefined;
    await this.transition(current, correlationId, input.actor, previousStatus);
    if (current.status === REPORT_STATUS.pendingQuality) await this.scheduleEscalation(); else await this.state.storage.deleteAlarm();
    return json(current);
  }

  async alarm() {
    const current = await this.state.storage.get<WorkflowState>("workflow");
    if (!current || !isPendingApprovalStatus(current.status) || current.escalated) return;
    // The POC has no deputy hierarchy. Escalate to the quality role as a role,
    // never to an individual user; production ownership remains an open decision.
    current.escalated = true;
    current.escalationTargetRole = ROLE.quality;
    const timestamp = new Date().toISOString();
    await new ReportsRepository(this.env.DB).markEscalated(current.reportId, current.status, current.escalationTargetRole, timestamp);
    logTransition({ reportId: current.reportId, correlationId: `alarm-${current.reportId}`, fromStatus: current.status, toStatus: "escalated", actor: "system", component: "workflow" });
    await this.state.storage.put("workflow", current);
  }

  private async scheduleEscalation() {
    const seconds = Math.max(1, Number(this.env.ESCALATION_DEMO_DELAY_SECONDS ?? "120"));
    await this.state.storage.setAlarm(Date.now() + seconds * 1000);
  }

  private async transition(workflow: WorkflowState, correlationId: string, actor: string, fromStatus: string, rejectionReason?: string) {
    const timestamp = new Date().toISOString();
    await new ReportsRepository(this.env.DB).transitionWorkflow(workflow.reportId, workflow.status, rejectionReason, timestamp);
    if (workflow.status === REPORT_STATUS.approved && !workflow.erpEnqueued) {
      // Queue payloads deliberately contain no business state. The consumer reads
      // the current D1 report before writing the mock ERP credit note.
      await this.env.ERP_WRITE_QUEUE.send({ reportId: workflow.reportId, correlationId });
      workflow.erpEnqueued = true;
    }
    await this.state.storage.put("workflow", workflow);
    logTransition({ reportId: workflow.reportId, correlationId, fromStatus, toStatus: workflow.status, actor, component: "workflow", reason: rejectionReason });
  }
}
