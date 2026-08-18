# Static frontend assets

The Worker serves this directory as static assets. `app.js` owns offline capture
and camera scanning; `barcode.js` owns shared SKU/barcode matching; `app.js`
caches the active product catalogue in IndexedDB; and `sw.js` owns the IndexedDB
outbox, retry, and cached app shell.
