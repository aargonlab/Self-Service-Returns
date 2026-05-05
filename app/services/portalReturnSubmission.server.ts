import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { getOrderForPortal } from "~/services/shopifyPortal.server";
import { checkReturnEligibility } from "~/services/shopify.server";
import { getSettings } from "~/models/returnSettings.server";
import { createReturnRequest } from "~/models/returnRequest.server";
import { addTimelineEvent } from "~/models/returnTimeline.server";
import { sendReturnConfirmationEmail, sendReturnRejectedEmail } from "~/services/email.server";
import { evaluatePolicies } from "~/services/policyEngine.server";
import prisma from "~/db.server";
import { transitionStatus } from "~/services/stateMachine.server";
import { listActiveReasons, getReasonResolutions } from "~/models/customReason.server";
import { getMarketFromOrder, fetchMarketsForShop } from "~/services/shopifyMarkets.server";
import { approveReturn } from "~/services/returnActions.server";

const MAX_NOTE_LENGTH = 5000;

export type ReturnItem = {
  shopifyLineItemId: string;
  shopifyVariantId: string | undefined;
  productTitle: string;
  variantTitle: string | undefined;
  sku: string | undefined;
  imageUrl: string | undefined;
  price: string | null;
  quantity: number;
  returnReason: string;
  compositeCode: string;
  customerNote: string | undefined;
  serialNumber?: string;
  sapLineId?: string;
};

export type ValidationError = {
  error: string;
  status: number;
};

/**
 * Parse and validate selected items from form data
 */
export async function parseSelectedItems(formData: FormData, orderId: string, shop: string) {
  const isSerialNumberMode = formData.get("_mode") === "serial";
  let itemKeys: string[];
  let selectedLineItemIds: string[];
  let selectedSerialNumbers: string[] = [];

  if (isSerialNumberMode) {
    const snKeys = Array.from(formData.keys()).filter((k) =>
      k.startsWith("sn_") &&
      formData.get(k) === "1" &&
      !k.startsWith("snLineItemId_") &&
      !k.startsWith("serialNumber_") &&
      !k.startsWith("sapLineId_")
    );
    selectedSerialNumbers = snKeys.map((k) => k.replace("sn_", ""));
    const normalKeys = Array.from(formData.keys()).filter((k) => k.startsWith("item_"));
    selectedLineItemIds = normalKeys.map((k) => k.replace("item_", ""));
    itemKeys = [...snKeys, ...normalKeys];
  } else {
    itemKeys = Array.from(formData.keys()).filter((k) => k.startsWith("item_"));
    selectedLineItemIds = itemKeys.map((k) => k.replace("item_", ""));
  }

  selectedLineItemIds = [...new Set(selectedLineItemIds)];

  return { isSerialNumberMode, itemKeys, selectedLineItemIds, selectedSerialNumbers };
}

/**
 * Validate return request submission
 */
export async function validateReturnSubmission(
  formData: FormData,
  shop: string,
  orderId: string,
  email: string
): Promise<{ success: false; error: ValidationError } | { success: true; data: any }> {
  const notes = formData.get("notes") as string;
  const resolutionType = (formData.get("resolutionType") as string) || "REFUND";

  // Validate notes length
  if (notes && notes.length > MAX_NOTE_LENGTH) {
    return { success: false, error: { error: `General notes exceed maximum length of ${MAX_NOTE_LENGTH} characters.`, status: 400 } };
  }

  // Parse selected items
  const { selectedLineItemIds, selectedSerialNumbers, isSerialNumberMode, itemKeys } = await parseSelectedItems(formData, orderId, shop);

  if (selectedLineItemIds.length === 0 && selectedSerialNumbers.length === 0) {
    return { success: false, error: { error: "Please select at least one item to return.", status: 400 } };
  }

  if (!["REFUND", "EXCHANGE"].includes(resolutionType)) {
    return { success: false, error: { error: "Invalid resolution type.", status: 400 } };
  }

  // Re-validate order exists
  const order = await getOrderForPortal(shop, orderId, email);
  if (!order) {
    return { success: false, error: { error: "Order not found.", status: 400 } };
  }

  // Get settings and market
  const settings = await getSettings(shop);
  const markets = await fetchMarketsForShop(shop);
  const orderMarketId = getMarketFromOrder(order, markets) || undefined;

  // Validate reason
  const allActiveReasons = await listActiveReasons(shop, { marketId: orderMarketId, customerVisible: true });
  const reasonType = resolutionType === "EXCHANGE" ? "replacement" as const : "return" as const;
  const validReasons = getReasonResolutions(allActiveReasons, reasonType, orderMarketId);
  const validIds = validReasons.map(r => r.id);

  const reasonId = (formData.get("reason") as string);
  if (!reasonId || !validIds.includes(reasonId)) {
    return { success: false, error: { error: "The selected return reason is no longer available. Please refresh the page and try again.", status: 400 } };
  }

  const selectedReasonObj = validReasons.find(r => r.id === reasonId);
  const reasonCode = selectedReasonObj?.code || "OTHER";

  if (selectedReasonObj?.requiresNote) {
    const returnNoteValue = (formData.get("returnNote") as string);
    if (!returnNoteValue?.trim()) {
      return { success: false, error: { error: `A note is required for the reason "${selectedReasonObj.label}".`, status: 400 } };
    }
  }

  return {
    success: true,
    data: {
      order,
      settings,
      orderMarketId,
      selectedReasonObj,
      reasonCode,
      isSerialNumberMode,
      itemKeys,
      selectedLineItemIds,
      selectedSerialNumbers,
      resolutionType,
    }
  };
}

/**
 * Expand RX-grouped items and validate
 */
export async function expandAndValidateRxGrouping(
  selectedLineItemIds: string[],
  order: any,
  settings: any,
  shop: string,
  orderMarketId: string | undefined
): Promise<{ success: false; error: ValidationError } | { success: true; data: { expandedIds: string[]; groupedToPrimary: Map<string, string> } }> {
  let expandedIds = [...selectedLineItemIds];
  const groupedToPrimary = new Map<string, string>();

  if (!settings.enableRxGrouping) {
    return { success: true, data: { expandedIds, groupedToPrimary } };
  }

  const lineItems = order.lineItems.nodes;
  const originalSelectedIds = new Set(selectedLineItemIds);

  // Expand grouped items
  for (const selectedId of [...expandedIds]) {
    const selectedItem = lineItems.find((li: any) => li.id === selectedId);
    if (!selectedItem) continue;

    const relAttr = selectedItem.customAttributes?.find(
      (attr: any) => attr.key === "_itemsRelationshipId" && attr.value
    );
    if (!relAttr?.value) continue;

    for (const li of lineItems) {
      const liRel = li.customAttributes?.find(
        (attr: any) => attr.key === "_itemsRelationshipId" && attr.value === relAttr.value
      );
      if (liRel && !expandedIds.includes(li.id)) {
        expandedIds.push(li.id);
        groupedToPrimary.set(li.id, selectedId);
      }
    }
  }

  // Validate expanded items
  const eligibility = await checkReturnEligibility(
    { graphql: async () => { throw new Error("not used"); } } as any,
    order,
    settings,
    shop,
    orderMarketId || null
  );

  const eligibleLineItemIds = new Set(eligibility.eligibleItems.map((item: any) => item.lineItemId));
  for (const expandedId of expandedIds) {
    if (!eligibleLineItemIds.has(expandedId)) {
      return { success: false, error: { error: "One or more grouped items are not eligible for return.", status: 400 } };
    }
  }

  // Check policy exclusions
  const policyEval = await evaluatePolicies(shop, order, settings);
  for (const expandedId of expandedIds) {
    if (policyEval.excludedItems.includes(expandedId)) {
      return { success: false, error: { error: "One or more grouped items are excluded by store policy.", status: 400 } };
    }
  }

  // Validate quantities
  for (const expandedId of expandedIds) {
    const eligibleItem = eligibility.eligibleItems.find((item: any) => item.lineItemId === expandedId);
    if (eligibleItem && eligibleItem.returnableQuantity <= 0) {
      return { success: false, error: { error: "One or more grouped items have no returnable quantity available.", status: 400 } };
    }
  }

  return { success: true, data: { expandedIds, groupedToPrimary } };
}

/**
 * Build return items from form data
 */
export async function buildReturnItems(
  formData: FormData,
  order: any,
  settings: any,
  selectedLineItemIds: string[],
  selectedSerialNumbers: string[],
  itemKeys: string[],
  groupedToPrimary: Map<string, string>,
  isSerialNumberMode: boolean,
  reasonCode: string,
  resolutionType: string
): Promise<{ success: false; error: ValidationError } | { success: true; items: ReturnItem[] }> {
  let items: Array<ReturnItem | null>;

  if (isSerialNumberMode) {
    items = selectedSerialNumbers.map((serialNumber) => {
      const lineItemId = formData.get(`snLineItemId_${serialNumber}`) as string;
      const sapLineId = formData.get(`sapLineId_${serialNumber}`) as string;

      if (!lineItemId || !sapLineId) return null;

      const orderItem = order.lineItems.nodes.find((li: any) => li.id === lineItemId);
      if (!orderItem) return null;

      const resolutionPrefix = resolutionType === "EXCHANGE" ? "REP" : "RET";
      const note = formData.get("returnNote") as string;

      return {
        shopifyLineItemId: lineItemId,
        shopifyVariantId: orderItem.variant?.id || undefined,
        productTitle: orderItem.title,
        variantTitle: orderItem.variantTitle || undefined,
        sku: orderItem.sku || undefined,
        imageUrl: orderItem.image?.url || undefined,
        price: orderItem.discountedUnitPriceSet?.shopMoney?.amount ?? null,
        quantity: 1,
        returnReason: reasonCode,
        compositeCode: `${resolutionPrefix}-${reasonCode}`,
        customerNote: note || undefined,
        serialNumber,
        sapLineId,
      };
    });

    // RX Grouping for serial numbers
    if (settings.enableRxGrouping) {
      const lineItems = order.lineItems.nodes;
      const alreadyIncludedLineItemIds = new Set(items.filter(Boolean).map((i: any) => i!.shopifyLineItemId));

      for (const item of [...items]) {
        if (!item) continue;
        const frameLi = lineItems.find((li: any) => li.id === item.shopifyLineItemId);
        if (!frameLi) continue;

        const relAttr = frameLi.customAttributes?.find(
          (attr: any) => attr.key === "_itemsRelationshipId" && attr.value
        );
        if (!relAttr?.value) continue;

        for (const li of lineItems) {
          if (alreadyIncludedLineItemIds.has(li.id)) continue;
          const liRel = li.customAttributes?.find(
            (attr: any) => attr.key === "_itemsRelationshipId" && attr.value === relAttr.value
          );
          if (!liRel) continue;

          const resolutionPrefix = resolutionType === "EXCHANGE" ? "REP" : "RET";
          items.push({
            shopifyLineItemId: li.id,
            shopifyVariantId: li.variant?.id || undefined,
            productTitle: li.title,
            variantTitle: li.variantTitle || undefined,
            sku: li.sku || undefined,
            imageUrl: li.image?.url || undefined,
            price: li.discountedUnitPriceSet?.shopMoney?.amount ?? null,
            quantity: 1,
            returnReason: item.returnReason,
            compositeCode: `${resolutionPrefix}-${item.returnReason}`,
            customerNote: item.customerNote,
          });
          alreadyIncludedLineItemIds.add(li.id);
        }
      }
    }

    // Add normal items in SN mode
    if (selectedLineItemIds.length > 0) {
      const normalItems = selectedLineItemIds.map((lineItemId) => {
        const orderItem = order.lineItems.nodes.find((li: any) => li.id === lineItemId);
        if (!orderItem) return null;
        const primaryId = groupedToPrimary.get(lineItemId) || lineItemId;
        const qtyString = formData.get(`qty_${primaryId}`) as string;
        const parsedQty = parseInt(qtyString, 10);
        if (isNaN(parsedQty) || parsedQty < 1) return null;
        const resolutionPrefix = resolutionType === "EXCHANGE" ? "REP" : "RET";
        return {
          shopifyLineItemId: lineItemId,
          shopifyVariantId: orderItem.variant?.id || undefined,
          productTitle: orderItem.title,
          variantTitle: orderItem.variantTitle || undefined,
          sku: orderItem.sku || undefined,
          imageUrl: orderItem.image?.url || undefined,
          price: orderItem.discountedUnitPriceSet?.shopMoney?.amount ?? null,
          quantity: parsedQty,
          returnReason: reasonCode,
          compositeCode: `${resolutionPrefix}-${reasonCode}`,
          customerNote: (formData.get("returnNote") as string) || undefined,
        };
      });
      items.push(...normalItems);
    }
  } else {
    // Normal mode
    items = selectedLineItemIds.map((lineItemId) => {
      const orderItem = order.lineItems.nodes.find((li: any) => li.id === lineItemId);
      if (!orderItem) return null;

      const primaryId = groupedToPrimary.get(lineItemId) || lineItemId;
      const isGroupedLens = groupedToPrimary.has(lineItemId);
      const qtyString = formData.get(`qty_${primaryId}`) as string;
      const parsedQty = parseInt(qtyString, 10);

      if (isNaN(parsedQty) || parsedQty < 1) return null;

      const effectiveQty = isGroupedLens ? 1 : parsedQty;
      const resolutionPrefix = resolutionType === "EXCHANGE" ? "REP" : "RET";

      return {
        shopifyLineItemId: lineItemId,
        shopifyVariantId: orderItem.variant?.id || undefined,
        productTitle: orderItem.title,
        variantTitle: orderItem.variantTitle || undefined,
        sku: orderItem.sku || undefined,
        imageUrl: orderItem.image?.url || undefined,
        price: orderItem.discountedUnitPriceSet?.shopMoney?.amount ?? null,
        quantity: effectiveQty,
        returnReason: reasonCode,
        compositeCode: `${resolutionPrefix}-${reasonCode}`,
        customerNote: (formData.get("returnNote") as string) || undefined,
      };
    });
  }

  if (items.some(item => item === null)) {
    return { success: false, error: { error: "Invalid quantity for one or more items. Please enter a valid positive number.", status: 400 } };
  }

  const validItems = items.filter((item): item is NonNullable<typeof item> => item !== null);

  for (const item of validItems) {
    if (!item || !item.productTitle || item.quantity < 1) {
      return { success: false, error: { error: "Invalid item data.", status: 400 } };
    }
  }

  return { success: true, items: validItems };
}

/**
 * Perform final validations before creating return
 */
export async function performFinalValidations(
  validItems: ReturnItem[],
  order: any,
  settings: any,
  shop: string,
  orderMarketId: string | undefined,
  reasonCode: string,
  reasonId: string,
  resolutionType: string,
  selectedSerialNumbers: string[],
  isSerialNumberMode: boolean,
  orderId: string,
  allActiveReasons: any[]
): Promise<{ success: false; error: ValidationError } | { success: true }> {
  // Validate serial numbers
  if (isSerialNumberMode && selectedSerialNumbers.length > 0) {
    const { getActiveSerialNumbersForOrder } = await import("~/models/serialNumber.server");
    const currentActiveSerials = await getActiveSerialNumbersForOrder(shop, orderId);
    const activeSerialSet = new Set(currentActiveSerials.map(sn => sn.serialNumber));
    for (const sn of selectedSerialNumbers) {
      if (!activeSerialSet.has(sn)) {
        return { success: false, error: { error: `Serial number ${sn} is no longer available for return. It may have been used in another return request. Please refresh and try again.`, status: 409 } };
      }
    }
  }

  // Validate return note length
  const returnNoteValue = validItems[0]?.customerNote;
  if (returnNoteValue && returnNoteValue.length > MAX_NOTE_LENGTH) {
    return { success: false, error: { error: `Return note exceeds maximum length of ${MAX_NOTE_LENGTH} characters.`, status: 400 } };
  }

  // Validate resolution type
  if (resolutionType === "EXCHANGE" && !settings.enableReplacement) {
    return { success: false, error: { error: "Replacement is not available for this store.", status: 400 } };
  }

  // Re-validate reason allows resolution type
  if (resolutionType === "EXCHANGE") {
    const replacementReasons = getReasonResolutions(allActiveReasons, "replacement", orderMarketId);
    if (!replacementReasons.some(r => r.id === reasonId)) {
      return { success: false, error: { error: "Replacement is not available for this reason in your region.", status: 400 } };
    }
  }

  // Validate RX group replacement exclusion
  if (resolutionType === "EXCHANGE" && settings.excludeReplacementForRxGroup && settings.enableRxGrouping) {
    const lineItems = order.lineItems.nodes;
    const lineItemIdsToCheck = [
      ...validItems.filter(i => !i.serialNumber).map(i => i.shopifyLineItemId),
      ...validItems.filter(i => i.serialNumber).map(i => i.shopifyLineItemId),
    ];
    for (const selectedId of lineItemIdsToCheck) {
      const li = lineItems.find((l: any) => l.id === selectedId);
      const relAttr = li?.customAttributes?.find(
        (attr: any) => attr.key === "_itemsRelationshipId" && attr.value
      );
      if (relAttr?.value) {
        return { success: false, error: { error: "Replacement is not available for prescription products. Please select refund instead.", status: 400 } };
      }
    }
  }

  // Re-validate eligibility
  const eligibility = await checkReturnEligibility(
    { graphql: async () => { throw new Error("not used"); } } as any,
    order,
    settings,
    shop,
    orderMarketId || null
  );
  if (!eligibility.eligible) {
    return { success: false, error: { error: "This order is no longer eligible for returns.", status: 400 } };
  }

  // Re-evaluate policies
  const policyResolutionType = resolutionType === "EXCHANGE" ? "EXCHANGE" : "REFUND";
  const policyEvaluation = await evaluatePolicies(shop, order, settings, reasonCode, policyResolutionType, reasonId);
  if (!policyEvaluation.eligible) {
    return { success: false, error: { error: "This order is no longer eligible for returns.", status: 400 } };
  }

  // Account for window override
  if (policyEvaluation.overriddenWindowDays != null && eligibility.windowExpired) {
    const overriddenDays = policyEvaluation.overriddenWindowDays;
    if (eligibility.daysSinceFulfillment != null && eligibility.daysSinceFulfillment <= overriddenDays) {
      eligibility.windowExpired = false;
      eligibility.reasons = eligibility.reasons?.filter((r: string) => !r.toLowerCase().includes('window'));
      eligibility.effectiveWindowDays = overriddenDays;
    }
  }

  const filteredEligibleItems = eligibility.eligibleItems.filter(
    (item: any) => !policyEvaluation.excludedItems.includes(item.lineItemId)
  );

  // Validate SN items against policy exclusions
  if (isSerialNumberMode) {
    for (const item of validItems) {
      if (item.serialNumber && policyEvaluation.excludedItems.includes(item.shopifyLineItemId)) {
        return { success: false, error: { error: `"${item.productTitle}" is not eligible for return based on store policy.`, status: 400 } };
      }
    }
  }

  // Validate line item IDs
  const eligibleIds = new Set(filteredEligibleItems.map((item: any) => item.lineItemId));
  const orderLineItemIds = new Set(order.lineItems.nodes.map((li: any) => li.id));
  for (const item of validItems) {
    if (item.serialNumber) {
      if (!orderLineItemIds.has(item.shopifyLineItemId)) {
        return { success: false, error: { error: "Invalid item selected", status: 400 } };
      }
    } else if (isSerialNumberMode && !item.serialNumber && settings.enableRxGrouping) {
      if (!orderLineItemIds.has(item.shopifyLineItemId) || policyEvaluation.excludedItems.includes(item.shopifyLineItemId)) {
        return { success: false, error: { error: "Invalid item selected", status: 400 } };
      }
    } else {
      if (!eligibleIds.has(item.shopifyLineItemId)) {
        return { success: false, error: { error: "Invalid item selected", status: 400 } };
      }
    }
  }

  // Validate quantities
  for (const item of validItems) {
    if (item.serialNumber) continue;
    if (isSerialNumberMode && !item.serialNumber && settings.enableRxGrouping) {
      const orderItem = order.lineItems.nodes.find((li: any) => li.id === item.shopifyLineItemId);
      if (!orderItem || item.quantity > orderItem.quantity) {
        return { success: false, error: { error: "Invalid quantity for one or more items.", status: 400 } };
      }
      continue;
    }
    const eligible = filteredEligibleItems.find(
      (e: any) => e.lineItemId === item.shopifyLineItemId
    );
    if (!eligible || item.quantity > eligible.returnableQuantity) {
      return { success: false, error: { error: "Invalid quantity for one or more items.", status: 400 } };
    }
  }

  return { success: true };
}

/**
 * Handle automatic actions after return creation
 */
export async function handleAutoAction(
  returnRequest: any,
  policyEvaluation: any,
  windowExpired: boolean,
  shop: string,
  email: string
) {
  const isAutoReject = !windowExpired && policyEvaluation.autoAction === "AUTO_REJECT";

  if (windowExpired) {
    try {
      if (returnRequest.status !== "PENDING_REVIEW") {
        await transitionStatus(
          returnRequest.id,
          "PENDING_REVIEW",
          { name: "Policy Engine", type: "SYSTEM" },
          { reason: "Return window expired - requires manual approval" },
          shop
        );
      }

      const { getReturnRequest } = await import("~/models/returnRequest.server");
      const fullRequest = await getReturnRequest(returnRequest.id, shop);
      if (fullRequest) {
        sendReturnConfirmationEmail(fullRequest).catch((err: any) =>
          console.warn(`[Email] FAILED confirmation email for return ${returnRequest.id}, customer ${email}:`, err)
        );
      }

      // Create Shopify return request for visibility in Shopify admin (fire-and-forget)
      tryCreateShopifyReturnRequest(
        returnRequest.id,
        shop,
        returnRequest.items || [],
        returnRequest.shopifyOrderId,
      ).catch((err: any) => console.error(`[ShopifyReturnRequest] Failed for windowExpired return ${returnRequest.id}:`, err));
    } catch (err) {
      console.error(`[WindowExpired] Failed to transition return ${returnRequest.id} to PENDING_REVIEW:`, err);
    }
  } else if (policyEvaluation.autoAction === "AUTO_APPROVE") {
    try {
      const { unauthenticated } = await import("~/shopify.server");
      const { admin } = await unauthenticated.admin(shop);
      const approvalResult = await approveReturn(
        admin,
        returnRequest.id,
        shop,
        { name: "Policy Engine", type: "SYSTEM" }
      );
      if (!approvalResult.success) {
        console.error(`[AutoApprove] approveReturn failed for ${returnRequest.id}: ${approvalResult.message}`);
        try {
          await transitionStatus(
            returnRequest.id,
            "PENDING_REVIEW",
            { name: "Policy Engine", type: "SYSTEM" },
            { reason: `Auto-approve failed: ${approvalResult.message}. Requires manual approval.` },
            shop
          );
        } catch (transErr) {
          console.error(`[AutoApprove] Also failed to transition to PENDING_REVIEW:`, transErr);
          try {
            await addTimelineEvent({
              returnRequestId: returnRequest.id,
              event: `Auto-approve failed and manual review fallback also failed. Return requires immediate manual attention. Error: ${String(transErr)}`,
              actor: "system",
              actorType: "SYSTEM",
              shop,
            });
          } catch (timelineErr) {
            console.error(`[AutoApprove] Failed to add timeline event:`, timelineErr);
          }
        }
        const { getReturnRequest } = await import("~/models/returnRequest.server");
        const fullReq = await getReturnRequest(returnRequest.id, shop);
        if (fullReq) {
          sendReturnConfirmationEmail(fullReq).catch((err: any) =>
            console.warn(`[Email] FAILED confirmation email for return ${returnRequest.id}:`, err)
          );
        }
      } else {
        console.info(`[AutoApprove] Return ${returnRequest.id} fully approved via approveReturn: ${approvalResult.message}`);
      }
    } catch (err) {
      console.error(`[AutoApprove] Failed to approve return ${returnRequest.id}:`, err);
    }
  } else if (policyEvaluation.autoAction === "AUTO_REJECT") {
    if (!isAutoReject) {
      try {
        const updatedRequest = await transitionStatus(
          returnRequest.id,
          "REJECTED",
          { name: "Policy Engine", type: "SYSTEM" },
          { reason: "Automatically rejected by policy" },
          shop
        );

        sendReturnRejectedEmail(updatedRequest, "This return was automatically declined based on our return policy.").catch((err: any) =>
          console.warn(`[Email] FAILED auto-rejection email for return ${returnRequest.id}, customer ${email}:`, err)
        );
      } catch (err) {
        console.error(`[AutoReject] Failed to reject return ${returnRequest.id}:`, err);
      }
    } else {
      sendReturnRejectedEmail(returnRequest as any, "This return was automatically declined based on our return policy.").catch((err: any) =>
        console.warn(`[Email] FAILED auto-rejection email for return ${returnRequest.id}, customer ${email}:`, err)
      );
    }
  } else if (policyEvaluation.autoAction === "MANUAL_REVIEW") {
    try {
      await transitionStatus(
        returnRequest.id,
        "PENDING_REVIEW",
        { name: "Policy Engine", type: "SYSTEM" },
        { reason: "Flagged for manual review by policy" },
        shop
      );

      const { getReturnRequest } = await import("~/models/returnRequest.server");
      const fullRequest = await getReturnRequest(returnRequest.id, shop);
      if (fullRequest) {
        sendReturnConfirmationEmail(fullRequest).catch((err: any) =>
          console.warn(`[Email] FAILED confirmation email for return ${returnRequest.id}, customer ${email}:`, err)
        );
      }

      // Create Shopify return request for visibility in Shopify admin (fire-and-forget)
      tryCreateShopifyReturnRequest(
        returnRequest.id,
        shop,
        returnRequest.items || [],
        returnRequest.shopifyOrderId,
      ).catch((err: any) => console.error(`[ShopifyReturnRequest] Failed for manual-review return ${returnRequest.id}:`, err));
    } catch (err) {
      console.error(`[ManualReview] Failed to transition return ${returnRequest.id} to PENDING_REVIEW:`, err);
    }
  } else {
    try {
      const { getReturnRequest } = await import("~/models/returnRequest.server");
      const fullRequest = await getReturnRequest(returnRequest.id, shop);
      if (fullRequest) {
        sendReturnConfirmationEmail(fullRequest).catch((err: any) =>
          console.warn(`[Email] FAILED confirmation email for return ${returnRequest.id}, customer ${email}:`, err)
        );
      }
    } catch (err) {
      console.error(`[Confirmation] Failed to send confirmation email for return ${returnRequest.id}:`, err);
    }
  }
}

/**
 * Attempt to create a Shopify return request (REQUESTED status) for returns
 * that need manual review. This makes them visible in the Shopify admin.
 * Failures are non-blocking — the local return still works without Shopify visibility.
 */
async function tryCreateShopifyReturnRequest(
  returnRequestId: string,
  shop: string,
  items: Array<{ shopifyLineItemId: string; quantity: number; returnReason: string; customerNote?: string | null }>,
  shopifyOrderId: string,
): Promise<void> {
  try {
    const { unauthenticated } = await import("~/shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    const { fetchOrder, createReturnRequestOnShopify } = await import("~/services/shopify.server");
    const { updateReturnRequestShopifyId } = await import("~/models/returnRequest.server");

    const order = await fetchOrder(admin, shopifyOrderId);
    if (!order) {
      console.warn(`[ShopifyReturnRequest] Could not fetch order ${shopifyOrderId} for return ${returnRequestId} — skipping Shopify return request creation`);
      return;
    }

    const returnItems = items.map((item) => ({
      lineItemId: item.shopifyLineItemId,
      quantity: item.quantity,
      returnReason: item.returnReason,
      customerNote: item.customerNote || undefined,
    }));

    const result = await createReturnRequestOnShopify(admin, order, returnItems);

    if ("returnId" in result) {
      await updateReturnRequestShopifyId(returnRequestId, shop, result.returnId);
      console.info(`[ShopifyReturnRequest] Created Shopify return request ${result.returnId} for local return ${returnRequestId}`);
    } else {
      console.warn(`[ShopifyReturnRequest] Failed to create Shopify return request for ${returnRequestId}: ${result.error}`);
    }
  } catch (err) {
    // Non-blocking — local return continues to work without Shopify visibility
    console.error(`[ShopifyReturnRequest] Error creating Shopify return request for ${returnRequestId}:`, err);
  }
}
