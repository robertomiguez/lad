-- Regional managers are deliberately assigned one store in this POC so their
-- signed store_id claim can scope regional approval access.
PRAGMA foreign_keys = OFF;
CREATE TABLE users_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('store', 'regional_manager', 'quality')),
  store_id TEXT REFERENCES stores(id),
  CHECK ((role IN ('store', 'regional_manager') AND store_id IS NOT NULL) OR (role = 'quality' AND store_id IS NULL))
);
INSERT INTO users_next (id, name, role, store_id)
SELECT id, name, role,
  CASE WHEN role = 'regional_manager' AND store_id IS NULL THEN 'store-zurich-01' ELSE store_id END
FROM users;
DROP TABLE users;
ALTER TABLE users_next RENAME TO users;
CREATE INDEX users_store_id_idx ON users(store_id);
PRAGMA foreign_keys = ON;
