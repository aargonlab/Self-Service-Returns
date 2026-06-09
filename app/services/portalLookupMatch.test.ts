import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderNameMatches,
  orderEmailMatches,
  type PortalOrderLike,
} from "./portalLookupMatch.ts";

// Lock the matching rules so a future refactor cannot silently re-introduce
// the bugs that hit on shops with a custom order-name prefix (e.g. "NA1023"
// instead of "#1023") and on accounts where order.email differs from
// customer.email.

// -- orderNameMatches -------------------------------------------------------

test("orderNameMatches: classic Shopify '#1023' matches typed '1023'", () => {
  assert.equal(orderNameMatches("#1023", "1023"), true);
});

test("orderNameMatches: classic Shopify '#1023' matches typed '#1023'", () => {
  assert.equal(orderNameMatches("#1023", "#1023"), true);
});

test("orderNameMatches: custom prefix 'NA1023' matches typed 'NA1023'", () => {
  // Regression — the previous code did o.name === `#${cleanName}` which
  // forced a leading "#" that never appears on shops with custom prefixes.
  assert.equal(orderNameMatches("NA1023", "NA1023"), true);
});

test("orderNameMatches: custom prefix 'NA1023' matches typed '#NA1023'", () => {
  assert.equal(orderNameMatches("NA1023", "#NA1023"), true);
});

test("orderNameMatches: case-insensitive ('na1023' typed for 'NA1023' order)", () => {
  assert.equal(orderNameMatches("NA1023", "na1023"), true);
});

test("orderNameMatches: trims whitespace", () => {
  assert.equal(orderNameMatches("#1023", "  1023  "), true);
});

test("orderNameMatches: rejects different numbers", () => {
  assert.equal(orderNameMatches("#1023", "1024"), false);
});

test("orderNameMatches: rejects bare number against custom-prefixed order", () => {
  // Typing "1023" for an order named "NA1023" must NOT match — that would
  // collide with another shop that uses "#1023".
  assert.equal(orderNameMatches("NA1023", "1023"), false);
});

test("orderNameMatches: empty / null inputs return false", () => {
  assert.equal(orderNameMatches(null, "1023"), false);
  assert.equal(orderNameMatches("#1023", null), false);
  assert.equal(orderNameMatches("", ""), false);
  assert.equal(orderNameMatches(undefined, undefined), false);
});

// -- orderEmailMatches ------------------------------------------------------

const orderBase: PortalOrderLike = { name: "#1023", email: null, customer: null };

test("orderEmailMatches: matches order.email exactly", () => {
  const order = { ...orderBase, email: "a@example.com" };
  assert.equal(orderEmailMatches(order, "a@example.com"), true);
});

test("orderEmailMatches: matches order.email case-insensitively and trimmed", () => {
  const order = { ...orderBase, email: "A@Example.COM" };
  assert.equal(orderEmailMatches(order, "  a@example.com "), true);
});

test("orderEmailMatches: falls back to customer.email when order.email is empty", () => {
  // Real-world: guest checkout where order.email is set on the shopify-side
  // record but the linked Customer (post-claim) has a different canonical
  // email. Or vice versa. The customer typing their own address must work.
  const order = { ...orderBase, email: null, customer: { email: "c@example.com" } };
  assert.equal(orderEmailMatches(order, "c@example.com"), true);
});

test("orderEmailMatches: falls back to customer.email when order.email differs", () => {
  const order = {
    ...orderBase,
    email: "shop-staff@example.com",
    customer: { email: "real-customer@example.com" },
  };
  assert.equal(orderEmailMatches(order, "real-customer@example.com"), true);
});

test("orderEmailMatches: rejects mismatch on both fields", () => {
  const order = {
    ...orderBase,
    email: "a@example.com",
    customer: { email: "b@example.com" },
  };
  assert.equal(orderEmailMatches(order, "c@example.com"), false);
});

test("orderEmailMatches: empty / null input is never a match (defensive)", () => {
  const order = { ...orderBase, email: "a@example.com" };
  assert.equal(orderEmailMatches(order, ""), false);
  assert.equal(orderEmailMatches(order, null), false);
  assert.equal(orderEmailMatches(order, "   "), false);
  assert.equal(orderEmailMatches(order, undefined), false);
});
