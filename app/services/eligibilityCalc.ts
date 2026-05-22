import type { ShopifyOrder } from "./shopify.types";

// Pure, dependency-free eligibility math. Lives outside the .server file so
// it can be unit-tested without Prisma / Shopify auth.

const SUCCESS_FULFILLMENT_STATUS = "SUCCESS";

/**
 * Sum the quantity actually delivered to the customer, per line item id.
 *
 * Only fulfillments with `status === "SUCCESS"` count. CANCELLED, FAILURE,
 * OPEN, PENDING and any non-success status mean the item never reached
 * the customer (or was rolled back), so they must not be returnable.
 */
export function calculateFulfilledQuantities(
  order: Pick<ShopifyOrder, "fulfillments">,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const fulfillment of order.fulfillments ?? []) {
    if (fulfillment.status !== SUCCESS_FULFILLMENT_STATUS) continue;
    for (const fli of fulfillment.fulfillmentLineItems?.nodes ?? []) {
      const id = fli.lineItem?.id;
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + (fli.quantity ?? 0));
    }
  }
  return map;
}

export interface ReturnableComputation {
  /** Quantity the customer can still ship back and be refunded for. */
  returnableQuantity: number;
  /** How many units were actually delivered (SUCCESS fulfillments). */
  fulfilledQuantity: number;
  /** Shopify's view of remaining refundable units (set to ordered quantity
   *  when Shopify doesn't return the field — older API versions). */
  refundableQuantity: number;
}

/**
 * Compute how many units of a line item the customer can still return now.
 *
 *   returnable = min(fulfilled, refundable) − alreadyReturnedInOurApp
 *
 * - `fulfilled` ensures we never offer items that were never shipped.
 * - `refundable` ensures we never offer items that Shopify already
 *   refunded/returned outside our app (e.g. directly from Shopify Admin).
 * - The local `alreadyReturned` counter prevents the customer from
 *   double-returning items that have an open return on our side.
 *
 * Negative values clamp to zero — defensive against any out-of-band state.
 */
export function computeReturnable({
  orderedQuantity,
  fulfilledQuantity,
  shopifyRefundableQuantity,
  alreadyReturnedQuantity,
}: {
  orderedQuantity: number;
  fulfilledQuantity: number;
  // Pass undefined when Shopify doesn't return the field — we'll fall back
  // to the ordered quantity as the (loose) upper bound rather than blocking
  // every return.
  shopifyRefundableQuantity: number | undefined;
  alreadyReturnedQuantity: number;
}): ReturnableComputation {
  const refundable =
    typeof shopifyRefundableQuantity === "number"
      ? shopifyRefundableQuantity
      : orderedQuantity;
  const upperBound = Math.min(fulfilledQuantity, refundable);
  const returnable = Math.max(0, upperBound - alreadyReturnedQuantity);
  return {
    returnableQuantity: returnable,
    fulfilledQuantity,
    refundableQuantity: refundable,
  };
}
