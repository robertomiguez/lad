import assert from "node:assert/strict";
import test from "node:test";
import { ROLE, canAccessStore, roleLabel } from "../.test-build/domain/roles.js";
import { REPORT_STATUS, isPendingApprovalStatus, storeStatusLabel } from "../.test-build/domain/reports.js";

test("report statuses have store-facing labels", () => {
  assert.equal(storeStatusLabel(REPORT_STATUS.pendingSync), "Pending Sync");
  assert.equal(storeStatusLabel(REPORT_STATUS.pendingQuality), "With Quality Management");
  assert.equal(storeStatusLabel(REPORT_STATUS.completed), "Completed");
});

test("only pending approval statuses schedule an escalation", () => {
  assert.equal(isPendingApprovalStatus(REPORT_STATUS.pendingRegional), true);
  assert.equal(isPendingApprovalStatus(REPORT_STATUS.pendingQuality), true);
  assert.equal(isPendingApprovalStatus(REPORT_STATUS.approved), false);
});

test("role scope and display labels remain explicit", () => {
  assert.equal(roleLabel(ROLE.regionalManager), "Regional Manager");
  assert.equal(canAccessStore(ROLE.regionalManager, "store-zurich", "store-zurich"), true);
  assert.equal(canAccessStore(ROLE.regionalManager, "store-zurich", "store-basel"), false);
  assert.equal(canAccessStore(ROLE.quality, null, "store-basel"), true);
});
