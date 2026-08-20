import { describe, expect, it } from "vitest";
import {
  submissionErrorResponse,
  submissionStatusResponse,
  submissionValidationErrorResponse,
} from "../../src/views/submission";

const report = { id: "report-view-100", status: "submitted", total_amount: 12_500 };

describe("submission response views", () => {
  it("renders htmx fragments with escaped report content", async () => {
    const response = submissionStatusResponse(false, { ...report, id: "<unsafe>" }, { message: "was saved." });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("&lt;unsafe&gt;");
  });

  it("preserves the JSON API contract for success and validation failures", async () => {
    const success = submissionStatusResponse(true, report, { status: 201, message: "submitted successfully." });
    expect(success.status).toBe(201);
    await expect(success.json()).resolves.toEqual({
      id: report.id,
      status: report.status,
      totalAmountCents: report.total_amount,
    });

    const failure = submissionErrorResponse(true, {
      status: 422,
      errorCode: "invalid_payload",
      message: "Not shown in JSON.",
    });
    expect(failure.status).toBe(422);
    await expect(failure.json()).resolves.toEqual({ errorCode: "invalid_payload" });

    const validationFailure = submissionValidationErrorResponse(
      true,
      { ...report, status: "sync_error", validation_error_code: "product_inactive" },
      "Report needs attention.",
    );
    expect(validationFailure.status).toBe(422);
    await expect(validationFailure.json()).resolves.toEqual({
      id: report.id,
      status: "sync_error",
      totalAmountCents: report.total_amount,
      errorCode: "product_inactive",
    });
  });
});
