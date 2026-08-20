-- Align the POC's internal name with the reference case study. SQLite requires
-- rebuilding a table to change its CHECK constraint.
PRAGMA foreign_keys = OFF;

CREATE TABLE reports_next (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_sync', 'submitted', 'pending_regional', 'pending_quality', 'approved', 'rejected', 'credit_note_pending', 'completed', 'sync_error', 'erp_error')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validation_error_code TEXT,
  rejection_reason TEXT,
  escalated_at TEXT,
  escalation_target_role TEXT
);

INSERT INTO reports_next (
  id, store_id, reporter_id, status, total_amount, created_at, updated_at,
  validation_error_code, rejection_reason, escalated_at, escalation_target_role
)
SELECT
  id,
  store_id,
  reporter_id,
  CASE status WHEN 'credit_note_processing' THEN 'credit_note_pending' ELSE status END,
  total_amount,
  created_at,
  updated_at,
  validation_error_code,
  rejection_reason,
  escalated_at,
  escalation_target_role
FROM reports;

DROP TABLE reports;
ALTER TABLE reports_next RENAME TO reports;
CREATE INDEX reports_store_updated_idx ON reports(store_id, updated_at DESC);
CREATE INDEX reports_status_idx ON reports(status);

PRAGMA foreign_keys = ON;
