const DB = "damage-reporting-poc",
  CACHE = "damage-reporting-shell-v2";
const db = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("reports"))
        request.result.createObjectStore("reports", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("photos"))
        request.result.createObjectStore("photos", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("products"))
        request.result.createObjectStore("products", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const all = async (name) => {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
const update = async (name, record) => {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(name, "readwrite").objectStore(name).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
const notify = async (message) => {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage(message);
};
const syncPhotos = async () => {
  const reports = await all("reports");
  for (const photo of await all("photos")) {
    if (
      !["pending", "failed"].includes(photo.status) ||
      !reports.some((report) => report.id === photo.reportId && report.status === "synced")
    )
      continue;
    try {
      const response = await fetch(`/api/reports/${photo.reportId}/line-items/${photo.lineItemId}/photo`, {
        method: "PUT",
        headers: { "content-type": photo.contentType || "image/jpeg", "X-Photo-Id": photo.id },
        credentials: "same-origin",
        body: photo.blob,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.errorCode || "photo_upload_failed");
      photo.status = "uploaded";
      photo.errorCode = undefined;
      await update("photos", photo);
      await notify({ type: "PHOTO_SYNCED", id: photo.id });
    } catch (error) {
      photo.status = "failed";
      photo.errorCode = error.message || "photo_upload_failed";
      await update("photos", photo);
      await notify({ type: "PHOTO_SYNC_ERROR", id: photo.id });
    }
  }
};
const sync = async () => {
  for (const report of await all("reports")) {
    if (report.status !== "pending_sync" && report.status !== "sync_error") continue;
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": report.id },
        credentials: "same-origin",
        body: JSON.stringify({
          id: report.id,
          storeId: report.storeId,
          reporterId: report.reporterId,
          reportDate: report.reportDate,
          totalAmountCents: report.totalAmountCents,
          items: report.items,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        report.status = "sync_error";
        report.errorCode = body.errorCode || "sync_failed";
        await update("reports", report);
        await notify({ type: "REPORT_SYNC_ERROR", id: report.id });
        break;
      }
      report.status = "synced";
      report.errorCode = undefined;
      report.workflowStatus = body.status;
      await update("reports", report);
      await notify({ type: "REPORT_SYNCED", id: report.id });
    } catch {
      report.status = "sync_error";
      report.errorCode = "sync_failed";
      await update("reports", report);
      await notify({ type: "REPORT_SYNC_ERROR", id: report.id });
      break;
    }
  }
  await syncPhotos();
};
const refreshStatuses = async () => {
  try {
    const response = await fetch("/api/reports/statuses", { credentials: "same-origin" });
    if (!response.ok) return;
    const statuses = await response.json();
    const localById = new Map((await all("reports")).map((report) => [report.id, report]));
    for (const remote of statuses) {
      const report = localById.get(remote.id) || {
        id: remote.id,
        status: "synced",
        savedAt: remote.createdAt,
        totalAmountCents: remote.totalAmountCents,
        items: [],
      };
      report.totalAmountCents = remote.totalAmountCents;
      report.savedAt = report.savedAt || remote.createdAt;
      report.workflowStatus = remote.status;
      report.escalated = Boolean(remote.escalatedAt);
      report.escalationTargetRole = remote.escalationTargetRole;
      report.rejectionReason = remote.rejectionReason;
      await update("reports", report);
    }
    await notify({ type: "REPORT_STATUSES_REFRESHED" });
  } catch {}
};
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/app.js", "/barcode.js", "/sw.js", "/styles.css"])),
  ),
);
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SYNC_REPORTS") event.waitUntil(sync());
  if (event.data?.type === "REFRESH_REPORT_STATUSES") event.waitUntil(refreshStatuses());
});
self.addEventListener("sync", (event) => {
  if (event.tag === "damage-report-sync") event.waitUntil(sync());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (
          response.ok &&
          (event.request.mode === "navigate" ||
            ["/app.js", "/barcode.js", "/styles.css"].includes(new URL(event.request.url).pathname))
        )
          (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
