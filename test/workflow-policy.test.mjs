import assert from "node:assert/strict";
import test from "node:test";
import { initialWorkflowStatus, statusAfterRegionalApproval } from "../.test-build/lib/workflow-policy.js";

test("reports below CHF 200 auto-approve when the POC assumption is enabled", () => {
  assert.equal(initialWorkflowStatus(19_999, true), "approved");
});

test("CHF 200 and above start with regional approval", () => {
  assert.equal(initialWorkflowStatus(20_000, true), "pending_regional");
  assert.equal(initialWorkflowStatus(19_999, false), "pending_regional");
});

test("quality approval is required only from CHF 1,000", () => {
  assert.equal(statusAfterRegionalApproval(99_999), "approved");
  assert.equal(statusAfterRegionalApproval(100_000), "pending_quality");
});
