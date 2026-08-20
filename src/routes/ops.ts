import { forbidden, requireRole, type Claims } from "../auth";
import { ROLE } from "../domain/roles";
import { ReportsRepository } from "../repositories/reports";
import { CreditNotesRepository } from "../repositories/credit-notes";
import { REPORT_STATUS } from "../domain/reports";
import { jsonError } from "../lib/http";
import { logTransition } from "../lib/observability";
import type { Env } from "../types";
import { opsPageView, opsWorklistView } from "../views/ops";

export async function opsFragment(env: Env, claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const results = await new ReportsRepository(env.DB).listNeedingAttention();
  return opsWorklistView(results);
}

export function opsPage(claims: Claims) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  return opsPageView();
}

export async function retryErpWrite(env: Env, claims: Claims, reportId: string, correlationId: string) {
  if (!requireRole(claims, [ROLE.quality])) return forbidden();
  const reports = new ReportsRepository(env.DB);
  const creditNotes = new CreditNotesRepository(env.DB);
  const report = await reports.findForErp(reportId);
  const creditNote = await creditNotes.findByReportId(reportId);
  if (report?.status !== REPORT_STATUS.erpError || creditNote?.status !== "failed")
    return jsonError("ERP retry is not available", 409);
  await env.DB.batch([
    creditNotes.retryFailedStatement(reportId),
    reports.retryErpStatement(reportId, new Date().toISOString()),
  ]);
  await env.ERP_WRITE_QUEUE.send({ reportId, correlationId });
  logTransition({
    reportId,
    correlationId,
    fromStatus: REPORT_STATUS.erpError,
    toStatus: REPORT_STATUS.creditNoteProcessing,
    actor: claims.user_id,
    component: "worker",
  });
  return opsFragment(env, claims);
}
