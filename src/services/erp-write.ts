import { logError, logTransition, RETRY_LIMITS } from "../lib/observability";
import { REPORT_STATUS } from "../domain/reports";
import { CreditNotesRepository } from "../repositories/credit-notes";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";

export async function processErpWriteQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const { reportId, correlationId = crypto.randomUUID() } = message.body as {
      reportId?: string;
      correlationId?: string;
    };
    if (!reportId) {
      message.ack();
      continue;
    }
    const maxRetries = Math.max(0, Number(env.ERP_MAX_RETRIES ?? String(RETRY_LIMITS.erpDefaultMaxRetries)));
    const reports = new ReportsRepository(env.DB);
    const creditNotes = new CreditNotesRepository(env.DB);
    const failPermanently = async (reason: string) => {
      await env.DB.batch([
        creditNotes.markFailed(reportId),
        reports.markErpErrorStatement(reportId, new Date().toISOString()),
      ]);
      logTransition({
        reportId,
        correlationId,
        fromStatus: REPORT_STATUS.creditNoteProcessing,
        toStatus: REPORT_STATUS.erpError,
        actor: "system",
        component: "erp-queue",
        reason,
      });
      message.ack();
    };
    try {
      const report = await reports.findForErp(reportId);
      if (!report) {
        message.ack();
        continue;
      }
      let creditNote = await creditNotes.findByReportId(reportId);
      if (!creditNote) {
        const creditNoteId = crypto.randomUUID();
        await env.DB.batch([
          creditNotes.createPending(creditNoteId, reportId),
          reports.markCreditNoteProcessingStatement(reportId, new Date().toISOString()),
        ]);
        logTransition({
          reportId,
          correlationId,
          fromStatus: report.status,
          toStatus: REPORT_STATUS.creditNoteProcessing,
          actor: "system",
          component: "erp-queue",
        });
        creditNote = await creditNotes.findByReportId(reportId);
      }
      if (!creditNote || creditNote.status === "created" || creditNote.status === "failed") {
        message.ack();
        continue;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, Number(env.ERP_SIMULATED_DELAY_MS ?? "100"))),
      );
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
        creditNotes.markCreated(reportId, `ERP-${reportId}`),
        reports.markCompletedStatement(reportId, new Date().toISOString()),
      ]);
      logTransition({
        reportId,
        correlationId,
        fromStatus: REPORT_STATUS.creditNoteProcessing,
        toStatus: REPORT_STATUS.completed,
        actor: "system",
        component: "erp-queue",
      });
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
