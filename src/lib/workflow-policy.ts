export const REGIONAL_THRESHOLD_CENTS = 20_000;
export const QUALITY_THRESHOLD_CENTS = 100_000;

export const initialWorkflowStatus = (totalAmountCents: number, autoApproveBelowRegional: boolean): "approved" | "pending_regional" =>
  totalAmountCents < REGIONAL_THRESHOLD_CENTS && autoApproveBelowRegional ? "approved" : "pending_regional";

export const statusAfterRegionalApproval = (totalAmountCents: number): "approved" | "pending_quality" =>
  totalAmountCents >= QUALITY_THRESHOLD_CENTS ? "pending_quality" : "approved";
