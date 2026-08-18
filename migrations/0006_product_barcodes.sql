-- Physical EAN/UPC barcode used by scanners. SKU remains the internal code.
ALTER TABLE products ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX products_barcode_idx ON products(barcode) WHERE barcode IS NOT NULL;
