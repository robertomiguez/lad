import { normalizeSku, productCodeMatches } from "./barcode.js";

const damageDbName = "damage-reporting-poc";
const openDamageDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(damageDbName, 3);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("reports")) request.result.createObjectStore("reports", { keyPath: "id" });
    if (!request.result.objectStoreNames.contains("photos")) request.result.createObjectStore("photos", { keyPath: "id" });
    if (!request.result.objectStoreNames.contains("products")) request.result.createObjectStore("products", { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const withStore = async (name, mode, action) => { const db = await openDamageDb(); return new Promise((resolve, reject) => { const request = action(db.transaction(name, mode).objectStore(name)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); };
const saveLocal = report => withStore("reports", "readwrite", store => store.put(report));
const allLocal = () => withStore("reports", "readonly", store => store.getAll());
const savePhoto = photo => withStore("photos", "readwrite", store => store.put(photo));
const allPhotos = () => withStore("photos", "readonly", store => store.getAll());
const saveProduct = product => withStore("products", "readwrite", store => store.put(product));
const allProducts = () => withStore("products", "readonly", store => store.getAll());
const clearProducts = () => withStore("products", "readwrite", store => store.clear());
const makeId = () => crypto.randomUUID();
const formatStatus = status => ({ draft: "Draft", pending_sync: "Pending Sync", synced: "Updating status", submitted: "With Regional Manager", pending_regional: "With Regional Manager", pending_quality: "With Quality Management", approved: "Credit Note Processing", credit_note_processing: "Credit Note Processing", completed: "Completed", rejected: "Rejected", sync_error: "Needs attention — retrying", erp_error: "Needs attention — retrying" })[status] || "Updating status";
const formatPhotoStatus = status => ({ pending: "Photo pending", uploaded: "Photo uploaded", failed: "Photo needs attention — retrying" })[status] || "Photo updating";
const formatRole = role => ({ regional_manager: "Regional Manager", quality: "Quality Management" })[role] || "the fallback approver role";
let thumbnailUrls = [];
let productCatalog = [];
const sortProducts = products => [...products].sort((left, right) => left.sku.localeCompare(right.sku));
const populateProductSelect = (select, products) => {
  const selected = select.value;
  select.replaceChildren(new Option("Choose product", ""));
  for (const product of products) {
    const option = new Option(`${product.sku} — ${product.name}`, product.id);
    option.dataset.sku = product.sku; option.dataset.barcode = product.barcode || "";
    select.add(option);
  }
  select.value = products.some(product => product.id === selected) ? selected : "";
};
const applyProductCatalog = root => root.querySelectorAll("[name=product_id]").forEach(select => {
  if (select instanceof HTMLSelectElement && productCatalog.length) populateProductSelect(select, productCatalog);
});
const refreshProductCatalog = async () => {
  const cached = await allProducts();
  if (cached.length) { productCatalog = sortProducts(cached); applyProductCatalog(document); }
  try {
    const response = await fetch("/api/products", { credentials: "same-origin" });
    const products = await response.json();
    if (!response.ok || !Array.isArray(products) || products.some(product => !product?.id || !product?.sku || !product?.name)) return;
    productCatalog = sortProducts(products);
    await clearProducts(); await Promise.all(productCatalog.map(saveProduct));
    applyProductCatalog(document);
  } catch {}
};
const resolveBarcode = input => {
  const item = input.closest(".line-item"); if (!item) return;
  const result = item.querySelector("[data-barcode-result]"), product = item.querySelector("[name=product_id]"), sku = normalizeSku(input.value);
  if (!result || !(product instanceof HTMLSelectElement)) return;
  if (!sku) { result.textContent = ""; delete result.dataset.state; return; }
  const match = [...product.options].find(option => productCodeMatches(option.dataset.sku, sku) || productCodeMatches(option.dataset.barcode, sku));
  if (!match) { result.textContent = "No matching product. Use the picker instead."; result.dataset.state = "error"; return; }
  product.value = match.value; result.textContent = `Selected ${match.textContent}`; result.dataset.state = "success";
};
const cameraScanFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];
const stopCameraScan = item => {
  const scanner = item?.querySelector("[data-barcode-scanner]");
  if (!scanner) return;
  cancelAnimationFrame(scanner.scanFrame || 0);
  const video = scanner.querySelector("[data-barcode-video]");
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
  if (video) video.srcObject = null;
  scanner.hidden = true; delete scanner.scanFrame;
};
const startCameraScan = async button => {
  const item = button.closest(".line-item"), input = item?.querySelector("[data-barcode-input]"), result = item?.querySelector("[data-barcode-result]"), scanner = item?.querySelector("[data-barcode-scanner]"), video = scanner?.querySelector("[data-barcode-video]"), Detector = globalThis.BarcodeDetector;
  if (!item || !(input instanceof HTMLInputElement) || !result || !scanner || !(video instanceof HTMLVideoElement)) return;
  if (!Detector || !navigator.mediaDevices?.getUserMedia) { result.textContent = "Camera scanning is unavailable here. Scan with a hardware scanner or type the SKU."; result.dataset.state = "error"; return; }
  document.querySelectorAll(".line-item").forEach(stopCameraScan); scanner.hidden = false;
  try {
    const supported = await Detector.getSupportedFormats?.() || cameraScanFormats;
    const formats = cameraScanFormats.filter(format => supported.includes(format));
    const detector = new Detector(formats.length ? { formats } : undefined);
    video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
    await video.play();
    const detect = async () => {
      try {
        const barcode = (await detector.detect(video))[0];
        if (barcode?.rawValue) { input.value = barcode.rawValue; resolveBarcode(input); stopCameraScan(item); return; }
      } catch {}
      scanner.scanFrame = requestAnimationFrame(detect);
    };
    scanner.scanFrame = requestAnimationFrame(detect);
  } catch {
    stopCameraScan(item); result.textContent = "Camera access was unavailable. Scan with a hardware scanner or type the SKU."; result.dataset.state = "error";
  }
};
const renderReports = async () => {
  const root = document.querySelector("#my-reports"); if (!root) return;
  thumbnailUrls.forEach(url => URL.revokeObjectURL(url)); thumbnailUrls = [];
  const [reports, photos] = await Promise.all([allLocal(), allPhotos()]);
  reports.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  root.replaceChildren(...(reports.length ? reports.map(report => {
    const item = document.createElement("article"); item.className = "report";
    const workflow = formatStatus(report.workflowStatus || report.status);
    const reportPhotos = photos.filter(photo => photo.reportId === report.id);
    const summary = document.createElement("div"); summary.className = "report-summary";
    summary.textContent = `${report.id} · ${workflow} · CHF ${(report.totalAmountCents / 100).toFixed(2)}`;
    item.append(summary);
    const details = document.createElement("div"); details.className = "report-details";
    if (report.escalated) { const detail = document.createElement("div"); detail.textContent = `Escalated to ${formatRole(report.escalationTargetRole)}`; details.append(detail); }
    if (report.rejectionReason) { const detail = document.createElement("div"); detail.textContent = `Reason: ${report.rejectionReason}`; details.append(detail); }
    for (const photo of reportPhotos) {
      const detail = document.createElement("div"); detail.className = "photo-detail";
      if (photo.blob instanceof Blob) {
        const image = document.createElement("img"); const thumbnailUrl = URL.createObjectURL(photo.blob);
        thumbnailUrls.push(thumbnailUrl); image.className = "photo-thumbnail"; image.src = thumbnailUrl; image.alt = "Damage photo"; detail.append(image);
      }
      const label = document.createElement("span"); label.textContent = `Photo: ${formatPhotoStatus(photo.status)}`; detail.append(label); details.append(detail);
    }
    if (details.childElementCount) item.append(details);
    if (["sync_error", "erp_error"].includes(report.workflowStatus || report.status)) {
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry now"; retry.dataset.retry = "true"; item.append(" ", retry);
    }
    return item;
  }) : [Object.assign(document.createElement("p"), { textContent: "No reports saved on this device yet." })]));
};
const requestSync = async () => { const registration = await navigator.serviceWorker.ready; registration.active?.postMessage({ type: "SYNC_REPORTS" }); if ("sync" in registration) try { await registration.sync.register("damage-report-sync"); } catch {} };
const refreshStatuses = async () => { const registration = await navigator.serviceWorker.ready; registration.active?.postMessage({ type: "REFRESH_REPORT_STATUSES" }); };
const assignLineIds = root => root.querySelectorAll("[data-line-id]").forEach(input => { if (!input.value) input.value = makeId(); });
async function compressPhoto(file) {
  try {
    const image = await createImageBitmap(file); const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.75));
    return blob || file;
  } catch { return file; }
}
const submitOfflineFirst = async event => {
  event.preventDefault(); event.stopImmediatePropagation();
  const form = event.currentTarget, errors = document.querySelector("#form-errors"), feedback = document.querySelector("#form-feedback");
  if (!form.checkValidity()) { feedback.textContent = ""; errors.textContent = "Complete all required fields before submitting."; form.reportValidity(); return; }
  const rows = [...document.querySelectorAll(".line-item")]; if (!rows.length) { feedback.textContent = ""; errors.textContent = "Add at least one line item."; return; }
  const reportId = form.elements.report_id.value || makeId(); form.elements.report_id.value = reportId;
  const items = await Promise.all(rows.map(async row => {
    const id = row.querySelector("[name=line_item_id]").value || makeId();
    const file = row.querySelector("[name=photo]").files[0]; let photoId;
    if (file) { photoId = makeId(); await savePhoto({ id: photoId, reportId, lineItemId: id, blob: await compressPhoto(file), contentType: "image/jpeg", status: "pending", savedAt: new Date().toISOString() }); }
    return { id, productId: row.querySelector("[name=product_id]").value, quantity: Number(row.querySelector("[name=quantity]").value), reasonCode: row.querySelector("[name=reason_code]").value, photoId };
  }));
  rows.forEach((row, index) => { row.querySelector("[name=line_item_id]").value = items[index].id; });
  const payload = { id: reportId, storeId: form.elements.store_id.value, reporterId: form.elements.reporter_id.value, reportDate: form.elements.report_date.value, totalAmountCents: Math.round(Number(form.elements.total_amount.value) * 100), items };
  await saveLocal({ id: reportId, ...payload, status: "pending_sync", savedAt: new Date().toISOString() });
  errors.textContent = ""; feedback.textContent = "Saved on this device. Sync will continue automatically when online."; await renderReports();
  form.reset(); form.elements.report_id.value = makeId(); form.elements.report_date.value = new Date().toISOString().slice(0, 10); assignLineIds(form); await requestSync();
};
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#report-form"); if (!form) return;
  form.elements.report_id.value = makeId(); form.elements.report_date.value = new Date().toISOString().slice(0, 10);
  assignLineIds(form);
  form.addEventListener("submit", submitOfflineFirst, true);
  document.querySelector("#add-line-item")?.addEventListener("click", () => { const template = document.querySelector("#line-item-template"); const destination = document.querySelector("#line-items"); if (!(template instanceof HTMLTemplateElement) || !destination) return; destination.append(template.content.cloneNode(true)); assignLineIds(destination); applyProductCatalog(destination); });
  document.body.addEventListener("click", event => {
    const target = event.target; if (!(target instanceof Element)) return;
    const scan = target.closest("[data-camera-scan]"); if (scan instanceof HTMLButtonElement) startCameraScan(scan);
    const close = target.closest("[data-close-camera]"); if (close) stopCameraScan(close.closest(".line-item"));
    if (target.classList.contains("remove-line")) { const item = target.closest(".line-item"); if (item && document.querySelectorAll(".line-item").length > 1) { stopCameraScan(item); item.remove(); } }
    if (target.dataset.retry) requestSync();
  });
  document.body.addEventListener("change", event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches("[data-barcode-input]")) resolveBarcode(target);
    if (target instanceof HTMLSelectElement && target.matches("[name=product_id]")) {
      const result = target.closest(".line-item")?.querySelector("[data-barcode-result]");
      if (result) { result.textContent = ""; delete result.dataset.state; }
    }
  });
  document.body.addEventListener("keydown", event => { const target = event.target; if (event.key === "Enter" && target instanceof HTMLInputElement && target.matches("[data-barcode-input]")) { event.preventDefault(); resolveBarcode(target); } });
  navigator.serviceWorker.register("/sw.js");
  navigator.serviceWorker.addEventListener("message", async event => { if (["REPORT_SYNCED", "REPORT_SYNC_ERROR", "REPORT_STATUSES_REFRESHED", "PHOTO_SYNCED", "PHOTO_SYNC_ERROR"].includes(event.data?.type)) await renderReports(); });
  addEventListener("online", () => { requestSync(); refreshStatuses(); }); setInterval(refreshStatuses, 15_000);
  addEventListener("pagehide", () => document.querySelectorAll(".line-item").forEach(stopCameraScan));
  await refreshProductCatalog(); await renderReports(); await refreshStatuses();
});
