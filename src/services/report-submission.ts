import { forbidden, requireRole, type Claims } from "../auth";
import { REPORT_STATUS } from "../domain/reports";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import { initializeWorkflow } from "../lib/workflow-client";
import { logError, logTransition } from "../lib/observability";
import {
  hasValidSubmissionShape,
  isJsonSubmissionRequest,
  parseSubmission,
  validateSubmissionCatalog,
} from "../lib/submission-input";
import { CatalogRepository } from "../repositories/catalog";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";

const reportJson = (
  report: { id: string; status: string; total_amount: number; validation_error_code?: string | null },
  status = 200,
) =>
  Response.json(
    {
      id: report.id,
      status: report.status,
      totalAmountCents: report.total_amount,
      errorCode: report.validation_error_code ?? undefined,
    },
    { status },
  );

export async function createReport(request: Request, env: Env, claims: Claims, correlationId: string) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
  const jsonRequest = isJsonSubmissionRequest(request);
  const submission = await parseSubmission(request).catch(() => null);
  if (!submission)
    return jsonRequest
      ? Response.json({ error: "Invalid report payload" }, { status: 422 })
      : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422);

  const { id: reportId, totalAmountCents } = submission;
  const reports = new ReportsRepository(env.DB);
  const catalog = new CatalogRepository(env.DB);
  if (!hasValidSubmissionShape(submission, claims, request.headers.get("Idempotency-Key"))) {
    logError(correlationId, "worker", "invalid_payload", reportId);
    return jsonRequest
      ? Response.json({ errorCode: "invalid_payload" }, { status: 422 })
      : html(`<p class="error">Please complete every required report and line-item field.</p>`, 422);
  }

  const kvHit = await env.IDEMPOTENCY.get(`report:${reportId}`);
  const existing = kvHit
    ? await reports.findExistingForStore(reportId, claims.store_id)
    : (await reports.hasIdempotencyKey(reportId))
      ? await reports.findExistingForStore(reportId, claims.store_id)
      : null;
  if (existing === "forbidden") return forbidden();
  if (existing && existing.status !== REPORT_STATUS.syncError) {
    if (existing.status === REPORT_STATUS.submitted) {
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse)
        return jsonRequest
          ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 })
          : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
    }
    const recovered = await reports.findExistingForStore(reportId, claims.store_id);
    if (!recovered || recovered === "forbidden")
      return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
    return jsonRequest
      ? reportJson(recovered)
      : html(`<p role="status">Report <strong>${escape(recovered.id)}</strong> was already submitted.</p>`);
  }

  const errorCode = await validateSubmissionCatalog(catalog, submission);
  const timestamp = new Date().toISOString();
  if (existing?.status === REPORT_STATUS.syncError) {
    if (errorCode) {
      await reports.updateValidationError(reportId, errorCode, timestamp);
      logError(correlationId, "worker", errorCode, reportId);
      const failed = { ...existing, validation_error_code: errorCode };
      return jsonRequest
        ? reportJson(failed, 422)
        : html(`<p class="error">Report needs attention: ${escape(errorCode)}.</p>`, 422);
    }
    try {
      await reports.recoverSyncError(submission, timestamp);
      logTransition({
        reportId,
        correlationId,
        fromStatus: REPORT_STATUS.syncError,
        toStatus: REPORT_STATUS.submitted,
        actor: claims.user_id,
        component: "worker",
      });
      const workflowResponse = await initializeWorkflow(env, submission, correlationId);
      if (!workflowResponse)
        return jsonRequest
          ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 })
          : html(`<p class="error">Report saved; retrying approval setup.</p>`, 503);
      const recovered = await reports.findExistingForStore(reportId, claims.store_id);
      if (!recovered || recovered === "forbidden")
        return Response.json({ errorCode: "workflow_recovery_missing" }, { status: 503 });
      return jsonRequest
        ? reportJson(recovered)
        : html(`<p role="status">Report <strong>${escape(reportId)}</strong> passed validation and was submitted.</p>`);
    } catch {
      return jsonRequest
        ? Response.json({ errorCode: "validation_recovery_failed" }, { status: 422 })
        : html(`<p class="error">Unable to retry this report.</p>`, 422);
    }
  }

  if (errorCode) {
    await reports.createValidationFailure(submission, errorCode, timestamp);
    await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
    logTransition({
      reportId,
      correlationId,
      fromStatus: REPORT_STATUS.pendingSync,
      toStatus: REPORT_STATUS.syncError,
      actor: claims.user_id,
      component: "worker",
      reason: errorCode,
    });
    const failed = {
      id: reportId,
      status: REPORT_STATUS.syncError,
      total_amount: totalAmountCents,
      validation_error_code: errorCode,
    };
    return jsonRequest
      ? reportJson(failed, 422)
      : html(`<p class="error">Report needs attention: ${escape(errorCode)}.</p>`, 422);
  }

  try {
    await reports.createSubmittedReport(submission, timestamp);
  } catch {
    const replay = await reports.findExistingForStore(reportId, claims.store_id);
    if (replay && replay !== "forbidden")
      return jsonRequest
        ? reportJson(replay)
        : html(`<p role="status">Report <strong>${escape(replay.id)}</strong> was already submitted.</p>`);
    return jsonRequest
      ? Response.json({ errorCode: "save_failed" }, { status: 422 })
      : html(`<p class="error">Unable to save the report. Check the selected products and try again.</p>`, 422);
  }
  await env.IDEMPOTENCY.put(`report:${reportId}`, reportId, { expirationTtl: 86_400 });
  logTransition({
    reportId,
    correlationId,
    fromStatus: REPORT_STATUS.pendingSync,
    toStatus: REPORT_STATUS.submitted,
    actor: claims.user_id,
    component: "worker",
  });
  const workflowResponse = await initializeWorkflow(env, submission, correlationId);
  if (!workflowResponse)
    return jsonRequest
      ? Response.json({ errorCode: "workflow_initialization_failed" }, { status: 503 })
      : html(`<p class="error">Report saved but needs attention before approval.</p>`, 503);
  const created = await reports.findExistingForStore(reportId, claims.store_id);
  if (!created || created === "forbidden")
    return Response.json({ errorCode: "workflow_result_missing" }, { status: 503 });
  return jsonRequest
    ? reportJson(created, 201)
    : html(`<p role="status">Report <strong>${escape(reportId)}</strong> submitted successfully.</p>`, 201, {
        "HX-Trigger": "reportsChanged",
      });
}

export async function uploadPhoto(
  request: Request,
  env: Env,
  claims: Claims,
  reportId: string,
  lineItemId: string,
  correlationId: string,
) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
  const photoId = request.headers.get("X-Photo-Id") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(photoId) || !contentType.startsWith("image/"))
    return Response.json({ errorCode: "invalid_photo_payload" }, { status: 422 });
  const reports = new ReportsRepository(env.DB);
  const target = await reports.findPhotoTarget(reportId, lineItemId, claims.store_id);
  if (!target || target.photo_id !== photoId)
    return Response.json({ errorCode: "photo_target_not_found" }, { status: 404 });
  const existing = await reports.findPhotoStatus(photoId);
  if (existing?.status === "uploaded") return Response.json({ id: photoId, status: "uploaded" });
  const r2Key = `reports/${reportId}/${photoId}`;
  try {
    await reports.ensurePendingPhoto(photoId, lineItemId, r2Key);
    await env.PHOTOS.put(r2Key, request.body!, { httpMetadata: { contentType } });
    await reports.updatePhotoStatus(photoId, "uploaded", r2Key);
    return Response.json({ id: photoId, status: "uploaded" }, { status: 201 });
  } catch {
    await reports.updatePhotoStatus(photoId, "failed");
    logError(correlationId, "worker", "photo_upload_failed", reportId);
    return Response.json({ id: photoId, status: "failed", errorCode: "photo_upload_failed" }, { status: 503 });
  }
}
