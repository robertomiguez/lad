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

export function createReportsRenderer({ allPhotos, allReports, requestSync }) {
  let thumbnailUrls = [];

  return async function renderReports() {
    const root = document.querySelector("#my-reports");
    if (!root) return;
    thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
    thumbnailUrls = [];
    const [reports, photos] = await Promise.all([allReports(), allPhotos()]);
    reports.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    root.replaceChildren(
      ...(reports.length
        ? reports.map((report) => {
            const item = document.createElement("article");
            item.className = "report";
            const workflow = formatStatus(report.workflowStatus || report.status);
            const reportPhotos = photos.filter((photo) => photo.reportId === report.id);
            const summary = document.createElement("div");
            summary.className = "report-summary";
            summary.textContent = `${report.id} · ${workflow} · CHF ${(report.totalAmountCents / 100).toFixed(2)}`;
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
              if (photo.blob instanceof Blob) {
                const image = document.createElement("img");
                const thumbnailUrl = URL.createObjectURL(photo.blob);
                thumbnailUrls.push(thumbnailUrl);
                image.className = "photo-thumbnail";
                image.src = thumbnailUrl;
                image.alt = "Damage photo";
                detail.append(image);
              }
              const label = document.createElement("span");
              label.textContent = `Photo: ${formatPhotoStatus(photo.status)}`;
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
            return item;
          })
        : [Object.assign(document.createElement("p"), { textContent: "No reports saved on this device yet." })]),
    );
  };
}
