-- Safe to rerun: IDs are fixed and every insert is idempotent.
INSERT OR IGNORE INTO stores (id, name, region) VALUES
  ('store-zurich-01', 'Zurich Central', 'north'),
  ('store-geneva-01', 'Geneva Lakeside', 'west');

INSERT INTO users (id, name, role, store_id) VALUES
  ('user-store-zurich', 'Zoe Store', 'store', 'store-zurich-01'),
  ('user-regional-north', 'Rene Regional', 'regional_manager', 'store-zurich-01'),
  ('user-quality-hq', 'Quinn Quality', 'quality', NULL)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, store_id = excluded.store_id;

INSERT INTO products (id, sku, barcode, name, active, unit_price_cents, currency, tax_rate_bps) VALUES
  ('product-100', 'SKU-100', '7612345678908', 'Sparkling Water 500ml', 1, 115, 'CHF', 260),
  ('product-200', 'SKU-200', '7612345678917', 'Coffee Beans 1kg', 1, 950, 'CHF', 260),
  ('product-300', 'SKU-300', '7612345678926', 'Retired Sample Product', 0, 500, 'CHF', 260)
ON CONFLICT(id) DO UPDATE SET
  sku = excluded.sku,
  barcode = excluded.barcode,
  name = excluded.name,
  active = excluded.active,
  unit_price_cents = excluded.unit_price_cents,
  currency = excluded.currency,
  tax_rate_bps = excluded.tax_rate_bps;

-- These are server-owned POC catalogue values, not user-entered totals. They
-- simulate a Comarch pricing resolver: SKU-100 uses CHF 1.15 and SKU-200 CHF
-- 9.50 (both gross, including 2.6% VAT). Production derives the snapshot from
-- Comarch order/delivery lines. SKU-300 supports inactive-product tests.
-- The EANs above are demo mappings; replace them with actual product barcodes.
