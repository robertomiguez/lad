-- Safe to rerun: IDs are fixed and every insert is idempotent.
INSERT OR IGNORE INTO stores (id, name, region) VALUES
  ('store-zurich-01', 'Zurich Central', 'north'),
  ('store-geneva-01', 'Geneva Lakeside', 'west');

INSERT INTO users (id, name, role, store_id) VALUES
  ('user-store-zurich', 'Zoe Store', 'store', 'store-zurich-01'),
  ('user-regional-north', 'Rene Regional', 'regional_manager', 'store-zurich-01'),
  ('user-quality-hq', 'Quinn Quality', 'quality', NULL)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, store_id = excluded.store_id;

INSERT OR IGNORE INTO products (id, sku, name, active) VALUES
  ('product-100', 'SKU-100', 'Sparkling Water 500ml', 1),
  ('product-200', 'SKU-200', 'Coffee Beans 1kg', 1),
  ('product-300', 'SKU-300', 'Retired Sample Product', 0);

-- Manual threshold examples: CHF 150 = no approval; CHF 250 = regional;
-- CHF 1,000 = regional and quality. SKU-300 supports inactive-product tests.
