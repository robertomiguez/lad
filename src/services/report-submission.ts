import { forbidden, requireRole, type Claims } from "../auth";
import { REPORT_STATUS } from "../domain/reports";
import { APPROVAL_ROLES, ROLE, canAccessStore as roleCanAccessStore } from "../domain/roles";
import { jsonError, jsonResponse } from "../lib/http";
import { initializeWorkflow } from "../lib/workflow-client";
import { logError, logTransition } from "../lib/observability";
import {
  hasValidSubmissionShape,
  isJsonSubmissionRequest,
  parseSubmission,
  priceSubmission,
} from "../lib/submission-input";
import { CatalogRepository } from "../repositories/catalog";
import { ReportsRepository } from "../repositories/reports";
import type { Env } from "../types";
import {
  submissionErrorResponse,
  submissionStatusResponse,
  submissionValidationErrorResponse,
} from "../views/submission";

export async function createReport(request: Request, env: Env, claims: Claims, correlationId: string) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
  const jsonRequest = isJsonSubmissionRequest(request);
  const submission = await parseSubmission(request).catch(() => null);
  if (!submission)
    return submissionErrorResponse(jsonRequest, {
      status: 422,
      error: "Invalid report payload",
      message: "Please complete every required report and line-item field.",
    });

  const { id: reportId } = submission;
  const reports = new ReportsRepository(env.DB);
  const catalog = new CatalogRepository(env.DB);
  if (!hasValidSubmissionShape(submission, claims, request.headers.get("Idempotency-Key"))) {
    logError(correlationId, "worker", "invalid_payload", reportId);
    return submissionErrorResponse(jsonRequest, {
      status: 422,
      errorCode: "invalid_payload",
      message: "Please complete every required report and line-item field.",
    });
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
      const workflowResponse = await initializeWorkflow(
        env,
        { reportId: existing.id, storeId: existing.store_id, totalAmountCents: existing.total_amount },
        correlationId,
      );
      if (!workflowResponse)
        return submissionErrorResponse(jsonRequest, {
          status: 503,
          errorCode: "workflow_initialization_failed",
          message: "Report saved; retrying approval setup.",
        });
    }
    const recovered = await reports.findExistingForStore(reportId, claims.store_id);
    if (!recovered || recovered === "forbidden")
      return submissionErrorResponse(true, {
        status: 503,
        errorCode: "workflow_result_missing",
        message: "The saved report could not be retrieved.",
      });
    return submissionStatusResponse(jsonRequest, recovered, { message: "was already submitted." });
  }

  const pricing = await priceSubmission(catalog, submission);
  const timestamp = new Date().toISOString();
  if ("error" in pricing) {
    const errorCode = pricing.error;
    if (existing?.status === REPORT_STATUS.syncError) {
      await reports.updateValidationError(reportId, errorCode, timestamp);
      logError(correlationId, "worker", errorCode, reportId);
      const failed = { ...existing, validation_error_code: errorCode };
      return submissionValidationErrorResponse(jsonRequest, failed, `Report needs attention: ${errorCode}.`);
    }

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
    return submissionValidationErrorResponse(
      jsonRequest,
      { id: reportId, status: REPORT_STATUS.syncError, total_amount: 0, validation_error_code: errorCode },
      `Report needs attention: ${errorCode}.`,
    );
  }
  const pricedSubmission = pricing.submission;
  if (existing?.status === REPORT_STATUS.syncError) {
    try {
      await reports.recoverSyncError(pricedSubmission, timestamp);
      logTransition({
        reportId,
        correlationId,
        fromStatus: REPORT_STATUS.syncError,
        toStatus: REPORT_STATUS.submitted,
        actor: claims.user_id,
        component: "worker",
      });
      const workflowResponse = await initializeWorkflow(
        env,
        {
          reportId: pricedSubmission.id,
          storeId: pricedSubmission.storeId,
          totalAmountCents: pricedSubmission.totalAmountCents,
        },
        correlationId,
      );
      if (!workflowResponse)
        return submissionErrorResponse(jsonRequest, {
          status: 503,
          errorCode: "workflow_initialization_failed",
          message: "Report saved; retrying approval setup.",
        });
      const recovered = await reports.findExistingForStore(reportId, claims.store_id);
      if (!recovered || recovered === "forbidden")
        return submissionErrorResponse(true, {
          status: 503,
          errorCode: "workflow_recovery_missing",
          message: "The recovered report could not be retrieved.",
        });
      return submissionStatusResponse(jsonRequest, recovered, { message: "passed validation and was submitted." });
    } catch {
      return submissionErrorResponse(jsonRequest, {
        status: 422,
        errorCode: "validation_recovery_failed",
        message: "Unable to retry this report.",
      });
    }
  }

  try {
    await reports.createSubmittedReport(pricedSubmission, timestamp);
  } catch {
    const replay = await reports.findExistingForStore(reportId, claims.store_id);
    if (replay && replay !== "forbidden")
      return submissionStatusResponse(jsonRequest, replay, { message: "was already submitted." });
    return submissionErrorResponse(jsonRequest, {
      status: 422,
      errorCode: "save_failed",
      message: "Unable to save the report. Check the selected products and try again.",
    });
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
  const workflowResponse = await initializeWorkflow(
    env,
    {
      reportId: pricedSubmission.id,
      storeId: pricedSubmission.storeId,
      totalAmountCents: pricedSubmission.totalAmountCents,
    },
    correlationId,
  );
  if (!workflowResponse)
    return submissionErrorResponse(jsonRequest, {
      status: 503,
      errorCode: "workflow_initialization_failed",
      message: "Report saved but needs attention before approval.",
    });
  const created = await reports.findExistingForStore(reportId, claims.store_id);
  if (!created || created === "forbidden")
    return submissionErrorResponse(true, {
      status: 503,
      errorCode: "workflow_result_missing",
      message: "The saved report could not be retrieved.",
    });
  return submissionStatusResponse(jsonRequest, created, {
    status: 201,
    message: "submitted successfully.",
    headers: { "HX-Trigger": "reportsChanged" },
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
    return jsonResponse({ errorCode: "invalid_photo_payload" }, 422);
  const reports = new ReportsRepository(env.DB);
  const target = await reports.findPhotoTarget(reportId, lineItemId, claims.store_id);
  if (!target || target.photo_id !== photoId) return jsonResponse({ errorCode: "photo_target_not_found" }, 404);
  const existing = await reports.findPhotoStatus(photoId);
  if (existing?.status === "uploaded") return jsonResponse({ id: photoId, status: "uploaded" });
  const r2Key = `reports/${reportId}/${photoId}`;
  try {
    await reports.ensurePendingPhoto(photoId, lineItemId, r2Key);
    await env.PHOTOS.put(r2Key, request.body!, { httpMetadata: { contentType } });
    await reports.updatePhotoStatus(photoId, "uploaded", r2Key);
    return jsonResponse({ id: photoId, status: "uploaded" }, 201);
  } catch {
    await reports.updatePhotoStatus(photoId, "failed");
    logError(correlationId, "worker", "photo_upload_failed", reportId);
    return jsonResponse({ id: photoId, status: "failed", errorCode: "photo_upload_failed" }, 503);
  }
}

export async function getPhoto(env: Env, claims: Claims, reportId: string, lineItemId: string) {
  if (!requireRole(claims, [ROLE.store, ...APPROVAL_ROLES])) return forbidden();
  const reports = new ReportsRepository(env.DB);
  if (claims.role === ROLE.store) {
    const target = await reports.findPhotoTarget(reportId, lineItemId, claims.store_id);
    if (!target?.r2_key || target.photo_status !== "uploaded") return jsonError("Photo not found", 404);

    const photo = await env.PHOTOS.get(target.r2_key);
    if (!photo) return jsonError("Photo not found", 404);

    const headers = new Headers({ "cache-control": "private, max-age=60" });
    photo.writeHttpMetadata(headers);
    headers.set("etag", photo.httpEtag);
    return new Response(photo.body, { headers });
  }

  const target = await reports.findPhotoTargetForApproval(reportId, lineItemId);
  if (!target || !roleCanAccessStore(claims.role, claims.store_id, target.store_id)) return forbidden();
  if (!target?.r2_key || target.photo_status !== "uploaded") return jsonError("Photo not found", 404);

  const photo = await env.PHOTOS.get(target.r2_key);
  if (!photo) return jsonError("Photo not found", 404);

  const headers = new Headers({ "cache-control": "private, max-age=60" });
  photo.writeHttpMetadata(headers);
  headers.set("etag", photo.httpEtag);
  return new Response(photo.body, { headers });
}
