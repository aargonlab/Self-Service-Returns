import type { ReturnSettings } from "@prisma/client";
import { differenceInDays } from "date-fns";
import type {
  ShopifyOrder,
  EligibleItem,
  EligibilityResult,
} from "~/services/shopify.types";
import {
  ORDER_QUERY,
  RETURN_CREATE_MUTATION,
  RETURN_REQUEST_MUTATION,
  RETURN_APPROVE_REQUEST_MUTATION,
  RETURN_DECLINE_REQUEST_MUTATION,
  SUGGESTED_REFUND_QUERY,
  REFUND_CREATE_MUTATION,
  DRAFT_ORDER_CREATE_MUTATION,
  DRAFT_ORDER_COMPLETE_MUTATION,
  RETURN_CLOSE_MUTATION,
  RETURN_CANCEL_MUTATION,
} from "~/utils/shopifyGraphql";
import { findReturnRequestsByOrder } from "~/models/returnRequest.server";
import {
  calculateFulfilledQuantities,
  computeReturnable,
} from "~/services/eligibilityCalc";

// Type for the admin API context from Shopify authenticate
type AdminApiContext = {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response>;
};

export async function fetchOrder(
  admin: AdminApiContext,
  orderId: string,
): Promise<ShopifyOrder | null> {
  try {
    const response = await admin.graphql(ORDER_QUERY, {
      variables: { id: orderId },
    });

    const { data } = await response.json();
    return data?.order ?? null;
  } catch (error) {
    console.error("fetchOrder failed:", error);
    return null;
  }
}


export async function checkReturnEligibility(
  admin: AdminApiContext,
  order: ShopifyOrder,
  settings: ReturnSettings,
  shop: string,
  marketId?: string | null,
): Promise<EligibilityResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const eligibleItems: EligibleItem[] = [];
  let windowExpired = false;

  // Check if order is cancelled
  if (order.cancelledAt) {
    reasons.push("This order has been cancelled and is not eligible for returns.");
    return { eligible: false, eligibleItems: [], reasons, order };
  }

  // Check if order is closed (fraud, unfulfilled, etc.)
  if (order.closedAt && order.displayFulfillmentStatus !== "FULFILLED") {
    reasons.push("This order has been closed and is not eligible for returns.");
    return { eligible: false, eligibleItems: [], reasons, order };
  }

  // Determine effective return window (per-market or global)
  let effectiveWindowDays = settings.returnWindowDays;
  if (marketId) {
    const marketWindows = (settings.marketReturnWindows as Array<{ marketId: string; marketName: string; returnWindowDays: number }>) || [];
    const marketWindow = marketWindows.find(mw => mw.marketId === marketId);
    if (marketWindow) {
      effectiveWindowDays = marketWindow.returnWindowDays;
    }
  }

  // Check if order has any fulfillments
  const hasFulfillments = order.fulfillments && order.fulfillments.length > 0;
  if (!hasFulfillments) {
    reasons.push("This order has not been fulfilled yet.");
    return { eligible: false, eligibleItems: [], reasons, order };
  }

  // Check if within return window
  const latestFulfillment = order.fulfillments.reduce((latest, f) => {
    const fDate = new Date(f.createdAt);
    return fDate > new Date(latest.createdAt) ? f : latest;
  }, order.fulfillments[0]);

  // Use deliveredAt if available, fall back to estimatedDeliveryAt, then createdAt
  const fulfillmentDate = latestFulfillment.deliveredAt
    ? new Date(latestFulfillment.deliveredAt)
    : new Date(latestFulfillment.createdAt);

  const daysSinceFulfillment = differenceInDays(
    new Date(),
    fulfillmentDate,
  );

  if (daysSinceFulfillment > effectiveWindowDays) {
    windowExpired = true;
    warnings.push(
      `The return window of ${effectiveWindowDays} days has expired.`,
    );
  }

  // Identify active vs terminal Shopify returns
  const terminalReturnStatuses = ["CANCELLED", "DECLINED", "CLOSED"];
  const activeShopifyReturns = (order.returns?.nodes ?? []).filter(
    (ret) => !terminalReturnStatuses.includes(ret.status),
  );

  // Auto-cancel orphaned Shopify returns: if a Shopify return is still active
  // but our local DB shows it as CANCELLED, cancel it in Shopify automatically
  const cancelledOrphanIds = new Set<string>();
  if (activeShopifyReturns.length > 0) {
    const prismaModule = await import("~/db.server");
    const prisma = prismaModule.default;

    for (const shopifyReturn of activeShopifyReturns) {
      const localReturn = await prisma.returnRequest.findFirst({
        where: {
          shop,
          shopifyReturnId: shopifyReturn.id,
          status: "CANCELLED",
        },
      });

      if (localReturn) {
        console.warn(`[Eligibility] Auto-cancelling orphaned Shopify return ${shopifyReturn.id} (local status: CANCELLED)`);
        const cancelResult = await cancelShopifyReturn(admin, shopifyReturn.id);
        if ("error" in cancelResult) {
          console.error(`[Eligibility] Failed to auto-cancel orphaned Shopify return ${shopifyReturn.id}:`, cancelResult.error);
          reasons.push("This order has a return that could not be cancelled in Shopify. Please cancel it manually in Shopify admin.");
          return { eligible: false, eligibleItems: [], reasons, order };
        }
        cancelledOrphanIds.add(shopifyReturn.id);
      }
    }
  }

  // Calculate returned quantities per line item from our local DB.
  // Our DB is the source of truth for line-item mapping because:
  // 1. Pre-approval returns (SUBMITTED, PENDING_REVIEW) only exist locally
  // 2. Shopify's ReturnLineItem doesn't expose lineItem ID back via GraphQL
  // findReturnRequestsByOrder excludes CANCELLED and REJECTED — those quantities are returnable again
  const existingReturns = await findReturnRequestsByOrder(shop, order.id);
  const returnedQuantities = new Map<string, number>();
  for (const ret of existingReturns) {
    for (const item of ret.items) {
      const current = returnedQuantities.get(item.shopifyLineItemId) ?? 0;
      returnedQuantities.set(
        item.shopifyLineItemId,
        current + item.quantity,
      );
    }
  }

  // Quantity actually delivered per line item, computed only from
  // SUCCESS-status fulfillments. This is the upper bound on what can be
  // returned, before further capping by refunds processed outside our app.
  const fulfilledQuantities = calculateFulfilledQuantities(order);

  // Build eligible items list
  for (const lineItem of order.lineItems.nodes) {
    const totalReturned = returnedQuantities.get(lineItem.id) ?? 0;
    const {
      returnableQuantity,
      fulfilledQuantity,
      refundableQuantity,
    } = computeReturnable({
      orderedQuantity: lineItem.quantity,
      fulfilledQuantity: fulfilledQuantities.get(lineItem.id) ?? 0,
      shopifyRefundableQuantity: lineItem.refundableQuantity,
      alreadyReturnedQuantity: totalReturned,
    });

    if (returnableQuantity > 0) {
      const price = lineItem.discountedUnitPriceSet?.shopMoney?.amount;
      const currencyCode = lineItem.discountedUnitPriceSet?.shopMoney?.currencyCode;

      const priceAvailable = !!(price && currencyCode);
      if (!priceAvailable) {
        console.warn(`[Shopify] Missing price data for line item ${lineItem.id} (${lineItem.title}) - item flagged with priceAvailable=false`);
      }

      eligibleItems.push({
        lineItemId: lineItem.id,
        title: lineItem.title,
        variantTitle: lineItem.variantTitle,
        sku: lineItem.sku,
        variantId: lineItem.variant?.id ?? null,
        imageUrl: lineItem.image?.url ?? null,
        price: price || "0",
        currencyCode: (() => {
          const code = currencyCode || lineItem.originalUnitPriceSet?.shopMoney?.currencyCode;
          if (!code) {
            console.warn(`[Shopify] Currency code missing for line item ${lineItem.id}, falling back to USD`);
            return "USD";
          }
          return code;
        })(),
        totalQuantity: lineItem.quantity,
        fulfilledQuantity,
        refundableQuantity,
        alreadyReturnedQuantity: totalReturned,
        returnableQuantity,
        priceAvailable,
      });
    }
  }

  if (eligibleItems.length === 0) {
    reasons.push("All items in this order have already been returned.");
    return { eligible: false, eligibleItems: [], reasons, order };
  }

  return {
    eligible: true,
    eligibleItems,
    reasons: [],
    order,
    warnings: warnings.length > 0 ? warnings : undefined,
    windowExpired: windowExpired || undefined,
    effectiveWindowDays,
    daysSinceFulfillment,
  };
}

function getFulfillmentLineItemId(
  order: ShopifyOrder,
  orderLineItemId: string,
): string | null {
  // Use fulfillments[].fulfillmentLineItems — these are FulfillmentLineItem GIDs
  // which is what returnCreate expects (NOT FulfillmentOrderLineItem GIDs)
  for (const fulfillment of order.fulfillments) {
    if (!fulfillment.fulfillmentLineItems?.nodes) continue;
    for (const fli of fulfillment.fulfillmentLineItems.nodes.filter(Boolean)) {
      if (fli?.lineItem?.id === orderLineItemId) {
        return fli.id;
      }
    }
  }
  return null;
}

const RETURN_REASON_LABELS: Record<string, string> = {
  DOESNT_FIT: "Item doesn't fit",
  NOT_AS_DESCRIBED: "Item not as described",
  ARRIVED_DAMAGED: "Item arrived damaged",
  WRONG_ITEM: "Wrong item received",
  CHANGED_MIND: "Changed my mind",
  QUALITY_NOT_EXPECTED: "Quality not as expected",
  OTHER: "Other reason",
};

export async function createReturnOnShopify(
  admin: AdminApiContext,
  order: ShopifyOrder,
  items: Array<{
    lineItemId: string;
    quantity: number;
    returnReason?: string;
    customerNote?: string;
  }>,
): Promise<{ returnId: string } | { error: string }> {
  try {
    // Check if we have fulfillment data with line items
    const hasFulfillmentLineItems = order.fulfillments.some(
      (f) => f.fulfillmentLineItems?.nodes && f.fulfillmentLineItems.nodes.length > 0,
    );
    if (!hasFulfillmentLineItems) {
      console.warn("No fulfillment line items available on order", order.id, "— the order may not be fulfilled yet.");
      return { error: "Cannot create return: no fulfilled items found. The order must be fulfilled before a return can be created." };
    }

    const returnLineItems = [];
    const unmapped: string[] = [];
    for (const item of items) {
      const fulfillmentLineItemId = getFulfillmentLineItemId(order, item.lineItemId);
      if (!fulfillmentLineItemId) {
        unmapped.push(item.lineItemId);
        continue;
      }
      const mappedReason = mapToShopifyReturnReason(item.returnReason);
      // Shopify requires returnReasonNote when reason is OTHER
      const reasonNote = item.customerNote || (mappedReason === "OTHER" ? (RETURN_REASON_LABELS[item.returnReason || ""] || item.returnReason || "Other reason") : undefined);
      returnLineItems.push({
        fulfillmentLineItemId,
        quantity: item.quantity,
        returnReason: mappedReason,
        returnReasonNote: reasonNote,
      });
    }

    if (returnLineItems.length === 0) {
      return { error: `Could not map any items to fulfillment line items. The items may not be fulfilled yet. Unmapped: ${unmapped.join(", ")}` };
    }

    if (unmapped.length > 0) {
      console.warn(`[createReturnOnShopify] ${unmapped.length}/${items.length} items could not be mapped to fulfillment line items (may not be fulfilled yet):`, unmapped);
    }

    const returnInput = {
      orderId: order.id,
      returnLineItems,
      notifyCustomer: true,
      requestedAt: new Date().toISOString(),
    };

    const response = await admin.graphql(RETURN_CREATE_MUTATION, {
      variables: { returnInput },
    });

    const responseJson = await response.json();
    const { data } = responseJson;

    if (data?.returnCreate?.userErrors?.length > 0) {
      const errors = data.returnCreate.userErrors;
      console.error("returnCreate userErrors:", JSON.stringify(errors, null, 2));
      const errorMessages = errors
        .map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`)
        .join("; ");
      return { error: errorMessages };
    }

    if (!data?.returnCreate?.return?.id) {
      console.error("returnCreate unexpected response:", JSON.stringify(responseJson, null, 2));
      return { error: "Shopify returnCreate returned no return ID" };
    }

    return { returnId: data.returnCreate.return.id };
  } catch (error) {
    console.error("Error creating return on Shopify:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function createReplacementDraftOrder(
  admin: AdminApiContext,
  order: ShopifyOrder,
  returnId: string,
  items: Array<{
    lineItemId: string;
    title: string;
    variantTitle?: string | null;
    variantId?: string | null;
    quantity: number;
  }>,
): Promise<{ draftOrderId: string; orderId: string; orderName: string } | { error: string }> {
  try {
    // Bug #379: Validate that variants exist before creating line items
    const lineItems = items.map((item) => {
      if (item.variantId) {
        // Use real Shopify variant — this creates a proper line item linked to inventory
        return {
          variantId: item.variantId,
          quantity: item.quantity,
          appliedDiscount: {
            title: "Replacement - No charge",
            value: 100,
            valueType: "PERCENTAGE",
          },
        };
      }
      // Fallback: custom line item by title (if variant ID is not available or variant deleted)
      console.warn(`Creating custom line item for replacement - variant ID missing for: ${item.title}`);
      return {
        title: `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ""}`,
        quantity: item.quantity,
        originalUnitPrice: "0.00",
      };
    });

    const response = await admin.graphql(DRAFT_ORDER_CREATE_MUTATION, {
      variables: {
        input: {
          email: order.email,
          customerId: order.customer?.id,
          lineItems,
          note: `Replacement for return ${returnId} (Original order: ${order.name})`,
          customAttributes: [
            { key: "original_order_id", value: order.id },
            { key: "original_order_name", value: order.name },
            { key: "replacement_for_return", value: returnId },
          ],
          tags: ["replacement", "auto-created"],
          shippingAddress: order.shippingAddress ? {
            firstName: order.shippingAddress.firstName,
            lastName: order.shippingAddress.lastName,
            address1: order.shippingAddress.address1,
            address2: order.shippingAddress.address2,
            city: order.shippingAddress.city,
            province: order.shippingAddress.province,
            zip: order.shippingAddress.zip,
            country: order.shippingAddress.country,
            phone: order.shippingAddress.phone,
            company: order.shippingAddress.company,
          } : undefined,
          billingAddress: order.billingAddress ? {
            firstName: order.billingAddress.firstName,
            lastName: order.billingAddress.lastName,
            address1: order.billingAddress.address1,
            address2: order.billingAddress.address2,
            city: order.billingAddress.city,
            province: order.billingAddress.province,
            zip: order.billingAddress.zip,
            country: order.billingAddress.country,
            phone: order.billingAddress.phone,
            company: order.billingAddress.company,
          } : undefined,
        },
      },
    });

    const { data } = await response.json();
    if (data?.draftOrderCreate?.userErrors?.length > 0) {
      const errorMessages = data.draftOrderCreate.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    const draftOrder = data.draftOrderCreate.draftOrder;

    // Immediately complete the draft order (no payment required since price is $0)
    const completeResult = await completeDraftOrder(admin, draftOrder.id, false);
    if ("error" in completeResult) {
      return { error: `Draft order created but failed to complete: ${completeResult.error}` };
    }

    return {
      draftOrderId: draftOrder.id,
      orderId: completeResult.orderId,
      orderName: completeResult.orderName,
    };
  } catch (error) {
    console.error("Error creating replacement order:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function completeDraftOrder(
  admin: AdminApiContext,
  draftOrderId: string,
  paymentPending: boolean = true,
): Promise<{ orderId: string; orderName: string } | { error: string }> {
  try {
    const response = await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
      variables: { id: draftOrderId, paymentPending },
    });

    const { data } = await response.json();
    if (data?.draftOrderComplete?.userErrors?.length > 0) {
      const errorMessages = data.draftOrderComplete.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    if (!data?.draftOrderComplete?.draftOrder?.order) {
      return { error: "Draft order completion did not return an order — payment may still be pending." };
    }

    const order = data.draftOrderComplete.draftOrder.order;
    return { orderId: order.id, orderName: order.name };
  } catch (error) {
    console.error("Error completing draft order:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function closeShopifyReturn(
  admin: AdminApiContext,
  shopifyReturnId: string,
): Promise<{ success: boolean } | { error: string }> {
  try {
    const response = await admin.graphql(RETURN_CLOSE_MUTATION, {
      variables: { id: shopifyReturnId },
    });

    const { data } = await response.json();
    if (data?.returnClose?.userErrors?.length > 0) {
      const errorMessages = data.returnClose.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    return { success: true };
  } catch (error) {
    console.error("Error closing Shopify return:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function cancelShopifyReturn(
  admin: AdminApiContext,
  shopifyReturnId: string,
): Promise<{ success: boolean } | { error: string }> {
  try {
    const response = await admin.graphql(RETURN_CANCEL_MUTATION, {
      variables: { id: shopifyReturnId },
    });

    const { data } = await response.json();
    if (data?.returnCancel?.userErrors?.length > 0) {
      const errorMessages = data.returnCancel.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    return { success: true };
  } catch (error) {
    console.error("Error cancelling Shopify return:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Create a Shopify return request (REQUESTED status, needs approval).
 * Used for manual-review returns so they appear in Shopify admin.
 */
export async function createReturnRequestOnShopify(
  admin: AdminApiContext,
  order: ShopifyOrder,
  items: Array<{
    lineItemId: string;
    quantity: number;
    returnReason?: string;
    customerNote?: string;
  }>,
): Promise<{ returnId: string } | { error: string }> {
  try {
    const hasFulfillmentLineItems = order.fulfillments.some(
      (f) => f.fulfillmentLineItems?.nodes && f.fulfillmentLineItems.nodes.length > 0,
    );
    if (!hasFulfillmentLineItems) {
      return { error: "Cannot create return request: no fulfilled items found." };
    }

    const returnLineItems = [];
    const unmapped: string[] = [];
    for (const item of items) {
      const fulfillmentLineItemId = getFulfillmentLineItemId(order, item.lineItemId);
      if (!fulfillmentLineItemId) {
        unmapped.push(item.lineItemId);
        continue;
      }
      const mappedReason = mapToShopifyReturnReason(item.returnReason);
      // ReturnRequestLineItemInput uses `customerNote` (max 300 chars), NOT `returnReasonNote`
      const note = item.customerNote || (mappedReason === "OTHER" ? (RETURN_REASON_LABELS[item.returnReason || ""] || item.returnReason || "Other reason") : undefined);
      returnLineItems.push({
        fulfillmentLineItemId,
        quantity: item.quantity,
        returnReason: mappedReason,
        customerNote: note ? note.slice(0, 300) : undefined,
      });
    }

    if (returnLineItems.length === 0) {
      return { error: `Could not map any items to fulfillment line items. Unmapped: ${unmapped.join(", ")}` };
    }

    if (unmapped.length > 0) {
      console.warn(`[createReturnRequestOnShopify] ${unmapped.length}/${items.length} items unmapped:`, unmapped);
    }

    const response = await admin.graphql(RETURN_REQUEST_MUTATION, {
      variables: {
        input: {
          orderId: order.id,
          returnLineItems,
        },
      },
    });

    const responseJson = await response.json();
    const { data } = responseJson;

    if (data?.returnRequest?.userErrors?.length > 0) {
      const errors = data.returnRequest.userErrors;
      console.error("returnRequest userErrors:", JSON.stringify(errors, null, 2));
      const errorMessages = errors
        .map((e: { field: string[]; message: string }) => `${e.field?.join(".")}: ${e.message}`)
        .join("; ");
      return { error: errorMessages };
    }

    if (!data?.returnRequest?.return?.id) {
      console.error("returnRequest unexpected response:", JSON.stringify(responseJson, null, 2));
      return { error: "Shopify returnRequest returned no return ID" };
    }

    return { returnId: data.returnRequest.return.id };
  } catch (error) {
    console.error("Error creating return request on Shopify:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Approve a Shopify return request (REQUESTED → OPEN).
 */
export async function approveReturnRequestOnShopify(
  admin: AdminApiContext,
  shopifyReturnId: string,
): Promise<{ success: boolean } | { error: string }> {
  try {
    const response = await admin.graphql(RETURN_APPROVE_REQUEST_MUTATION, {
      variables: { input: { id: shopifyReturnId } },
    });

    const { data } = await response.json();
    if (data?.returnApproveRequest?.userErrors?.length > 0) {
      const errorMessages = data.returnApproveRequest.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    return { success: true };
  } catch (error) {
    console.error("Error approving Shopify return request:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Decline a Shopify return request (REQUESTED → DECLINED).
 */
export async function declineReturnRequestOnShopify(
  admin: AdminApiContext,
  shopifyReturnId: string,
  declineReason: string = "RETURN_PERIOD_ENDED",
): Promise<{ success: boolean } | { error: string }> {
  try {
    const response = await admin.graphql(RETURN_DECLINE_REQUEST_MUTATION, {
      variables: { input: { id: shopifyReturnId, declineReason } },
    });

    const { data } = await response.json();
    if (data?.returnDeclineRequest?.userErrors?.length > 0) {
      const errorMessages = data.returnDeclineRequest.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    return { success: true };
  } catch (error) {
    console.error("Error declining Shopify return request:", error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function processRefund(
  admin: AdminApiContext,
  orderId: string,
  items: Array<{
    lineItemId: string;
    quantity: number;
  }>,
  // Deterministic key used by Shopify's @idempotent directive to dedup retries.
  // Pass a value tied to the operation identity (e.g. `refund-${returnRequestId}`).
  uniqueKey: string,
): Promise<
  { refundId: string; amount: string; currency: string } | { error: string }
> {
  if (!uniqueKey) {
    return { error: "Internal error: refund idempotency key was not provided." };
  }
  try {
    const refundLineItems = items.map((item) => ({
      lineItemId: item.lineItemId,
      quantity: item.quantity,
    }));

    // Step 1: Ask Shopify to calculate the correct refund amounts
    const suggestedResponse = await admin.graphql(SUGGESTED_REFUND_QUERY, {
      variables: {
        id: orderId,
        refundLineItems,
      },
    });
    const suggestedData = await suggestedResponse.json();
    const suggested = suggestedData.data?.order?.suggestedRefund;

    if (!suggested) {
      return { error: "Could not calculate refund amount from Shopify." };
    }

    // Step 2: Build transactions from the suggested refund
    const suggestedTransactions = suggested.suggestedTransactions || [];

    // Validate that we have refundable transactions
    if (!suggestedTransactions || suggestedTransactions.length === 0) {
      return { error: "No refundable transactions found for this return" };
    }

    const transactions = suggestedTransactions
      .filter(
        (t: { parentTransaction: { id: string; gateway: string } | null }) =>
          t.parentTransaction?.id && t.parentTransaction?.gateway,
      )
      .map(
        (t: { parentTransaction: { id: string; gateway: string }; amountSet: { presentmentMoney: { amount: string; currencyCode: string } } }) => ({
          parentId: t.parentTransaction.id,
          amount: t.amountSet.presentmentMoney.amount,
          kind: "REFUND",
          gateway: t.parentTransaction.gateway,
          orderId,
        }),
      );

    // Validate that filtering didn't remove all transactions
    if (transactions.length === 0 && suggestedTransactions.length > 0) {
      console.warn(`[Shopify] All ${suggestedTransactions.length} transactions were filtered out — no eligible transactions found`);
    }
    if (transactions.length === 0) {
      return { error: "No valid refundable transactions found for this return" };
    }

    // Extract the presentment currency from the suggested transactions
    const presentmentCurrency = suggestedTransactions[0]?.amountSet?.presentmentMoney?.currencyCode;

    // Step 3: Create the actual refund with correct amounts
    const response = await admin.graphql(REFUND_CREATE_MUTATION, {
      variables: {
        input: {
          orderId,
          ...(presentmentCurrency ? { currency: presentmentCurrency } : {}),
          refundLineItems: items.map((item) => ({
            lineItemId: item.lineItemId,
            quantity: item.quantity,
            restockType: "NO_RESTOCK",
          })),
          transactions,
          notify: true,
        },
        key: uniqueKey,
      },
    });

    const { data } = await response.json();

    if (data?.refundCreate?.userErrors?.length > 0) {
      const errorMessages = data.refundCreate.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { error: errorMessages };
    }

    const refund = data?.refundCreate?.refund;
    if (!refund) {
      return { error: "Refund creation returned no data from Shopify." };
    }

    return {
      refundId: refund.id,
      amount: refund.totalRefundedSet.presentmentMoney.amount,
      currency: refund.totalRefundedSet.presentmentMoney.currencyCode,
    };
  } catch (error) {
    console.error("Error processing refund:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function mapToShopifyReturnReason(
  reason?: string,
): string {
  const mapping: Record<string, string> = {
    DOESNT_FIT: "SIZE_TOO_SMALL",
    NOT_AS_DESCRIBED: "STYLE",
    ARRIVED_DAMAGED: "DEFECTIVE",
    WRONG_ITEM: "WRONG_ITEM",
    CHANGED_MIND: "UNWANTED",
    QUALITY_NOT_EXPECTED: "DEFECTIVE",
    OTHER: "OTHER",
  };
  return mapping[reason ?? ""] ?? "OTHER";
}
