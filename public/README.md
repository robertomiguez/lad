# Static frontend assets

The Worker serves this directory as static assets. `app.js` owns offline capture
and caches the active product/SKU catalogue in IndexedDB; `sw.js` owns the
IndexedDB outbox, retry, and cached app shell.
