import { logError, logTransition, RETRY_LIMITS } from "../lib/observability";
import { REPORT_STATUS } from "../domain/reports";
import type { Env } from "../types";

export async function processErpWriteQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const { reportId, correlationId = crypto.randomUUID() } = message.body as { reportId?: string; correlationId?: string };
    if (!reportId) {
      message.ack();
      continue;
    }
    const maxRetries = Math.max(0, Number(env.ERP_MAX_RETRIES ?? String(RETRY_LIMITS.erpDefaultMaxRetries)));
    const failPermanently = async (reason: string) => {
      await env.DB.batch([
        env.DB.prepare("UPDATE credit_notes SET status = 'failed' WHERE report_id = ?").bind(reportId),
        env.DB.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").bind(REPORT_STATUS.erpError, new Date().toISOString(), reportId)
      ]);
      logTransition({ reportId, correlationId, fromStatus: REPORT_STATUS.creditNoteProcessing, toStatus: REPORT_STATUS.erpError, actor: "system", component: "erp-queue", reason });
      message.ack();
    };
    try {
      const report = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?").bind(reportId).first<{ id: string; status: string }>();
      if (!report) {
        message.ack();
        continue;
      }
      let creditNote = await env.DB.prepare("SELECT id, status FROM credit_notes WHERE report_id = ?").bind(reportId).first<{ id: string; status: string }>();
      if (!creditNote) {
        const creditNoteId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO credit_notes (id, report_id, status, erp_document_id) VALUES (?, ?, 'pending', NULL)").bind(creditNoteId, reportId),
          env.DB.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ? AND status = ?").bind(REPORT_STATUS.creditNoteProcessing, new Date().toISOString(), reportId, REPORT_STATUS.approved)
        ]);
        logTransition({ reportId, correlationId, fromStatus: report.status, toStatus: REPORT_STATUS.creditNoteProcessing, actor: "system", component: "erp-queue" });
        creditNote = await env.DB.prepare("SELECT id, status FROM credit_notes WHERE report_id = ?").bind(reportId).first<{ id: string; status: string }>();
      }
      if (!creditNote || creditNote.status === "created" || creditNote.status === "failed") {
        message.ack();
        continue;
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Number(env.ERP_SIMULATED_DELAY_MS ?? "100"))));
      const shouldFail = Math.random() < Math.min(1, Math.max(0, Number(env.ERP_FAILURE_RATE ?? "0")));
      if (shouldFail) {
        if (message.attempts >= maxRetries) {
          await failPermanently("erp_retry_limit_exhausted");
        } else {
          message.retry();
        }
        continue;
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE credit_notes SET status = 'created', erp_document_id = ? WHERE report_id = ?").bind(`ERP-${reportId}`, reportId),
        env.DB.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").bind(REPORT_STATUS.completed, new Date().toISOString(), reportId)
      ]);
      logTransition({ reportId, correlationId, fromStatus: REPORT_STATUS.creditNoteProcessing, toStatus: REPORT_STATUS.completed, actor: "system", component: "erp-queue" });
      message.ack();
    } catch {
      logError(correlationId, "erp-queue", "queue_consumer_error", reportId);
      if (message.attempts >= maxRetries) {
        await failPermanently("queue_consumer_retry_limit_exhausted");
      } else {
        message.retry();
      }
    }
  }
}
