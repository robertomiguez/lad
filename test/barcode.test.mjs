import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSku, skuMatches } from "../public/barcode.js";

test("normalizes scanner input without changing the SKU meaning", () => {
  assert.equal(normalizeSku(" sku-100 "), "SKU-100");
  assert.equal(normalizeSku("sku  100"), "SKU100");
});

test("matches a scanner value regardless of casing or incidental whitespace", () => {
  assert.equal(skuMatches("SKU-100", " sku-100 "), true);
  assert.equal(skuMatches("SKU 200", "sku200"), true);
});

test("does not accept blank or different scanner values", () => {
  assert.equal(skuMatches("SKU-100", ""), false);
  assert.equal(skuMatches("SKU-100", "SKU-200"), false);
});
