import { REPORT_STATUS } from "../domain/reports.js";

export const REGIONAL_THRESHOLD_CENTS = 20_000;
export const QUALITY_THRESHOLD_CENTS = 100_000;

export const initialWorkflowStatus = (
  totalAmountCents: number,
  autoApproveBelowRegional: boolean,
): typeof REPORT_STATUS.approved | typeof REPORT_STATUS.pendingRegional =>
  totalAmountCents < REGIONAL_THRESHOLD_CENTS && autoApproveBelowRegional
    ? REPORT_STATUS.approved
    : REPORT_STATUS.pendingRegional;

export const statusAfterRegionalApproval = (
  totalAmountCents: number,
): typeof REPORT_STATUS.approved | typeof REPORT_STATUS.pendingQuality =>
  totalAmountCents >= QUALITY_THRESHOLD_CENTS ? REPORT_STATUS.pendingQuality : REPORT_STATUS.approved;
