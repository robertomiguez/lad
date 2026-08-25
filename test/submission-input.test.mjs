import assert from "node:assert/strict";
import test from "node:test";
import { hasValidSubmissionShape, parseSubmission, priceSubmission } from "../.test-build/lib/submission-input.js";

const claims = { user_id: "user-store-zurich", role: "store", store_id: "store-zurich-01" };
const submission = {
  id: "report-submission-100",
  storeId: claims.store_id,
  reporterId: claims.user_id,
  items: [
    {
      id: "line-submission-100",
      productId: "product-100",
      quantity: 2,
      reasonCode: "damaged",
      description: "Outer packaging was wet.",
    },
  ],
};
const pricedProduct = {
  id: "product-100",
  sku: "SKU-100",
  name: "Sparkling Water 500ml",
  active: 1,
  unitPriceCents: 115,
  currency: "CHF",
  taxRateBps: 260,
};
const catalog = {
  storeExists: async () => ({ id: submission.storeId }),
  findProductsForPricing: async () => [pricedProduct],
};

test("parses an htmx form submission without a client-controlled approval total", async () => {
  const form = new FormData();
  form.set("report_id", submission.id);
  form.set("store_id", submission.storeId);
  form.set("reporter_id", submission.reporterId);
  form.set("description", submission.items[0].description);
  form.set("line_item_id", submission.items[0].id);
  form.set("product_id", submission.items[0].productId);
  form.set("quantity", "2");
  form.set("reason_code", submission.items[0].reasonCode);

  const request = new Request("https://example.com/api/reports", { method: "POST", body: form });
  assert.deepEqual(await parseSubmission(request), submission);
});

test("requires a well-shaped submission bound to the signed-in store user", () => {
  assert.equal(hasValidSubmissionShape(submission, claims, submission.id), true);
  assert.equal(hasValidSubmissionShape({ ...submission, reporterId: "another-user" }, claims, submission.id), false);
  assert.equal(
    hasValidSubmissionShape(
      { ...submission, items: [{ ...submission.items[0], description: "x".repeat(501) }] },
      claims,
      submission.id,
    ),
    false,
  );
  assert.equal(hasValidSubmissionShape(submission, claims, "different-report"), false);
});

test("derives and snapshots a CHF value from the server-owned catalogue", async () => {
  const result = await priceSubmission(catalog, submission);
  assert.equal("error" in result, false);
  assert.deepEqual(result.submission, {
    ...submission,
    currency: "CHF",
    totalAmountCents: 230,
    taxAmountCents: 6,
    items: [
      {
        ...submission.items[0],
        sku: "SKU-100",
        productName: "Sparkling Water 500ml",
        unitPriceCents: 115,
        taxRateBps: 260,
        lineTotalAmountCents: 230,
      },
    ],
  });
});

test("rejects inactive products before approval routing", async () => {
  assert.deepEqual(
    await priceSubmission(
      { ...catalog, findProductsForPricing: async () => [{ ...pricedProduct, active: 0 }] },
      submission,
    ),
    { error: "product_inactive" },
  );
});
