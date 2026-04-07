import type { PolicyCondition, PolicyOutcome } from "~/models/returnPolicy.server";
import { getActivePolicies, savePolicyEvaluation } from "~/models/returnPolicy.server";
import { getSettings } from "~/models/returnSettings.server";
import type { ShopifyOrder } from "~/services/shopify.types";
import { differenceInCalendarDays } from "date-fns";
import prisma from "~/db.server";

export interface PolicyContext {
  shop: string;
  order: ShopifyOrder;
  lineItem?: {
    id: string;
    title: string;
    sku: string | null;
    tags: string[];
    productType: string | null;
    vendor: string | null;
    price: string;
  };
  returnReason?: string;
  customerReturnCount?: number;
  daysSinceFulfillment: number;
  orderTotal: number;
}

export interface EvaluationResult {
  eligible: boolean;
  autoAction?: "AUTO_APPROVE" | "AUTO_REJECT" | "MANUAL_REVIEW";
  requiresPhoto: boolean;
  excludedItems: string[]; // line item IDs that are excluded
  overriddenWindowDays?: number;
  reasons: string[];
  policyResults: Array<{
    policyId: string;
    policyName: string;
    matched: boolean;
    outcome: string;
  }>;
}

export async function evaluatePolicies(
  shop: string,
  order: ShopifyOrder,
  settings: Awaited<ReturnType<typeof getSettings>>,
  returnReason?: string,
  resolutionType?: "REFUND" | "EXCHANGE",
  returnReasonId?: string,
): Promise<EvaluationResult> {
  const policies = await getActivePolicies(shop);

  const result: EvaluationResult = {
    eligible: true,
    requiresPhoto: false,
    excludedItems: [],
    reasons: [],
    policyResults: [],
  };

  // Bug #232-245: Collect manual review reason IDs during policy evaluation
  // to avoid re-iterating all policies later
  const allManualReviewReasonIds: string[] = [];

  // Calculate context values
  const latestFulfillment = order.fulfillments?.length
    ? order.fulfillments.reduce((latest, f) => {
        const fDate = new Date(f.createdAt);
        return fDate > new Date(latest.createdAt) ? f : latest;
      }, order.fulfillments[0])
    : null;

  if (!latestFulfillment) {
    result.eligible = false;
    result.reasons.push("This order has not been fulfilled yet.");
    return result;
  }

  // Use deliveredAt if available, fall back to createdAt
  const fulfillmentDate = latestFulfillment.deliveredAt
    ? new Date(latestFulfillment.deliveredAt)
    : new Date(latestFulfillment.createdAt);

  // Bug #551: Use differenceInCalendarDays to avoid timezone-dependent calculations
  // differenceInCalendarDays compares calendar dates regardless of time component
  const daysSinceFulfillment = differenceInCalendarDays(new Date(), fulfillmentDate);

  // Bug #377: Filter out NaN values from orderTotal calculation and log warnings
  // Bug #552: Track validPriceCount to distinguish legitimate free orders (price=0, validPriceCount>0)
  //           from corrupted data (all invalid prices, validPriceCount=0). Legitimate free orders
  //           have valid price fields set to 0, while corrupted data has unparseable/invalid prices.
  let validPriceCount = 0;
  const orderTotal = order.lineItems.nodes.reduce((sum, item) => {
    const priceStr = item.discountedUnitPriceSet?.shopMoney?.amount
      ?? item.originalUnitPriceSet?.shopMoney?.amount
      ?? "0";
    const price = parseFloat(priceStr);
    if (isNaN(price)) {
      console.warn(`NaN price detected for line item ${item.id}: ${priceStr} - skipping from orderTotal calculation`);
      return sum;
    }
    if (price < 0) {
      console.warn(`Negative price for line item ${item.id}: ${price} - skipping from orderTotal calculation`);
      return sum;
    }
    validPriceCount++;
    return sum + price * item.quantity;
  }, 0);

  // Guard: if all items had invalid prices, orderTotal is 0 which may cause incorrect policy evaluation
  const orderTotalUnknown = validPriceCount === 0 && order.lineItems.nodes.length > 0;
  if (orderTotalUnknown) {
    console.error(`[PolicyEngine] All ${order.lineItems.nodes.length} line items have invalid prices for order ${order.id}. orderTotal defaults to 0, which may cause incorrect policy evaluation.`);
  }

  // Additional guard: if orderTotal is NaN after calculation, log error (shouldn't happen with above guards)
  if (isNaN(orderTotal)) {
    console.error(`Order total calculation resulted in NaN for order ${order.id} - this indicates a logic error`);
  }

  // Count customer's previous returns
  const customerEmail = order.email?.trim().toLowerCase();
  let customerReturnCount = 0;
  if (customerEmail) {
    const count = await prisma.returnRequest.count({
      where: {
        shop,
        customerEmail: { equals: customerEmail, mode: "insensitive" },
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
    });
    customerReturnCount = count;
  }

  // Check base return window first (from settings)
  let effectiveWindowDays = settings.returnWindowDays;

  // Evaluate each policy
  for (const policy of policies) {
    const conditions = policy.conditions as unknown as PolicyCondition[];
    const outcome = policy.outcome as unknown as PolicyOutcome;

    // Build base context (order-level)
    const baseContext: PolicyContext & { orderTotalUnknown?: boolean } = {
      shop,
      order,
      daysSinceFulfillment,
      orderTotal,
      customerReturnCount,
      returnReason,
      orderTotalUnknown,
    };

    if (policy.type === "EXCLUSION" || policy.type === "REQUIREMENT") {
      // Evaluate per-item for exclusion and requirement policies
      for (const lineItem of order.lineItems.nodes) {
        const itemContext: PolicyContext = {
          ...baseContext,
          lineItem: {
            id: lineItem.id,
            title: lineItem.title,
            sku: lineItem.sku,
            tags: lineItem.product?.tags ?? [],
            productType: lineItem.product?.productType ?? null,
            vendor: lineItem.product?.vendor ?? null,
            price: lineItem.discountedUnitPriceSet?.shopMoney?.amount || "0",
          },
        };

        const matched = evaluateConditions(conditions, itemContext);
        result.policyResults.push({
          policyId: policy.id,
          policyName: policy.name,
          matched,
          outcome: outcome.action,
        });

        if (matched) {
          if (outcome.action === "EXCLUDE") {
            result.excludedItems.push(lineItem.id);
            result.reasons.push(outcome.message || `${lineItem.title} is not eligible for return.`);
          } else if (outcome.action === "REQUIRE_PHOTO") {
            result.requiresPhoto = true;
          }
        }
      }
    } else {
      // Evaluate order-level for eligibility and auto-action policies
      const matched = evaluateConditions(conditions, baseContext);
      result.policyResults.push({
        policyId: policy.id,
        policyName: policy.name,
        matched,
        outcome: outcome.action,
      });

      if (matched) {
        if (outcome.action === "OVERRIDE_WINDOW" && outcome.returnWindowDays) {
          effectiveWindowDays = outcome.returnWindowDays;
          result.overriddenWindowDays = outcome.returnWindowDays;
        } else if (outcome.action === "AUTO_APPROVE") {
          if (!result.autoAction) {
            result.autoAction = "AUTO_APPROVE";
          } else if (result.autoAction === "AUTO_REJECT") {
            // Conflicting: REJECT was already set, APPROVE also matches → MANUAL_REVIEW
            result.autoAction = "MANUAL_REVIEW";
            result.reasons.push("Conflicting auto-action policies detected — flagged for manual review.");
          }
          // If already MANUAL_REVIEW, keep it

          // Collect manual review reason IDs from AUTO_APPROVE policies
          if (outcome.manualReviewReasonIds?.length) {
            allManualReviewReasonIds.push(...outcome.manualReviewReasonIds);
          }
        } else if (outcome.action === "AUTO_REJECT") {
          if (!result.autoAction) {
            result.autoAction = "AUTO_REJECT";
            result.reasons.push(outcome.message || "This return has been automatically declined.");
          } else if (result.autoAction === "AUTO_APPROVE") {
            // Conflicting: APPROVE was already set, REJECT also matches → MANUAL_REVIEW
            result.autoAction = "MANUAL_REVIEW";
            result.reasons.push("Conflicting auto-action policies detected — flagged for manual review.");
          }
          // If already MANUAL_REVIEW, keep it (don't downgrade to REJECT)
          // If already AUTO_REJECT, keep it
        } else if (outcome.action === "MANUAL_REVIEW") {
          // MANUAL_REVIEW always wins over APPROVE, but respects existing MANUAL_REVIEW
          if (result.autoAction !== "MANUAL_REVIEW") {
            result.autoAction = "MANUAL_REVIEW";
          }
        } else if (outcome.action === "EXCLUDE") {
          result.eligible = false;
          result.reasons.push(outcome.message || "This order is not eligible for returns.");
        }
      }
    }
  }

  // Fallback: If no AUTO_ACTION policy matched, check the global autoApprove settings
  if (!result.autoAction && resolutionType) {
    if (resolutionType === "EXCHANGE" && settings.autoApproveReplacements) {
      result.autoAction = "AUTO_APPROVE";
      console.info(`[PolicyEngine] Fallback auto-approve: autoApproveReplacements=true for ${shop}`);
    } else if (resolutionType === "REFUND" && settings.autoApprove) {
      result.autoAction = "AUTO_APPROVE";
      console.info(`[PolicyEngine] Fallback auto-approve: autoApprove=true for ${shop}`);
    }
  }

  // Check if the return reason requires manual review despite AUTO_APPROVE
  // Bug #232-245: Use pre-collected manual review reason IDs instead of re-iterating
  if (result.autoAction === "AUTO_APPROVE" && returnReasonId && allManualReviewReasonIds.length > 0) {
    if (allManualReviewReasonIds.includes(returnReasonId)) {
      result.autoAction = "MANUAL_REVIEW";
      result.reasons.push("This return reason requires manual review.");
    }
  }

  // Check return window with effective (possibly overridden) window
  if (daysSinceFulfillment > effectiveWindowDays) {
    result.eligible = false;
    result.reasons.push(`The return window of ${effectiveWindowDays} days has expired.`);
  }

  // Check if ALL items are excluded
  const allItemIds = order.lineItems.nodes.map((i) => i.id);
  const returnableItems = allItemIds.filter((id) => !result.excludedItems.includes(id));
  if (returnableItems.length === 0 && result.eligible) {
    result.eligible = false;
    result.reasons.push("No items in this order are eligible for return.");
  }

  // If auto-reject matched, mark ineligible
  if (result.autoAction === "AUTO_REJECT") {
    result.eligible = false;
  }

  // Save evaluation record
  const finalOutcome = !result.eligible
    ? "NOT_ELIGIBLE"
    : result.autoAction === "AUTO_APPROVE"
      ? "AUTO_APPROVE"
      : result.autoAction === "AUTO_REJECT"
        ? "AUTO_REJECT"
        : result.autoAction === "MANUAL_REVIEW"
          ? "MANUAL_REVIEW"
          : "ELIGIBLE";

  await savePolicyEvaluation({
    shop,
    shopifyOrderId: order.id,
    results: result.policyResults,
    finalOutcome,
    reasons: result.reasons,
  });

  return result;
}

function evaluateConditions(conditions: PolicyCondition[], context: PolicyContext & { orderTotalUnknown?: boolean }): boolean {
  // ALL conditions must match (AND logic)
  return conditions.every((condition) => evaluateCondition(condition, context));
}

function evaluateCondition(condition: PolicyCondition, context: PolicyContext & { orderTotalUnknown?: boolean }): boolean {
  const fieldValue = getFieldValue(condition.field, context);

  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  // Skip price-based conditions if orderTotal is unreliable (all prices were invalid)
  if (context.orderTotalUnknown && (condition.field === "order_total" || condition.field === "item_price")) {
    console.warn(`[PolicyEngine] Skipping ${condition.field} condition due to invalid price data in order ${context.order.id}`);
    return false;
  }

  switch (condition.operator) {
    case "equals":
      return String(fieldValue).toLowerCase() === String(condition.value).toLowerCase();
    case "not_equals":
      return String(fieldValue).toLowerCase() !== String(condition.value).toLowerCase();
    case "contains":
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => String(v).toLowerCase().includes(String(condition.value).toLowerCase()));
      }
      return String(fieldValue).toLowerCase().includes(String(condition.value).toLowerCase());
    case "not_contains":
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => String(v).toLowerCase().includes(String(condition.value).toLowerCase()));
      }
      return !String(fieldValue).toLowerCase().includes(String(condition.value).toLowerCase());
    case "greater_than": {
      const numField = Number(fieldValue);
      const numCondition = Number(condition.value);
      if (isNaN(numField) || isNaN(numCondition)) return false;
      return numField > numCondition;
    }
    case "less_than": {
      const numField = Number(fieldValue);
      const numCondition = Number(condition.value);
      if (isNaN(numField) || isNaN(numCondition)) return false;
      return numField < numCondition;
    }
    case "in":
      if (Array.isArray(condition.value)) {
        return condition.value.map((v) => String(v).toLowerCase()).includes(String(fieldValue).toLowerCase());
      }
      return false;
    case "not_in":
      if (Array.isArray(condition.value)) {
        return !condition.value.map((v) => String(v).toLowerCase()).includes(String(fieldValue).toLowerCase());
      }
      return true;
    default:
      return false;
  }
}

function getFieldValue(field: string, context: PolicyContext): unknown {
  switch (field) {
    case "days_since_fulfillment":
      return context.daysSinceFulfillment;
    case "order_total":
      return context.orderTotal;
    case "customer_return_count":
      return context.customerReturnCount;
    case "return_reason":
      return context.returnReason;
    case "product_title":
      return context.lineItem?.title;
    case "product_sku":
      return context.lineItem?.sku;
    case "product_tag":
    case "product_tags":
      return context.lineItem?.tags;
    case "product_type":
      return context.lineItem?.productType;
    case "product_vendor":
      return context.lineItem?.vendor;
    case "item_price": {
      if (!context.lineItem) return undefined;
      const price = parseFloat(context.lineItem.price);
      return isNaN(price) ? undefined : price;
    }
    case "customer_email":
      // Return empty string if email is missing to prevent "null" string conversion
      return context.order.email || "";
    default:
      return undefined;
  }
}
