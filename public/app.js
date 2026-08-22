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

let feedbackTimeout;

const showFormFeedback = (message, duration = 0) => {
  const feedback = document.querySelector("#form-feedback");
  if (!feedback) return;
  clearTimeout(feedbackTimeout);
  feedback.textContent = message;
  if (duration) {
    feedbackTimeout = setTimeout(() => {
      if (feedback.textContent === message) feedback.textContent = "";
    }, duration);
  }
};

const confirmAction = ({ title, message, confirmLabel = "Confirm", destructive = false }) => {
  const dialog = document.querySelector("#confirmation-dialog");
  const heading = document.querySelector("#confirmation-title");
  const body = document.querySelector("#confirmation-message");
  const confirmButton = document.querySelector("#confirmation-confirm");
  if (!(dialog instanceof HTMLDialogElement) || !heading || !body || !(confirmButton instanceof HTMLButtonElement))
    return Promise.resolve(false);

  heading.textContent = title;
  body.textContent = message;
  confirmButton.textContent = confirmLabel;
  confirmButton.classList.toggle("destructive-action", destructive);
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
};

const assignLineIds = (root) =>
  root.querySelectorAll("[data-line-id]").forEach((input) => {
    if (!input.value) input.value = makeId();
  });

const updateRemoveItemControls = () => {
  const disableRemove = document.querySelectorAll(".line-item").length <= 1;
  document.querySelectorAll(".remove-line").forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.disabled = disableRemove;
      button.title = disableRemove ? "At least one damaged item is required" : "Remove item";
    }
  });
};

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
  updateRemoveItemControls();
  return row;
};

const resetReportForm = (form) => {
  form.reset();
  delete form.dataset.createdAt;
  form.elements.report_id.value = makeId();
  form.elements.report_date.value = new Date().toISOString().slice(0, 10);
  const destination = document.querySelector("#line-items");
  if (destination) {
    destination.querySelectorAll(".line-item").forEach(clearPhotoPreview);
    destination.replaceChildren();
  }
  addLineItem();
};

const clearPhotoPreview = (row) => {
  const preview = row.querySelector("[data-photo-preview]");
  if (!(preview instanceof HTMLImageElement)) return;
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  delete preview.dataset.objectUrl;
  preview.removeAttribute("src");
  preview.hidden = true;
};

const showPhotoPreview = (input) => {
  const row = input.closest(".line-item");
  const preview = row?.querySelector("[data-photo-preview]");
  if (!(preview instanceof HTMLImageElement)) return;
  clearPhotoPreview(row);
  const file = input.files?.[0];
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.dataset.objectUrl = objectUrl;
  preview.hidden = false;
};

const setEditorActive = (form, active) => {
  const editor = form.querySelector("#report-editor");
  const newReport = document.querySelector("#new-report");
  const formCard = form.closest(".form-card");
  if (editor instanceof HTMLFieldSetElement) {
    editor.disabled = !active;
    editor.hidden = !active;
  }
  if (newReport instanceof HTMLButtonElement) newReport.hidden = active;
  if (formCard instanceof HTMLElement) formCard.hidden = !active;
  form.closest(".capture-grid")?.classList.toggle("editor-active", active);
};

const startNewReport = () => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  resetReportForm(form);
  setEditorActive(form, true);
  document.querySelector("#form-errors").textContent = "";
  showFormFeedback("");
  form.elements.report_date.focus();
};

const cancelEditing = () => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  resetReportForm(form);
  setEditorActive(form, false);
  document.querySelector("#form-errors").textContent = "";
  showFormFeedback("Editing cancelled. No changes were saved.", 5_000);
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
  if (destination) {
    destination.querySelectorAll(".line-item").forEach(clearPhotoPreview);
    destination.replaceChildren();
  }
  (draft.items?.length ? draft.items : [{}]).forEach(addLineItem);
  form.elements.report_id.value = draft.id;
  form.dataset.createdAt = draft.createdAt || draft.savedAt;
  form.elements.report_date.value = draft.reportDate || "";
  form.elements.total_amount.value = Number.isInteger(draft.totalAmountCents)
    ? (draft.totalAmountCents / 100).toFixed(2)
    : "";
  setEditorActive(form, true);
  document.querySelector("#form-errors").textContent = "";
  showFormFeedback("");
  form.elements.report_date.focus();
};

const discardDraft = async (draft) => {
  if (
    !(await confirmAction({
      title: "Discard draft?",
      message: "This removes the draft and its local photos from this device. This cannot be undone.",
      confirmLabel: "Discard draft",
      destructive: true,
    }))
  )
    return;
  const photos = await allLocalPhotos();
  await Promise.all([
    deleteLocalReport(draft.id),
    ...photos.filter((photo) => photo.reportId === draft.id).map((photo) => deleteLocalPhoto(photo.id)),
  ]);
  const form = document.querySelector("#report-form");
  if (form?.elements.report_id.value === draft.id) {
    resetReportForm(form);
    setEditorActive(form, false);
  }
  document.querySelector("#form-errors").textContent = "";
  showFormFeedback("Draft discarded from this device.", 5_000);
  await renderReports();
};

const renderReports = createReportsRenderer({
  allPhotos: allLocalPhotos,
  allProducts: allLocalProducts,
  allReports: allLocalReports,
  requestSync,
  onEditDraft: editDraft,
  onDiscardDraft: discardDraft,
});

const saveDraft = async () => {
  const form = document.querySelector("#report-form");
  if (!form) return;
  const draft = await collectReport(form);
  const updatedAt = new Date().toISOString();
  const createdAt = form.dataset.createdAt || updatedAt;
  await saveLocalReport({ ...draft, status: "draft", createdAt, updatedAt, savedAt: updatedAt });
  form.dataset.createdAt = createdAt;
  await removeUnusedDraftPhotos(draft.id, draft.items);
  document.querySelector("#form-errors").textContent = "";
  showFormFeedback("Draft saved on this device. It will not sync until you submit it.", 5_000);
  resetReportForm(form);
  setEditorActive(form, false);
  await renderReports();
};

const submitOfflineFirst = async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const form = event.currentTarget;
  const errors = document.querySelector("#form-errors");
  if (!form.checkValidity()) {
    showFormFeedback("");
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
  showFormFeedback("Submitted from this device. Sync will continue automatically when online.", 5_000);
  await renderReports();
  resetReportForm(form);
  setEditorActive(form, false);
  await requestSync();
};

const handleClick = (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const scan = target.closest("[data-camera-scan]");
  if (scan instanceof HTMLButtonElement) startCameraScan(scan);
  const close = target.closest("[data-close-camera]");
  if (close) stopCameraScan(close.closest(".line-item"));
  if (target.closest("[data-add-line-item]")) addLineItem();
  if (target.classList.contains("remove-line")) {
    const item = target.closest(".line-item");
    if (item && document.querySelectorAll(".line-item").length > 1) {
      stopCameraScan(item);
      clearPhotoPreview(item);
      item.remove();
      updateRemoveItemControls();
    }
  }
  if (target.dataset.retry) requestSync();
};

const handleChange = (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.matches("[name=photo]")) showPhotoPreview(target);
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
  setEditorActive(form, false);
  form.addEventListener("submit", submitOfflineFirst, true);
  document.querySelector("#new-report")?.addEventListener("click", startNewReport);
  document.querySelector("#cancel-edit")?.addEventListener("click", cancelEditing);
  document.querySelector("#save-draft")?.addEventListener("click", saveDraft);
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
