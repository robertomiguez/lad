import {
  allLocalPhotos,
  allLocalProducts,
  allLocalReports,
  clearLocalProducts,
  deleteLocalPhoto,
  deleteLocalReport,
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

const assignLineIds = (root) =>
  root.querySelectorAll("[data-line-id]").forEach((input) => {
    if (!input.value) input.value = makeId();
  });

const addLineItem = (item = {}) => {
  const template = document.querySelector("#line-item-template");
  const destination = document.querySelector("#line-items");
  if (!(template instanceof HTMLTemplateElement) || !destination) return null;
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector(".line-item");
  if (!(row instanceof HTMLElement)) return null;
  row.querySelector("[name=line_item_id]").value = item.id || makeId();
  row.querySelector("[name=product_id]").value = item.productId || "";
  row.querySelector("[name=quantity]").value = item.quantity ?? "";
  row.querySelector("[name=reason_code]").value = item.reasonCode || "";
  if (item.photoId) row.dataset.photoId = item.photoId;
  destination.append(fragment);
  productCatalog.apply(destination);
  return row;
};

const resetReportForm = (form) => {
  form.reset();
  form.elements.report_id.value = makeId();
  form.elements.report_date.value = new Date().toISOString().slice(0, 10);
  const destination = document.querySelector("#line-items");
  if (destination) destination.replaceChildren();
  addLineItem();
};

const collectReport = async (form) => {
  const rows = [...document.querySelectorAll(".line-item")];
  const reportId = form.elements.report_id.value || makeId();
  form.elements.report_id.value = reportId;
  const items = await Promise.all(
    rows.map(async (row) => {
      const id = row.querySelector("[name=line_item_id]").value || makeId();
      const file = row.querySelector("[name=photo]").files[0];
      let photoId = row.dataset.photoId || undefined;
      if (file) {
        const blob = await compressPhoto(file);
        if (photoId) await deleteLocalPhoto(photoId);
        photoId = makeId();
        await saveLocalPhoto({
          id: photoId,
          reportId,
          lineItemId: id,
          blob,
          contentType: "image/jpeg",
          status: "pending",
          savedAt: new Date().toISOString(),
        });
        row.dataset.photoId = photoId;
      }
      return {
        id,
        productId: row.querySelector("[name=product_id]").value,
        quantity: row.querySelector("[name=quantity]").value
          ? Number(row.querySelector("[name=quantity]").value)
          : null,
        reasonCode: row.querySelector("[name=reason_code]").value,
        photoId,
      };
    }),
  );
  rows.forEach((row, index) => {
    row.querySelector("[name=line_item_id]").value = items[index].id;
  });
  const totalAmount = form.elements.total_amount.value;
  return {
    id: reportId,
    storeId: form.elements.store_id.value,
    reporterId: form.elements.reporter_id.value,
    reportDate: form.elements.report_date.value,
    totalAmountCents: totalAmount ? Math.round(Number(totalAmount) * 100) : null,
    items,
  };
};

const removeUnusedDraftPhotos = async (reportId, items) => {
  const photoIds = new Set(items.map((item) => item.photoId).filter(Boolean));
  const photos = await allLocalPhotos();
  await Promise.all(
    photos
      .filter((photo) => photo.reportId === reportId && !photoIds.has(photo.id))
      .map((photo) => deleteLocalPhoto(photo.id)),
  );
};

const editDraft = async (draft) => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  const destination = document.querySelector("#line-items");
  if (destination) destination.replaceChildren();
  (draft.items?.length ? draft.items : [{}]).forEach(addLineItem);
  form.elements.report_id.value = draft.id;
  form.elements.report_date.value = draft.reportDate || "";
  form.elements.total_amount.value = Number.isInteger(draft.totalAmountCents)
    ? (draft.totalAmountCents / 100).toFixed(2)
    : "";
  document.querySelector("#form-errors").textContent = "";
  document.querySelector("#form-feedback").textContent =
    "Editing draft. Submit it when all required fields are complete.";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.report_date.focus();
};

const discardDraft = async (draft) => {
  if (!confirm("Discard this draft and its local photos?")) return;
  const photos = await allLocalPhotos();
  await Promise.all([
    deleteLocalReport(draft.id),
    ...photos.filter((photo) => photo.reportId === draft.id).map((photo) => deleteLocalPhoto(photo.id)),
  ]);
  const form = document.querySelector("#report-form");
  if (form?.elements.report_id.value === draft.id) resetReportForm(form);
  document.querySelector("#form-errors").textContent = "";
  document.querySelector("#form-feedback").textContent = "Draft discarded from this device.";
  await renderReports();
};

const renderReports = createReportsRenderer({
  allPhotos: allLocalPhotos,
  allReports: allLocalReports,
  requestSync,
  onEditDraft: editDraft,
  onDiscardDraft: discardDraft,
});

const saveDraft = async () => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  const draft = await collectReport(form);
  await saveLocalReport({ ...draft, status: "draft", savedAt: new Date().toISOString() });
  await removeUnusedDraftPhotos(draft.id, draft.items);
  document.querySelector("#form-errors").textContent = "";
  document.querySelector("#form-feedback").textContent =
    "Draft saved on this device. It will not sync until you submit it.";
  resetReportForm(form);
  await renderReports();
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
  const report = await collectReport(form);
  await saveLocalReport({ ...report, status: "pending_sync", savedAt: new Date().toISOString() });
  errors.textContent = "";
  feedback.textContent = "Submitted from this device. Sync will continue automatically when online.";
  await renderReports();
  resetReportForm(form);
  await requestSync();
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
  resetReportForm(form);
  form.addEventListener("submit", submitOfflineFirst, true);
  document.querySelector("#save-draft")?.addEventListener("click", saveDraft);
  document.querySelector("#add-line-item")?.addEventListener("click", () => addLineItem());
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
