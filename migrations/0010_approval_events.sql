CREATE TABLE approval_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('regional_manager', 'quality')),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  created_at TEXT NOT NULL
);

CREATE INDEX approval_events_report_created_idx ON approval_events(report_id, created_at ASC);
