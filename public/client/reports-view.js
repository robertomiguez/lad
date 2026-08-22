const formatStatus = (status) =>
  ({
    draft: "Draft",
    pending_sync: "Pending Sync",
    synced: "Updating status",
    submitted: "With Regional Manager",
    pending_regional: "With Regional Manager",
    pending_quality: "With Quality Management",
    approved: "Credit Note Processing",
    credit_note_pending: "Credit Note Processing",
    completed: "Completed",
    rejected: "Rejected",
    sync_error: "Needs attention — retrying",
    erp_error: "Needs attention — retrying",
  })[status] || "Updating status";

const formatPhotoStatus = (status) =>
  ({ pending: "Photo pending", uploaded: "Photo uploaded", failed: "Photo needs attention — retrying" })[status] ||
  "Photo updating";

const formatRole = (role) =>
  ({ regional_manager: "Regional Manager", quality: "Quality Management" })[role] || "the fallback approver role";

const formatAmount = (amountCents) =>
  Number.isInteger(amountCents) ? `CHF ${(amountCents / 100).toFixed(2)}` : "Amount not set";

const formatCreatedAt = (timestamp) => {
  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(createdAt);
};

const formatSkus = (skus) => (Array.isArray(skus) && skus.length ? skus.join(", ") : null);

const shortReportId = (id) => `${id.slice(0, 7)}...`;

export function createReportsRenderer({
  allPhotos,
  allProducts,
  allReports,
  requestSync,
  onEditDraft,
  onDiscardDraft,
}) {
  let thumbnailUrls = [];

  return async function renderReports() {
    const root = document.querySelector("#my-reports");
    if (!root) return;
    thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
    thumbnailUrls = [];
    const [reports, photos, products] = await Promise.all([allReports(), allPhotos(), allProducts()]);
    const skuByProductId = new Map(products.map((product) => [product.id, product.sku]));
    reports.sort((left, right) => (right.updatedAt || right.savedAt).localeCompare(left.updatedAt || left.savedAt));
    root.replaceChildren(
      ...(reports.length
        ? reports.map((report) => {
            const item = document.createElement("article");
            item.className = "report";
            const workflow = formatStatus(report.workflowStatus || report.status);
            const reportPhotos = photos.filter((photo) => photo.reportId === report.id);
            const summary = document.createElement("div");
            summary.className = "report-summary";
            const reference = document.createElement(report.status === "draft" ? "span" : "a");
            reference.className = "report-reference";
            reference.textContent = shortReportId(report.id);
            reference.title = report.id;
            if (reference instanceof HTMLAnchorElement) {
              reference.href = `/reports/${encodeURIComponent(report.id)}`;
              reference.setAttribute("aria-label", `View report ${report.id}`);
            }
            const primary = document.createElement("div");
            primary.className = "report-summary-primary";
            const created = document.createElement("span");
            created.className = "report-created";
            created.textContent = `Created: ${formatCreatedAt(report.createdAt || report.savedAt)}`;
            primary.append(reference, created);
            const skus = formatSkus(report.skus);
            if (skus) {
              const sku = document.createElement("span");
              sku.className = "report-skus";
              sku.textContent = `SKU: ${skus}`;
              primary.append(sku);
            }
            const status = document.createElement("div");
            status.className = "report-summary-status";
            status.textContent = `${workflow} · ${formatAmount(report.totalAmountCents)}`;
            summary.append(primary, status);
            item.append(summary);
            const details = document.createElement("div");
            details.className = "report-details";
            if (report.escalated) {
              const detail = document.createElement("div");
              detail.textContent = `Escalated to ${formatRole(report.escalationTargetRole)}`;
              details.append(detail);
            }
            if (report.rejectionReason) {
              const detail = document.createElement("div");
              detail.textContent = `Reason: ${report.rejectionReason}`;
              details.append(detail);
            }
            for (const photo of reportPhotos) {
              const detail = document.createElement("div");
              detail.className = "photo-detail";
              const lineItem = report.items?.find((candidate) => candidate.id === photo.lineItemId);
              const sku = lineItem ? skuByProductId.get(lineItem.productId) : undefined;
              if (photo.blob instanceof Blob) {
                const image = document.createElement("img");
                const thumbnailUrl = URL.createObjectURL(photo.blob);
                thumbnailUrls.push(thumbnailUrl);
                image.className = "photo-thumbnail";
                image.src = thumbnailUrl;
                image.alt = sku ? `Damage photo for ${sku}` : "Damage photo";
                detail.append(image);
              }
              const label = document.createElement("span");
              label.textContent = `${sku || "SKU unavailable"} · ${formatPhotoStatus(photo.status)}`;
              detail.append(label);
              details.append(detail);
            }
            if (details.childElementCount) item.append(details);
            if (["sync_error", "erp_error"].includes(report.workflowStatus || report.status)) {
              const retry = document.createElement("button");
              retry.type = "button";
              retry.textContent = "Retry now";
              retry.dataset.retry = "true";
              item.append(" ", retry);
            }
            if (report.status === "draft") {
              const actions = document.createElement("div");
              actions.className = "report-actions";
              const edit = document.createElement("button");
              edit.type = "button";
              edit.className = "button-secondary";
              edit.textContent = "Continue editing";
              edit.addEventListener("click", () => onEditDraft?.(report));
              const discard = document.createElement("button");
              discard.type = "button";
              discard.className = "discard-draft";
              discard.textContent = "Discard";
              discard.addEventListener("click", () => onDiscardDraft?.(report));
              actions.append(edit, discard);
              item.append(actions);
            }
            return item;
          })
        : [Object.assign(document.createElement("p"), { textContent: "No reports saved on this device yet." })]),
    );
  };
}
