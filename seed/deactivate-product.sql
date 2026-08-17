-- Run after an offline report has been captured but before it is synced.
UPDATE products SET active = 0 WHERE id = 'product-200';
