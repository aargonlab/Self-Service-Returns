import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUND_CREATE_MUTATION } from "./shopifyGraphql.ts";

// These tests guard against silently losing the @idempotent directive on
// the refundCreate mutation. Shopify Admin API 2026-04+ rejects refundCreate
// without it ("The @idempotent directive is required for this mutation but
// was not provided"), which would break every refund in production.

test("REFUND_CREATE_MUTATION declares a $key variable", () => {
  assert.match(
    REFUND_CREATE_MUTATION,
    /mutation\s+refundCreate\s*\([^)]*\$key\s*:\s*String!/,
    "expected mutation signature to declare $key: String!",
  );
});

test("REFUND_CREATE_MUTATION applies @idempotent(key: $key)", () => {
  // Shopify's @idempotent directive uses `key` (not `uniqueKey`) as its
  // required argument. If this name ever drifts in our mutation, Shopify
  // rejects the call with "Directive 'idempotent' is missing required
  // arguments: key" before executing.
  assert.match(
    REFUND_CREATE_MUTATION,
    /refundCreate\s*\(\s*input:\s*\$input\s*\)\s*@idempotent\s*\(\s*key:\s*\$key\s*\)/,
    "expected refundCreate(...) @idempotent(key: $key)",
  );
});

test("REFUND_CREATE_MUTATION still returns refund id, amount, currency and userErrors", () => {
  // Regression guard: shape used by processRefund() to read the result.
  assert.match(REFUND_CREATE_MUTATION, /refund\s*\{[^}]*\bid\b/);
  assert.match(REFUND_CREATE_MUTATION, /totalRefundedSet\s*\{\s*presentmentMoney\s*\{[^}]*amount/);
  assert.match(REFUND_CREATE_MUTATION, /totalRefundedSet\s*\{\s*presentmentMoney\s*\{[^}]*currencyCode/);
  assert.match(REFUND_CREATE_MUTATION, /userErrors\s*\{[^}]*field[^}]*message/);
});
