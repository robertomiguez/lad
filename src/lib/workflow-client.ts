import type { Env, Submission } from "../types";

export const reportWorkflow = (env: Env, id: string) => env.REPORT_DO.get(env.REPORT_DO.idFromName(id));

export const initializeWorkflow = (env: Env, submission: Submission, correlationId: string) =>
  reportWorkflow(env, submission.id).fetch("https://report-workflow/initialize", {
    method: "POST",
    headers: { "X-Correlation-Id": correlationId },
    body: JSON.stringify({
      reportId: submission.id,
      storeId: submission.storeId,
      totalAmountCents: submission.totalAmountCents,
    }),
  });
