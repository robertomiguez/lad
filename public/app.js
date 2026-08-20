import {
  allLocalPhotos,
  allLocalProducts,
  allLocalReports,
  clearLocalProducts,
  makeId,
  saveLocalPhoto,
  saveLocalProduct,
  saveLocalReport,
} from "./client/storage.js";
import { createProductCatalog } from "./client/catalog.js";
import { resolveBarcode, startCameraScan, stopCameraScan } from "./client/barcode-scanner.js";
import { compressPhoto } from "./client/photo.js";
import { createReportsRenderer } from "./client/reports-view.js";
import { refreshStatuses, registerServiceWorker, requestSync } from "./client/worker-sync.js";

const productCatalog = createProductCatalog({
  allProducts: allLocalProducts,
  clearProducts: clearLocalProducts,
  saveProduct: saveLocalProduct,
});
const renderReports = createReportsRenderer({
  allPhotos: allLocalPhotos,
  allReports: allLocalReports,
  requestSync,
});

const assignLineIds = (root) =>
  root.querySelectorAll("[data-line-id]").forEach((input) => {
    if (!input.value) input.value = makeId();
  });

const resetReportForm = (form) => {
  form.reset();
  form.elements.report_id.value = makeId();
  form.elements.report_date.value = new Date().toISOString().slice(0, 10);
  assignLineIds(form);
};

const submitOfflineFirst = async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const form = event.currentTarget;
  const errors = document.querySelector("#form-errors");
  const feedback = document.querySelector("#form-feedback");
  if (!form.checkValidity()) {
    feedback.textContent = "";
    errors.textContent = "Complete all required fields before submitting.";
    form.reportValidity();
    return;
  }
  const rows = [...document.querySelectorAll(".line-item")];
  if (!rows.length) {
    feedback.textContent = "";
    errors.textContent = "Add at least one line item.";
    return;
  }
  const reportId = form.elements.report_id.value || makeId();
  form.elements.report_id.value = reportId;
  const items = await Promise.all(
    rows.map(async (row) => {
      const id = row.querySelector("[name=line_item_id]").value || makeId();
      const file = row.querySelector("[name=photo]").files[0];
      let photoId;
      if (file) {
        photoId = makeId();
        await saveLocalPhoto({
          id: photoId,
          reportId,
          lineItemId: id,
          blob: await compressPhoto(file),
          contentType: "image/jpeg",
          status: "pending",
          savedAt: new Date().toISOString(),
        });
      }
      return {
        id,
        productId: row.querySelector("[name=product_id]").value,
        quantity: Number(row.querySelector("[name=quantity]").value),
        reasonCode: row.querySelector("[name=reason_code]").value,
        photoId,
      };
    }),
  );
  rows.forEach((row, index) => {
    row.querySelector("[name=line_item_id]").value = items[index].id;
  });
  const payload = {
    id: reportId,
    storeId: form.elements.store_id.value,
    reporterId: form.elements.reporter_id.value,
    reportDate: form.elements.report_date.value,
    totalAmountCents: Math.round(Number(form.elements.total_amount.value) * 100),
    items,
  };
  await saveLocalReport({ id: reportId, ...payload, status: "pending_sync", savedAt: new Date().toISOString() });
  errors.textContent = "";
  feedback.textContent = "Saved on this device. Sync will continue automatically when online.";
  await renderReports();
  resetReportForm(form);
  await requestSync();
};

const addLineItem = () => {
  const template = document.querySelector("#line-item-template");
  const destination = document.querySelector("#line-items");
  if (!(template instanceof HTMLTemplateElement) || !destination) return;
  destination.append(template.content.cloneNode(true));
  assignLineIds(destination);
  productCatalog.apply(destination);
};

const handleClick = (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const scan = target.closest("[data-camera-scan]");
  if (scan instanceof HTMLButtonElement) startCameraScan(scan);
  const close = target.closest("[data-close-camera]");
  if (close) stopCameraScan(close.closest(".line-item"));
  if (target.classList.contains("remove-line")) {
    const item = target.closest(".line-item");
    if (item && document.querySelectorAll(".line-item").length > 1) {
      stopCameraScan(item);
      item.remove();
    }
  }
  if (target.dataset.retry) requestSync();
};

const handleChange = (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.matches("[data-barcode-input]")) resolveBarcode(target);
  if (target instanceof HTMLSelectElement && target.matches("[name=product_id]")) {
    const result = target.closest(".line-item")?.querySelector("[data-barcode-result]");
    if (result) {
      result.textContent = "";
      delete result.dataset.state;
    }
  }
};

const handleKeydown = (event) => {
  const target = event.target;
  if (event.key === "Enter" && target instanceof HTMLInputElement && target.matches("[data-barcode-input]")) {
    event.preventDefault();
    resolveBarcode(target);
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  form.elements.report_id.value = makeId();
  form.elements.report_date.value = new Date().toISOString().slice(0, 10);
  assignLineIds(form);
  form.addEventListener("submit", submitOfflineFirst, true);
  document.querySelector("#add-line-item")?.addEventListener("click", addLineItem);
  document.body.addEventListener("click", handleClick);
  document.body.addEventListener("change", handleChange);
  document.body.addEventListener("keydown", handleKeydown);
  registerServiceWorker();
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (
      ["REPORT_SYNCED", "REPORT_SYNC_ERROR", "REPORT_STATUSES_REFRESHED", "PHOTO_SYNCED", "PHOTO_SYNC_ERROR"].includes(
        event.data?.type,
      )
    ) {
      await renderReports();
    }
  });
  addEventListener("online", () => {
    requestSync();
    refreshStatuses();
  });
  setInterval(refreshStatuses, 15_000);
  addEventListener("pagehide", () => document.querySelectorAll(".line-item").forEach(stopCameraScan));
  await productCatalog.refresh();
  await renderReports();
  await refreshStatuses();
});
