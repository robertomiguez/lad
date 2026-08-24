-- The POC catalogue simulates Comarch-derived pricing. Amounts are stored as
-- integer CHF cents and copied to line-item snapshots when a report is submitted.
ALTER TABLE products ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0);
ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHF';
ALTER TABLE products ADD COLUMN tax_rate_bps INTEGER NOT NULL DEFAULT 260 CHECK (tax_rate_bps >= 0);

ALTER TABLE reports ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHF';
ALTER TABLE reports ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);

ALTER TABLE line_items ADD COLUMN sku_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE line_items ADD COLUMN product_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE line_items ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0);
ALTER TABLE line_items ADD COLUMN tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0);
ALTER TABLE line_items ADD COLUMN line_total_amount INTEGER NOT NULL DEFAULT 0 CHECK (line_total_amount >= 0);
