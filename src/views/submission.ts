import { escape, html } from "../lib/http";

type SubmissionReport = {
  id: string;
  status: string;
  total_amount: number;
  validation_error_code?: string | null;
};

type SubmissionError = {
  status: number;
  message: string;
  error?: string;
  errorCode?: string;
};

type SubmissionStatus = {
  status?: number;
  message: string;
  headers?: HeadersInit;
};

export const submissionJsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

export const submissionErrorResponse = (jsonRequest: boolean, error: SubmissionError) => {
  if (jsonRequest) {
    const body = error.error ? { error: error.error } : { errorCode: error.errorCode };
    return submissionJsonResponse(body, error.status);
  }
  return html(`<p class="error">${escape(error.message)}</p>`, error.status);
};

export const submissionStatusResponse = (
  jsonRequest: boolean,
  report: SubmissionReport,
  response: SubmissionStatus,
) => {
  if (jsonRequest)
    return submissionJsonResponse(
      {
        id: report.id,
        status: report.status,
        totalAmountCents: report.total_amount,
        errorCode: report.validation_error_code ?? undefined,
      },
      response.status ?? 200,
    );
  return html(
    `<p role="status">Report <strong>${escape(report.id)}</strong> ${escape(response.message)}</p>`,
    response.status,
    response.headers,
  );
};

export const submissionValidationErrorResponse = (jsonRequest: boolean, report: SubmissionReport, message: string) =>
  jsonRequest
    ? submissionStatusResponse(true, report, { status: 422, message })
    : submissionErrorResponse(false, { status: 422, errorCode: report.validation_error_code ?? undefined, message });
