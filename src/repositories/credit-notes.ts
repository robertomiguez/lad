export type CreditNote = { id: string; status: string };

export class CreditNotesRepository {
  constructor(private readonly db: D1Database) {}

  findByReportId(reportId: string) {
    return this.db
      .prepare("SELECT id, status FROM credit_notes WHERE report_id = ?")
      .bind(reportId)
      .first<CreditNote>();
  }

  createPending(id: string, reportId: string) {
    return this.db
      .prepare(
        "INSERT OR IGNORE INTO credit_notes (id, report_id, status, erp_document_id) VALUES (?, ?, 'pending', NULL)",
      )
      .bind(id, reportId);
  }

  markFailed(reportId: string) {
    return this.db.prepare("UPDATE credit_notes SET status = 'failed' WHERE report_id = ?").bind(reportId);
  }

  markCreated(reportId: string, erpDocumentId: string) {
    return this.db
      .prepare("UPDATE credit_notes SET status = 'created', erp_document_id = ? WHERE report_id = ?")
      .bind(erpDocumentId, reportId);
  }

  retryFailedStatement(reportId: string) {
    return this.db
      .prepare(
        "UPDATE credit_notes SET status = 'pending', erp_document_id = NULL WHERE report_id = ? AND status = 'failed'",
      )
      .bind(reportId);
  }
}
