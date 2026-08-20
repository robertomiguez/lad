const postToWorker = async (type) => {
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type });
  return registration;
};

export const requestSync = async () => {
  const registration = await postToWorker("SYNC_REPORTS");
  if ("sync" in registration) {
    try {
      await registration.sync.register("damage-report-sync");
    } catch {}
  }
};

export const refreshStatuses = () => postToWorker("REFRESH_REPORT_STATUSES");

export const registerServiceWorker = () => navigator.serviceWorker.register("/sw.js");
