import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  canTransition,
  getAvailableTransitions,
  getTransitionEventName,
} from "./stateMachine.transitions.ts";

// The state machine drives the admin UI buttons. Any new direct-to-REFUNDED
// shortcut must NOT appear in this table, otherwise the admin UI would gain
// a new button. The API path uses `force=true` to bypass these edges
// without touching this table.

test("UI shortcut guard: APPROVED cannot transition directly to REFUNDED", () => {
  assert.equal(canTransition("APPROVED", "REFUNDED"), false);
  assert.deepEqual(getAvailableTransitions("APPROVED"), ["AWAITING_SHIPMENT", "CANCELLED"]);
});

test("UI shortcut guard: AWAITING_SHIPMENT cannot transition directly to REFUNDED", () => {
  assert.equal(canTransition("AWAITING_SHIPMENT", "REFUNDED"), false);
  assert.deepEqual(getAvailableTransitions("AWAITING_SHIPMENT"), ["IN_TRANSIT", "CANCELLED"]);
});

test("UI shortcut guard: IN_TRANSIT cannot transition directly to REFUNDED", () => {
  assert.equal(canTransition("IN_TRANSIT", "REFUNDED"), false);
  assert.deepEqual(getAvailableTransitions("IN_TRANSIT"), ["RECEIVED", "CANCELLED"]);
});

test("Existing happy path: RECEIVED → REFUNDED is still valid", () => {
  assert.equal(canTransition("RECEIVED", "REFUNDED"), true);
});

test("Existing happy path: PARTIALLY_ACCEPTED → REFUNDED is still valid", () => {
  assert.equal(canTransition("PARTIALLY_ACCEPTED", "REFUNDED"), true);
});

test("Timeline label for forced AWAITING_SHIPMENT → REFUNDED marks intermediate skip", () => {
  // The force path writes the transition through transitionStatus, which
  // looks up the label here. We want the audit trail to make it obvious
  // that this jump was taken on purpose, not via the standard flow.
  const label = getTransitionEventName("AWAITING_SHIPMENT", "REFUNDED");
  assert.match(label, /intermediate states skipped via API/i);
});

test("Timeline label for forced APPROVED → REFUNDED marks intermediate skip", () => {
  const label = getTransitionEventName("APPROVED", "REFUNDED");
  assert.match(label, /intermediate states skipped via API/i);
});

test("Timeline label for forced IN_TRANSIT → REFUNDED marks intermediate skip", () => {
  const label = getTransitionEventName("IN_TRANSIT", "REFUNDED");
  assert.match(label, /intermediate states skipped via API/i);
});

test("Timeline label for standard RECEIVED → REFUNDED is unchanged", () => {
  assert.equal(getTransitionEventName("RECEIVED", "REFUNDED"), "Refund processed");
});

test("TRANSITIONS table contains all 12 ReturnStatus enum members", () => {
  // Compile-time + runtime guard: every enum member is keyed in the table,
  // so a future status added to the schema fails the test until handled.
  const keys = Object.keys(TRANSITIONS).sort();
  assert.deepEqual(keys, [
    "APPROVED",
    "AWAITING_SHIPMENT",
    "CANCELLED",
    "CLOSED",
    "EXCHANGED",
    "IN_TRANSIT",
    "PARTIALLY_ACCEPTED",
    "PENDING_REVIEW",
    "RECEIVED",
    "REFUNDED",
    "REJECTED",
    "SUBMITTED",
  ]);
});
