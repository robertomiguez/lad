import assert from "node:assert/strict";
import test from "node:test";
import { jsonError, jsonErrorCode, jsonResponse } from "../.test-build/lib/http.js";

test("builds JSON responses with an optional status and headers", async () => {
  const response = jsonResponse({ ok: true }, 201, { "cache-control": "no-store" });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});

test("keeps message and machine-readable errors distinct", async () => {
  assert.deepEqual(await jsonError("Not found", 404).json(), { error: "Not found" });
  assert.deepEqual(await jsonErrorCode("technical_error", 500).json(), { errorCode: "technical_error" });
});
