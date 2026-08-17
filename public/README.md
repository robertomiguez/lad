# Static frontend assets

The Worker serves this directory as static assets. `app.js` owns offline capture
and camera scanning; `barcode.js` owns shared SKU matching; `app.js` caches the
active product/SKU catalogue in IndexedDB; and `sw.js` owns the IndexedDB
outbox, retry, and cached app shell.
