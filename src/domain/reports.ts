export const REPORT_STATUS = {
  pendingSync: "pending_sync",
  submitted: "submitted",
  pendingRegional: "pending_regional",
  pendingQuality: "pending_quality",
  approved: "approved",
  rejected: "rejected",
  creditNotePending: "credit_note_pending",
  completed: "completed",
  syncError: "sync_error",
  erpError: "erp_error",
} as const;

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];
export type WorkflowStatus =
  | typeof REPORT_STATUS.pendingRegional
  | typeof REPORT_STATUS.pendingQuality
  | typeof REPORT_STATUS.approved
  | typeof REPORT_STATUS.rejected;
export type PendingApprovalStatus = typeof REPORT_STATUS.pendingRegional | typeof REPORT_STATUS.pendingQuality;

const STORE_STATUS_LABELS: Record<ReportStatus, string> = {
  [REPORT_STATUS.pendingSync]: "Pending Sync",
  [REPORT_STATUS.submitted]: "With Regional Manager",
  [REPORT_STATUS.pendingRegional]: "With Regional Manager",
  [REPORT_STATUS.pendingQuality]: "With Quality Management",
  [REPORT_STATUS.approved]: "Credit Note Processing",
  [REPORT_STATUS.rejected]: "Rejected",
  [REPORT_STATUS.creditNotePending]: "Credit Note Processing",
  [REPORT_STATUS.completed]: "Completed",
  [REPORT_STATUS.syncError]: "Needs attention — retrying",
  [REPORT_STATUS.erpError]: "Needs attention — retrying",
};

export const storeStatusLabel = (status: string) => STORE_STATUS_LABELS[status as ReportStatus] ?? "Updating status";

export const isPendingApprovalStatus = (status: string): status is PendingApprovalStatus =>
  status === REPORT_STATUS.pendingRegional || status === REPORT_STATUS.pendingQuality;
