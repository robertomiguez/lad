-- Digital Damage Reporting POC: mock ERP and report store.
-- Money is stored as integer CHF cents to avoid floating-point rounding errors.
PRAGMA foreign_keys = ON;

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('store', 'regional_manager', 'quality')),
  store_id TEXT REFERENCES stores(id),
  CHECK ((role IN ('store', 'regional_manager') AND store_id IS NOT NULL) OR (role = 'quality' AND store_id IS NULL))
);
CREATE INDEX users_store_id_idx ON users(store_id);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_sync', 'submitted', 'pending_regional', 'pending_quality', 'approved', 'rejected', 'credit_note_processing', 'completed', 'sync_error', 'erp_error')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reports_store_updated_idx ON reports(store_id, updated_at DESC);
CREATE INDEX reports_status_idx ON reports(status);

CREATE TABLE line_items (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason_code TEXT NOT NULL,
  photo_id TEXT
);
CREATE INDEX line_items_report_id_idx ON line_items(report_id);
CREATE INDEX line_items_product_id_idx ON line_items(product_id);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  line_item_id TEXT NOT NULL UNIQUE REFERENCES line_items(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploaded', 'failed'))
);

CREATE TABLE credit_notes (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE REFERENCES reports(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'created', 'failed')),
  erp_document_id TEXT
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);
