import assert from "node:assert/strict";
import test from "node:test";
import {
  hasValidSubmissionShape,
  parseSubmission,
  validateSubmissionCatalog,
} from "../.test-build/lib/submission-input.js";

const claims = { user_id: "user-store-zurich", role: "store", store_id: "store-zurich-01" };
const submission = {
  id: "report-submission-100",
  storeId: claims.store_id,
  reporterId: claims.user_id,
  reportDate: "2026-08-20",
  totalAmountCents: 12_500,
  items: [{ id: "line-submission-100", productId: "product-100", quantity: 1, reasonCode: "damaged" }],
};

test("parses an htmx form submission into the API submission shape", async () => {
  const form = new FormData();
  form.set("report_id", submission.id);
  form.set("store_id", submission.storeId);
  form.set("reporter_id", submission.reporterId);
  form.set("report_date", submission.reportDate);
  form.set("total_amount", "125.00");
  form.set("line_item_id", submission.items[0].id);
  form.set("product_id", submission.items[0].productId);
  form.set("quantity", "1");
  form.set("reason_code", submission.items[0].reasonCode);

  const request = new Request("https://example.com/api/reports", { method: "POST", body: form });
  assert.deepEqual(await parseSubmission(request), submission);
});

test("requires a well-shaped submission bound to the signed-in store user", () => {
  assert.equal(hasValidSubmissionShape(submission, claims, submission.id), true);
  assert.equal(hasValidSubmissionShape({ ...submission, reporterId: "another-user" }, claims, submission.id), false);
  assert.equal(hasValidSubmissionShape({ ...submission, reportDate: "20/08/2026" }, claims, submission.id), false);
  assert.equal(hasValidSubmissionShape(submission, claims, "different-report"), false);
});

test("validates current ERP catalogue data after client-side capture", async () => {
  const catalog = {
    storeExists: async () => ({ id: submission.storeId }),
    findProductState: async () => ({ active: 1 }),
  };
  assert.equal(await validateSubmissionCatalog(catalog, submission), null);
  assert.equal(
    await validateSubmissionCatalog({ ...catalog, findProductState: async () => ({ active: 0 }) }, submission),
    "product_inactive",
  );
});
