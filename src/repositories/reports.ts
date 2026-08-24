import { REPORT_STATUS, type ReportStatus } from "../domain/reports";
import { ROLE, type ApprovalRole } from "../domain/roles";
import type { Submission } from "../domain/submission";

export type ExistingReport = {
  id: string;
  store_id: string;
  status: string;
  total_amount: number;
  validation_error_code: string | null;
};
export type StoreReport = { id: string; status: string; total_amount: number; created_at: string };
export type StoreReportDetail = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  rejection_reason: string | null;
  escalated_at: string | null;
  escalation_target_role: string | null;
};
export type StoreReportLineItem = {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  reason_code: string;
  description: string | null;
  photo_id: string | null;
  photo_status: string | null;
};
export type StoreReportStatus = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  skus: string | null;
  escalated_at: string | null;
  escalation_target_role: string | null;
  rejection_reason: string | null;
};
export type ApprovalReport = {
  id: string;
  store_id: string;
  status: string;
  total_amount: number;
  escalated_at: string | null;
  escalation_target_role: string | null;
};
export type DecisionReport = { store_id: string; status: string };
export type DecisionResult = { id: string; status: string; total_amount: number; rejection_reason: string | null };
export type OpsReport = {
  id: string;
  status: string;
  validation_error_code: string | null;
  escalated_at: string | null;
  escalation_target_role: string | null;
  credit_note_status: string | null;
};

export class ReportsRepository {
  constructor(private readonly db: D1Database) {}

  async hasIdempotencyKey(reportId: string) {
    return Boolean(await this.db.prepare("SELECT key FROM idempotency_keys WHERE key = ?").bind(reportId).first());
  }

  async findExistingForStore(reportId: string, storeId: string | null) {
    const report = await this.db
      .prepare("SELECT id, store_id, status, total_amount, validation_error_code FROM reports WHERE id = ?")
      .bind(reportId)
      .first<ExistingReport>();
    if (!report) return null;
    return report.store_id === storeId ? report : ("forbidden" as const);
  }

  async listForStore(storeId: string | null) {
    return (
      await this.db
        .prepare("SELECT id, status, total_amount, created_at FROM reports WHERE store_id = ? ORDER BY created_at DESC")
        .bind(storeId)
        .all<StoreReport>()
    ).results;
  }

  async findDetailForStore(reportId: string, storeId: string | null) {
    const report = await this.db
      .prepare(
        "SELECT id, status, total_amount, created_at, rejection_reason, escalated_at, escalation_target_role FROM reports WHERE id = ? AND store_id = ?",
      )
      .bind(reportId, storeId)
      .first<StoreReportDetail>();
    if (!report) return null;
    const items = await this.db
      .prepare(
        "SELECT li.id, li.product_id, p.sku, p.name AS product_name, li.quantity, li.reason_code, li.description, li.photo_id, ph.status AS photo_status FROM line_items li JOIN products p ON p.id = li.product_id LEFT JOIN photos ph ON ph.id = li.photo_id WHERE li.report_id = ? ORDER BY li.rowid ASC",
      )
      .bind(reportId)
      .all<StoreReportLineItem>();
    return { report, items: items.results };
  }

  async listStatusesForStore(storeId: string | null) {
    return (
      await this.db
        .prepare(
          "SELECT r.id, r.status, r.total_amount, r.created_at, GROUP_CONCAT(DISTINCT p.sku) AS skus, r.escalated_at, r.escalation_target_role, r.rejection_reason FROM reports r LEFT JOIN line_items li ON li.report_id = r.id LEFT JOIN products p ON p.id = li.product_id WHERE r.store_id = ? GROUP BY r.id ORDER BY r.updated_at DESC",
        )
        .bind(storeId)
        .all<StoreReportStatus>()
    ).results;
  }

  async listForApproval(role: ApprovalRole, storeId: string | null) {
    const query =
      role === ROLE.regionalManager
        ? this.db
            .prepare(
              "SELECT id, store_id, status, total_amount, escalated_at, escalation_target_role FROM reports WHERE store_id = ? AND status = ? ORDER BY updated_at ASC",
            )
            .bind(storeId, REPORT_STATUS.pendingRegional)
        : this.db
            .prepare(
              "SELECT id, store_id, status, total_amount, escalated_at, escalation_target_role FROM reports WHERE status = ? ORDER BY updated_at ASC",
            )
            .bind(REPORT_STATUS.pendingQuality);
    return (await query.all<ApprovalReport>()).results;
  }

  findDecisionTarget(reportId: string) {
    return this.db.prepare("SELECT store_id, status FROM reports WHERE id = ?").bind(reportId).first<DecisionReport>();
  }

  findDecisionResult(reportId: string) {
    return this.db
      .prepare("SELECT id, status, total_amount, rejection_reason FROM reports WHERE id = ?")
      .bind(reportId)
      .first<DecisionResult>();
  }

  async listNeedingAttention() {
    return (
      await this.db
        .prepare(
          "SELECT r.id, r.status, r.validation_error_code, r.escalated_at, r.escalation_target_role, c.status AS credit_note_status FROM reports r LEFT JOIN credit_notes c ON c.report_id = r.id WHERE r.status IN (?, ?) OR (r.status = ? AND c.status = 'pending') OR (r.escalated_at IS NOT NULL AND r.status IN (?, ?)) ORDER BY r.updated_at ASC",
        )
        .bind(
          REPORT_STATUS.syncError,
          REPORT_STATUS.erpError,
          REPORT_STATUS.creditNotePending,
          REPORT_STATUS.pendingRegional,
          REPORT_STATUS.pendingQuality,
        )
        .all<OpsReport>()
    ).results;
  }

  updateValidationError(reportId: string, errorCode: string, timestamp: string) {
    return this.db
      .prepare("UPDATE reports SET validation_error_code = ?, updated_at = ? WHERE id = ?")
      .bind(errorCode, timestamp, reportId)
      .run();
  }

  createValidationFailure(submission: Submission, errorCode: string, timestamp: string) {
    return this.db.batch([
      this.db.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(submission.id, timestamp),
      this.db
        .prepare(
          "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at, validation_error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          submission.id,
          submission.storeId,
          submission.reporterId,
          REPORT_STATUS.syncError,
          submission.totalAmountCents,
          timestamp,
          timestamp,
          errorCode,
        ),
    ]);
  }

  createSubmittedReport(submission: Submission, timestamp: string) {
    return this.db.batch([
      this.db.prepare("INSERT INTO idempotency_keys (key, first_seen_at) VALUES (?, ?)").bind(submission.id, timestamp),
      this.db
        .prepare(
          "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          submission.id,
          submission.storeId,
          submission.reporterId,
          REPORT_STATUS.pendingSync,
          submission.totalAmountCents,
          timestamp,
          timestamp,
        ),
      ...this.lineItemStatements(submission),
      this.db
        .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?")
        .bind(REPORT_STATUS.submitted, timestamp, submission.id),
    ]);
  }

  recoverSyncError(submission: Submission, timestamp: string) {
    return this.db.batch([
      ...this.lineItemStatements(submission),
      this.db
        .prepare("UPDATE reports SET status = ?, validation_error_code = NULL, updated_at = ? WHERE id = ?")
        .bind(REPORT_STATUS.submitted, timestamp, submission.id),
    ]);
  }

  private lineItemStatements(submission: Submission) {
    return [
      ...submission.items.map((item) =>
        this.db
          .prepare(
            "INSERT OR IGNORE INTO line_items (id, report_id, product_id, quantity, reason_code, description, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(item.id, submission.id, item.productId, item.quantity, item.reasonCode, item.description, item.photoId ?? null),
      ),
      ...submission.items
        .filter((item) => item.photoId)
        .map((item) =>
          this.db
            .prepare("INSERT OR IGNORE INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')")
            .bind(item.photoId!, item.id, `pending/${submission.id}/${item.photoId}`),
        ),
    ];
  }

  findPhotoTarget(reportId: string, lineItemId: string, storeId: string | null) {
    return this.db
      .prepare(
        "SELECT li.photo_id, ph.r2_key, ph.status AS photo_status FROM line_items li JOIN reports r ON r.id = li.report_id LEFT JOIN photos ph ON ph.id = li.photo_id WHERE li.id = ? AND li.report_id = ? AND r.store_id = ?",
      )
      .bind(lineItemId, reportId, storeId)
      .first<{ photo_id: string | null; r2_key: string | null; photo_status: string | null }>();
  }

  findPhotoStatus(photoId: string) {
    return this.db.prepare("SELECT status FROM photos WHERE id = ?").bind(photoId).first<{ status: string }>();
  }

  ensurePendingPhoto(photoId: string, lineItemId: string, r2Key: string) {
    return this.db
      .prepare("INSERT OR IGNORE INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, 'pending')")
      .bind(photoId, lineItemId, r2Key)
      .run();
  }

  updatePhotoStatus(photoId: string, status: "uploaded" | "failed", r2Key?: string) {
    return r2Key
      ? this.db.prepare("UPDATE photos SET r2_key = ?, status = ? WHERE id = ?").bind(r2Key, status, photoId).run()
      : this.db.prepare("UPDATE photos SET status = ? WHERE id = ?").bind(status, photoId).run();
  }

  transitionWorkflow(reportId: string, status: ReportStatus, rejectionReason: string | undefined, timestamp: string) {
    return this.db
      .prepare(
        "UPDATE reports SET status = ?, rejection_reason = ?, escalated_at = NULL, escalation_target_role = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(status, rejectionReason ?? null, timestamp, reportId)
      .run();
  }

  markEscalated(reportId: string, status: ReportStatus, escalationTargetRole: ApprovalRole, timestamp: string) {
    return this.db
      .prepare(
        "UPDATE reports SET escalated_at = ?, escalation_target_role = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .bind(timestamp, escalationTargetRole, timestamp, reportId, status)
      .run();
  }

  findForErp(reportId: string) {
    return this.db
      .prepare("SELECT id, status FROM reports WHERE id = ?")
      .bind(reportId)
      .first<{ id: string; status: string }>();
  }

  markErpErrorStatement(reportId: string, timestamp: string) {
    return this.db
      .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?")
      .bind(REPORT_STATUS.erpError, timestamp, reportId);
  }

  markCreditNotePendingStatement(reportId: string, timestamp: string) {
    return this.db
      .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .bind(REPORT_STATUS.creditNotePending, timestamp, reportId, REPORT_STATUS.approved);
  }

  retryErpStatement(reportId: string, timestamp: string) {
    return this.db
      .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .bind(REPORT_STATUS.creditNotePending, timestamp, reportId, REPORT_STATUS.erpError);
  }

  markCompletedStatement(reportId: string, timestamp: string) {
    return this.db
      .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?")
      .bind(REPORT_STATUS.completed, timestamp, reportId);
  }
}
