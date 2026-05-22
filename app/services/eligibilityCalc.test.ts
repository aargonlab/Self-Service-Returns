import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFulfilledQuantities,
  computeReturnable,
} from "./eligibilityCalc.ts";
import type { ShopifyOrder } from "./shopify.types.ts";

// Helper builders — keep these tiny so each test reads as one concrete scenario.

function fulfillment(
  status: string,
  items: Array<{ lineItemId: string; quantity: number }>,
) {
  return {
    id: `f-${Math.random()}`,
    status,
    createdAt: "2026-01-01T00:00:00Z",
    deliveredAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    displayStatus: null,
    trackingInfo: [],
    fulfillmentLineItems: {
      nodes: items.map((i) => ({
        id: `fli-${i.lineItemId}`,
        lineItem: { id: i.lineItemId },
        quantity: i.quantity,
      })),
    },
  };
}

function order(
  fulfillments: ReturnType<typeof fulfillment>[],
): Pick<ShopifyOrder, "fulfillments"> {
  return { fulfillments };
}

// -- calculateFulfilledQuantities -------------------------------------------

test("calculateFulfilledQuantities: no fulfillments → empty map", () => {
  assert.equal(calculateFulfilledQuantities(order([])).size, 0);
});

test("calculateFulfilledQuantities: single SUCCESS fulfillment counts every line item", () => {
  const result = calculateFulfilledQuantities(
    order([fulfillment("SUCCESS", [
      { lineItemId: "A", quantity: 1 },
      { lineItemId: "B", quantity: 2 },
    ])]),
  );
  assert.equal(result.get("A"), 1);
  assert.equal(result.get("B"), 2);
});

test("calculateFulfilledQuantities: same line item across multiple SUCCESS fulfillments sums", () => {
  const result = calculateFulfilledQuantities(
    order([
      fulfillment("SUCCESS", [{ lineItemId: "A", quantity: 1 }]),
      fulfillment("SUCCESS", [{ lineItemId: "A", quantity: 2 }]),
    ]),
  );
  assert.equal(result.get("A"), 3);
});

test("calculateFulfilledQuantities: CANCELLED / FAILURE / OPEN / PENDING are excluded", () => {
  const result = calculateFulfilledQuantities(
    order([
      fulfillment("CANCELLED", [{ lineItemId: "A", quantity: 5 }]),
      fulfillment("FAILURE", [{ lineItemId: "A", quantity: 5 }]),
      fulfillment("OPEN", [{ lineItemId: "A", quantity: 5 }]),
      fulfillment("PENDING", [{ lineItemId: "A", quantity: 5 }]),
    ]),
  );
  assert.equal(result.has("A"), false);
});

test("calculateFulfilledQuantities: mix of SUCCESS and other statuses counts only SUCCESS", () => {
  const result = calculateFulfilledQuantities(
    order([
      fulfillment("SUCCESS", [{ lineItemId: "A", quantity: 1 }]),
      fulfillment("CANCELLED", [{ lineItemId: "A", quantity: 4 }]),
    ]),
  );
  assert.equal(result.get("A"), 1);
});

// -- computeReturnable ------------------------------------------------------

test("computeReturnable: classic happy path — ordered 3, all fulfilled, none returned → 3 returnable", () => {
  const { returnableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 3,
    shopifyRefundableQuantity: 3,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 3);
});

test("computeReturnable: partial fulfillment — ordered 3, fulfilled 1 → only 1 returnable", () => {
  // The original bug: portal used to show 3.
  const { returnableQuantity, fulfilledQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 1,
    shopifyRefundableQuantity: 3,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 1);
  assert.equal(fulfilledQuantity, 1);
});

test("computeReturnable: never fulfilled (backorder) → 0 returnable", () => {
  const { returnableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 0,
    shopifyRefundableQuantity: 3,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 0);
});

test("computeReturnable: refunded outside SSR — refundable=0 caps returnable to 0", () => {
  // Merchant ran a refund through Shopify Admin directly. Our local DB has
  // no record, but Shopify decremented refundableQuantity.
  const { returnableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 3,
    shopifyRefundableQuantity: 0,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 0);
});

test("computeReturnable: partial external refund — refundable=1 caps returnable to 1", () => {
  const { returnableQuantity, refundableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 3,
    shopifyRefundableQuantity: 1,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 1);
  assert.equal(refundableQuantity, 1);
});

test("computeReturnable: subtracts what's already in an open return in our app", () => {
  const { returnableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 3,
    shopifyRefundableQuantity: 3,
    alreadyReturnedQuantity: 2,
  });
  assert.equal(returnableQuantity, 1);
});

test("computeReturnable: alreadyReturned > upperBound clamps to 0 (no negative)", () => {
  // Defensive: should never happen in practice, but if a Shopify-side
  // refund and a local return overlap, we never offer a negative count.
  const { returnableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 1,
    shopifyRefundableQuantity: 3,
    alreadyReturnedQuantity: 5,
  });
  assert.equal(returnableQuantity, 0);
});

test("computeReturnable: refundable undefined → falls back to orderedQuantity (no over-blocking)", () => {
  // If Shopify (older API or partial selection) doesn't expose
  // refundableQuantity, we don't want to block every return — we trust
  // fulfilledQuantity and ordered as bounds.
  const { returnableQuantity, refundableQuantity } = computeReturnable({
    orderedQuantity: 3,
    fulfilledQuantity: 2,
    shopifyRefundableQuantity: undefined,
    alreadyReturnedQuantity: 0,
  });
  assert.equal(returnableQuantity, 2);
  assert.equal(refundableQuantity, 3);
});

test("computeReturnable: returns the actual quantities used in the calc", () => {
  const result = computeReturnable({
    orderedQuantity: 5,
    fulfilledQuantity: 4,
    shopifyRefundableQuantity: 2,
    alreadyReturnedQuantity: 1,
  });
  assert.equal(result.fulfilledQuantity, 4);
  assert.equal(result.refundableQuantity, 2);
  // upper bound = min(4, 2) = 2; minus 1 already returned = 1
  assert.equal(result.returnableQuantity, 1);
});
