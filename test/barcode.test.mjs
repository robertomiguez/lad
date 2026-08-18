import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSku, productCodeMatches } from "../public/barcode.js";

test("normalizes scanner input without changing the SKU meaning", () => {
  assert.equal(normalizeSku(" sku-100 "), "SKU-100");
  assert.equal(normalizeSku("sku  100"), "SKU100");
});

test("matches a SKU or physical barcode regardless of incidental whitespace", () => {
  assert.equal(productCodeMatches("SKU-100", " sku-100 "), true);
  assert.equal(productCodeMatches("7612345678908", "7612345678908"), true);
});

test("does not accept blank or different scanner values", () => {
  assert.equal(productCodeMatches("SKU-100", ""), false);
  assert.equal(productCodeMatches("SKU-100", "SKU-200"), false);
});
