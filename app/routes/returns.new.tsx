import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { getOrderForPortal } from "~/services/shopifyPortal.server";
import { checkReturnEligibility } from "~/services/shopify.server";
import { getSettings } from "~/models/returnSettings.server";
import { createReturnRequest } from "~/models/returnRequest.server";
import { addTimelineEvent } from "~/models/returnTimeline.server";
import { evaluatePolicies } from "~/services/policyEngine.server";
import prisma from "~/db.server";
import { ensureDefaultReasons, listActiveReasons, getReasonResolutions } from "~/models/customReason.server";
import { getMarketFromOrder, fetchMarketsForShop } from "~/services/shopifyMarkets.server";
import { useTranslation } from "~/utils/useTranslation";
import {
  validateReturnSubmission,
  expandAndValidateRxGrouping,
  buildReturnItems,
  performFinalValidations,
  handleAutoAction,
} from "~/services/portalReturnSubmission.server";
import { SerialNumberItemList } from "~/components/portal/SerialNumberItemList";
import { ReturnItemList } from "~/components/portal/ReturnItemList";
import { ReturnReasonForm } from "~/components/portal/ReturnReasonForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const orderId = url.searchParams.get("orderId");
  const email = url.searchParams.get("email");

  if (!shop || !orderId || !email) {
    return redirect(shop ? `/returns?shop=${encodeURIComponent(shop)}` : "/returns");
  }

  const order = await getOrderForPortal(shop, orderId, email);
  if (!order) {
    return redirect(`/returns?shop=${encodeURIComponent(shop)}&error=${encodeURIComponent("Order not found. It may have been deleted or is no longer accessible.")}`);
  }

  const settings = await getSettings(shop);

  // Get market from order by matching shipping country to market regions
  const markets = await fetchMarketsForShop(shop);
  const marketId = getMarketFromOrder(order, markets);

  const eligibility = await checkReturnEligibility(
    { graphql: async () => { throw new Error("not used"); } } as any,
    order,
    settings,
    shop,
    marketId,
  );

  if (!eligibility.eligible) {
    const reason = eligibility.reasons?.[0] || "This order is not eligible for return.";
    return redirect(`/returns?shop=${encodeURIComponent(shop)}&error=${encodeURIComponent(reason)}`);
  }

  // Evaluate policies to filter excluded items and check requirements
  const policyEvaluation = await evaluatePolicies(shop, order, settings);

  if (!policyEvaluation.eligible) {
    const reason = policyEvaluation.reasons?.[0] || "This order is not eligible for return based on the store's return policy.";
    return redirect(`/returns?shop=${encodeURIComponent(shop)}&error=${encodeURIComponent(reason)}`);
  }

  // Fix: If policy engine overrode the window, re-evaluate window expiration
  // The eligibility check uses settings-based window, but policies may extend it
  if (policyEvaluation.overriddenWindowDays != null && eligibility.windowExpired) {
    const overriddenDays = policyEvaluation.overriddenWindowDays;
    if (eligibility.daysSinceFulfillment != null && eligibility.daysSinceFulfillment <= overriddenDays) {
      // Policy extended the window — this order is within the overridden window
      eligibility.windowExpired = false;
      eligibility.warnings = eligibility.warnings?.filter(w => !w.toLowerCase().includes('window'));
      eligibility.reasons = eligibility.reasons?.filter(r => !r.toLowerCase().includes('window'));
      eligibility.effectiveWindowDays = overriddenDays;
    }
  }

  // Fix 5: If window is still expired after policy override, override autoAction to MANUAL_REVIEW
  // so the UI doesn't mislead the customer about auto-approval
  if (eligibility.windowExpired && policyEvaluation.autoAction === "AUTO_APPROVE") {
    policyEvaluation.autoAction = "MANUAL_REVIEW";
  }

  // Filter out excluded items from eligible items
  let filteredEligibleItems = eligibility.eligibleItems.filter(
    (item) => !policyEvaluation.excludedItems.includes(item.lineItemId),
  );

  // RX Grouping: Group correlated items by _itemsRelationshipId
  if (settings.enableRxGrouping) {
    const lineItems = order.lineItems.nodes;

    // Build a map of _itemsRelationshipId → line item IDs
    const relationshipGroups = new Map<string, string[]>();
    for (const li of lineItems) {
      const relAttr = li.customAttributes?.find(
        (attr) => attr.key === "_itemsRelationshipId" && attr.value,
      );
      if (relAttr?.value) {
        const group = relationshipGroups.get(relAttr.value) || [];
        group.push(li.id);
        relationshipGroups.set(relAttr.value, group);
      }
    }

    // For each group with 2+ items, keep only the frame (non-lens) as the visible item
    const hiddenLineItemIds = new Set<string>();
    for (const [, groupIds] of relationshipGroups) {
      if (groupIds.length < 2) continue;

      // Determine which item is the "frame" (primary) — the one whose title does NOT
      // contain lens-related keywords. If we can't tell, use the first item.
      const groupLineItems = groupIds
        .map((id) => lineItems.find((li) => li.id === id))
        .filter(Boolean) as typeof lineItems;

      const lensKeywords = /lens|lente|rx\s*lens|prescription\s*lens/i;
      const frameItem = groupLineItems.find((li) => !lensKeywords.test(li.title)) || groupLineItems[0];

      // Mark all other items in the group as hidden
      for (const li of groupLineItems) {
        if (li.id !== frameItem.id) {
          hiddenLineItemIds.add(li.id);
        }
      }

      // Find the frame's eligible item and attach the grouped IDs + aggregate price
      const frameEligible = filteredEligibleItems.find(
        (ei) => ei.lineItemId === frameItem.id,
      );
      if (frameEligible) {
        // Sum prices of all items in the group and collect lens titles
        let totalGroupPrice = 0;
        const lensNames: string[] = [];
        for (const li of groupLineItems) {
          totalGroupPrice += parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || "0");
          if (li.id !== frameItem.id) {
            lensNames.push(li.variantTitle ? `${li.title} – ${li.variantTitle}` : li.title);
          }
        }
        frameEligible.price = totalGroupPrice.toFixed(2);
        frameEligible.groupedLineItemIds = groupIds;
        if (lensNames.length > 0) frameEligible.groupedItemTitles = lensNames;
      }
    }

    // Remove hidden lens items from the displayed list
    filteredEligibleItems = filteredEligibleItems.filter(
      (item) => !hiddenLineItemIds.has(item.lineItemId),
    );
  }

  // Ensure default reasons exist and load from DB
  try {
    await ensureDefaultReasons(shop);
  } catch (e) {
    console.error("Failed to seed default reasons:", e);
  }

  const allReasons = await listActiveReasons(shop, { marketId: marketId || undefined, customerVisible: true });

  // Filter reasons for return (refund)
  const returnReasons = getReasonResolutions(allReasons, "return", marketId || undefined);

  // Filter reasons for replacement (exchange) — excludes markets in replacementExcludedMarkets
  const replacementReasons = getReasonResolutions(allReasons, "replacement", marketId || undefined);

  const reasons = allReasons.map(r => ({
    id: r.id,
    code: r.code,
    label: r.label,
    requiresNote: r.requiresNote,
    appliesToReturn: returnReasons.some(rr => rr.id === r.id),
    appliesToReplacement: replacementReasons.some(rr => rr.id === r.id),
  }));

  // Serial number handling
  let serialNumberItems: Array<{
    lineItemId: string;
    serialNumber: string;
    sapLineId: string;
    productTitle: string;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
    price: string;
    currencyCode: string;
    groupedItemTitles?: string[];
  }> = [];

  if (settings.enableSerialNumbers) {
    const { syncSerialNumbersFromMetafield, getActiveSerialNumbersForOrder } = await import("~/models/serialNumber.server");

    // Sync serial numbers from Shopify metafield (idempotent)
    const metafieldValue = (order as any).metafield?.value;
    if (metafieldValue) {
      try {
        const metafieldJson = JSON.parse(metafieldValue);
        await syncSerialNumbersFromMetafield(
          shop,
          order.id,
          order.name,
          metafieldJson,
          order.lineItems.nodes.map((li: any) => ({
            id: li.id,
            title: li.title,
            variantTitle: li.variantTitle || null,
            sku: li.sku || null,
            imageUrl: li.image?.url || null,
            variantId: li.variant?.id || null,
          })),
        );
      } catch (err) {
        console.warn("[SerialNumbers] Failed to sync serial numbers from metafield:", err);
      }
    }

    // Load active (returnable) serial numbers
    const activeSerials = await getActiveSerialNumbersForOrder(shop, order.id);

    // Map to items with pricing info from order line items
    serialNumberItems = activeSerials.map(sn => {
      const orderLineItem = order.lineItems.nodes.find((li: any) => li.id === sn.lineItemId);
      let itemPrice = orderLineItem?.discountedUnitPriceSet?.shopMoney?.amount || "0";

      // RX Grouping: if this serial's line item is a frame in an RX group,
      // aggregate the prices of all grouped items (frame + lenses) so the
      // customer sees the total product cost, not just the frame price.
      let groupedItemTitles: string[] | undefined;
      if (settings.enableRxGrouping && orderLineItem) {
        const relAttr = orderLineItem.customAttributes?.find(
          (attr: any) => attr.key === "_itemsRelationshipId" && attr.value,
        );
        if (relAttr?.value) {
          let groupTotal = 0;
          const titles: string[] = [];
          for (const li of order.lineItems.nodes) {
            const liRel = (li as any).customAttributes?.find(
              (a: any) => a.key === "_itemsRelationshipId" && a.value === relAttr.value,
            );
            if (!liRel) continue;
            groupTotal += parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || "0");
            if (li.id !== orderLineItem.id) {
              titles.push(li.variantTitle ? `${li.title} – ${li.variantTitle}` : li.title);
            }
          }
          itemPrice = groupTotal.toFixed(2);
          if (titles.length > 0) groupedItemTitles = titles;
        }
      }

      return {
        lineItemId: sn.lineItemId,
        serialNumber: sn.serialNumber,
        sapLineId: sn.sapLineId,
        productTitle: sn.productTitle,
        variantTitle: sn.variantTitle,
        sku: sn.sku,
        imageUrl: sn.imageUrl,
        price: itemPrice,
        currencyCode: orderLineItem?.discountedUnitPriceSet?.shopMoney?.currencyCode || "USD",
        groupedItemTitles,
      };
    });
  }

  // When serial numbers are enabled, exclude eligible items that are already
  // represented as serial number items (they'll show as SN cards instead).
  // Also exclude RX-grouped lens items whose frame is serial-tracked — those
  // lenses are already visually attached to the SN frame card.
  let nonSnEligibleItems = filteredEligibleItems;
  if (settings.enableSerialNumbers && serialNumberItems.length > 0) {
    const snLineItemIds = new Set(serialNumberItems.map(sn => sn.lineItemId));

    // Collect all line item IDs belonging to RX groups that contain a SN-tracked frame
    const rxGroupedSnIds = new Set<string>();
    if (settings.enableRxGrouping) {
      for (const li of order.lineItems.nodes) {
        if (!snLineItemIds.has(li.id)) continue; // only look at SN frames
        const relAttr = li.customAttributes?.find(
          (attr) => attr.key === "_itemsRelationshipId" && attr.value,
        );
        if (!relAttr?.value) continue;
        // Add all members of this group (frame + lenses)
        for (const otherLi of order.lineItems.nodes) {
          const otherRel = otherLi.customAttributes?.find(
            (a) => a.key === "_itemsRelationshipId" && a.value === relAttr.value,
          );
          if (otherRel) rxGroupedSnIds.add(otherLi.id);
        }
      }
    }

    nonSnEligibleItems = filteredEligibleItems.filter(
      (item) => !snLineItemIds.has(item.lineItemId) && !rxGroupedSnIds.has(item.lineItemId),
    );
  }

  return json({
    order: {
      id: order.id,
      name: order.name,
      email: order.email,
      customerName: order.customer
        ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
        : order.email,
    },
    eligibleItems: nonSnEligibleItems,
    reasons,
    shop,
    requiresPhoto: policyEvaluation.requiresPhoto,
    autoAction: policyEvaluation.autoAction,
    resolutionOptions: {
      enableReplacement: settings.enableReplacement,
      excludeReplacementForRxGroup: settings.excludeReplacementForRxGroup ?? false,
    },
    windowExpired: eligibility.windowExpired || false,
    windowWarning: eligibility.warnings?.some(w => w.toLowerCase().includes('window')) || false,
    enableSerialNumbers: settings.enableSerialNumbers ?? false,
    serialNumberItems,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop") as string;
  const orderId = formData.get("orderId") as string;
  const orderName = formData.get("orderName") as string;
  const email = formData.get("email") as string;
  const customerName = formData.get("customerName") as string;
  const notes = formData.get("notes") as string;

  // Step 1: Validate submission
  const validationResult = await validateReturnSubmission(formData, shop, orderId, email);
  if (!validationResult.success) {
    return json(validationResult.error, { status: validationResult.error.status });
  }

  const {
    order,
    settings,
    orderMarketId,
    selectedReasonObj,
    reasonCode,
    isSerialNumberMode,
    itemKeys,
    selectedLineItemIds: initialSelectedIds,
    selectedSerialNumbers,
    resolutionType,
  } = validationResult.data;

  // Step 2: Expand and validate RX grouping
  const rxResult = await expandAndValidateRxGrouping(initialSelectedIds, order, settings, shop, orderMarketId);
  if (!rxResult.success) {
    return json(rxResult.error, { status: rxResult.error.status });
  }
  const { expandedIds: selectedLineItemIds, groupedToPrimary } = rxResult.data;

  // Step 3: Build return items
  const itemsResult = await buildReturnItems(
    formData,
    order,
    settings,
    selectedLineItemIds,
    selectedSerialNumbers,
    itemKeys,
    groupedToPrimary,
    isSerialNumberMode,
    reasonCode,
    resolutionType
  );
  if (!itemsResult.success) {
    return json(itemsResult.error, { status: itemsResult.error.status });
  }
  const validItems = itemsResult.items;

  // Step 4: Perform final validations
  const { ensureDefaultReasons } = await import("~/models/customReason.server");
  await ensureDefaultReasons(shop);
  const allActiveReasons = await listActiveReasons(shop, { marketId: orderMarketId, customerVisible: true });
  const reasonId = formData.get("reason") as string;

  const finalValidation = await performFinalValidations(
    validItems,
    order,
    settings,
    shop,
    orderMarketId,
    reasonCode,
    reasonId,
    resolutionType,
    selectedSerialNumbers,
    isSerialNumberMode,
    orderId,
    allActiveReasons
  );
  if (!finalValidation.success) {
    return json(finalValidation.error, { status: finalValidation.error.status });
  }

  // Step 5: Re-evaluate policies and eligibility
  const eligibility = await checkReturnEligibility(
    { graphql: async () => { throw new Error("not used"); } } as any,
    order,
    settings,
    shop,
    orderMarketId || null
  );

  const policyResolutionType = resolutionType === "EXCHANGE" ? "EXCHANGE" : "REFUND";
  const policyEvaluation = await evaluatePolicies(shop, order, settings, reasonCode, policyResolutionType, reasonId);

  // Account for window override
  if (policyEvaluation.overriddenWindowDays != null && eligibility.windowExpired) {
    const overriddenDays = policyEvaluation.overriddenWindowDays;
    if (eligibility.daysSinceFulfillment != null && eligibility.daysSinceFulfillment <= overriddenDays) {
      eligibility.windowExpired = false;
      eligibility.reasons = eligibility.reasons?.filter((r: string) => !r.toLowerCase().includes('window'));
      eligibility.effectiveWindowDays = overriddenDays;
    }
  }

  const windowExpired = eligibility.windowExpired || false;

  // Step 6: Check for duplicate submissions
  const recentReturn = await prisma.returnRequest.findFirst({
    where: {
      shop,
      shopifyOrderId: orderId,
      status: { in: ["SUBMITTED", "PENDING_REVIEW"] },
      createdAt: { gte: new Date(Date.now() - 300_000) },
    },
    select: { id: true },
  });
  if (recentReturn) {
    return redirect(`/returns/${recentReturn.id}/status?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(email)}&orderId=${encodeURIComponent(orderId)}`);
  }

  // Step 7: Create return request
  const isAutoReject = !windowExpired && policyEvaluation.autoAction === "AUTO_REJECT";
  const initialStatus = isAutoReject ? "REJECTED" : "SUBMITTED";
  const requiresShoppingEligibility = selectedReasonObj?.requiresShoppingEligibility === true;

  let returnRequest: Awaited<ReturnType<typeof createReturnRequest>>;
  try {
    if (isSerialNumberMode) {
      const serialNumbers = validItems.map(item => item.serialNumber).filter(Boolean);
      const uniqueSerials = new Set(serialNumbers);
      if (uniqueSerials.size !== serialNumbers.length) {
        return json({ errors: { form: "Duplicate serial numbers in submission." } }, { status: 400 });
      }

      returnRequest = await prisma.$transaction(async (tx) => {
        const newReturn = await tx.returnRequest.create({
          data: {
            shopifyOrderId: orderId,
            shopifyOrderName: orderName,
            customerEmail: email,
            customerName: customerName || email || "Customer",
            shop,
            status: initialStatus,
            resolutionType: resolutionType as any,
            notes: notes || undefined,
            requireManualApproval: policyEvaluation.autoAction === "MANUAL_REVIEW" || windowExpired,
            marketId: orderMarketId || null,
            requiresShoppingEligibility,
            windowOverride: windowExpired ? 1 : undefined,
            items: {
              create: validItems,
            },
          },
          include: {
            items: {
              include: {
                attachments: true,
              },
            },
          },
        });

        const snUpdates = validItems
          .filter(item => item.serialNumber)
          .map(item => ({
            serialNumber: item.serialNumber!,
            returnItemId: newReturn.items.find(
              ri => ri.shopifyLineItemId === item.shopifyLineItemId && ri.serialNumber === item.serialNumber
            )?.id || "",
          }))
          .filter(u => u.returnItemId);

        if (snUpdates.length > 0) {
          const claimedSerials: string[] = [];
          const failedSerials: string[] = [];

          for (const entry of snUpdates) {
            const result = await tx.serialNumber.updateMany({
              where: {
                shop,
                orderId,
                serialNumber: entry.serialNumber,
                status: "ACTIVE",
              },
              data: {
                status: "IN_RETURN",
                returnItemId: entry.returnItemId,
                updatedAt: new Date(),
              },
            });

            if (result.count === 0) {
              failedSerials.push(entry.serialNumber);
            } else {
              claimedSerials.push(entry.serialNumber);
            }
          }

          if (failedSerials.length > 0) {
            throw new Error(
              `Serial numbers no longer available: ${failedSerials.join(", ")}. ` +
              (claimedSerials.length > 0 ? `${claimedSerials.length} other serial(s) were released. ` : "") +
              `They may have been claimed by another return request.`
            );
          }
        }

        return newReturn;
      });
    } else {
      returnRequest = await createReturnRequest({
        shopifyOrderId: orderId,
        shopifyOrderName: orderName,
        customerEmail: email,
        customerName: customerName || email || "Customer",
        shop,
        status: initialStatus,
        resolutionType: resolutionType as any,
        notes: notes || undefined,
        requireManualApproval: policyEvaluation.autoAction === "MANUAL_REVIEW" || windowExpired,
        marketId: orderMarketId || null,
        requiresShoppingEligibility,
        items: validItems,
        windowOverride: windowExpired ? 1 : undefined,
      });
    }

    await addTimelineEvent({
      returnRequestId: returnRequest.id,
      event: "Return request submitted by customer",
      actor: customerName || email || "Customer",
      actorType: "CUSTOMER",
      details: {
        itemCount: validItems.length,
        ...(windowExpired && {
          windowOverride: true,
          daysSinceFulfillment: eligibility.daysSinceFulfillment,
          effectiveWindowDays: eligibility.effectiveWindowDays,
        }),
      },
      shop: shop,
    });

    const { sendWebhookNotification } = await import("~/services/webhook.server");
    sendWebhookNotification(shop, "return.submitted", returnRequest.id).catch(() => {});

    if (isAutoReject) {
      await addTimelineEvent({
        returnRequestId: returnRequest.id,
        event: "Return automatically rejected by policy",
        actor: "Policy Engine",
        actorType: "SYSTEM",
        details: { reason: "Automatically rejected by policy" },
        shop,
      });
    }

    try {
      const recentEval = await prisma.policyEvaluation.findFirst({
        where: { shop, shopifyOrderId: orderId, returnRequestId: null },
        orderBy: { evaluatedAt: "desc" },
      });
      if (recentEval) {
        const result = await prisma.policyEvaluation.updateMany({
          where: {
            id: recentEval.id,
            shopifyOrderId: orderId,
            returnRequestId: null
          },
          data: { returnRequestId: returnRequest.id },
        });
        if (result.count === 0) {
          console.warn(`[Returns] Policy evaluation ${recentEval.id} already linked by concurrent request`);
        }
      }
    } catch {
      // Best-effort
    }
  } catch (error) {
    console.error("Error creating return request:", error);
    return json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Step 8: Handle automatic actions
  await handleAutoAction(returnRequest, policyEvaluation, windowExpired, shop, email);

  return redirect(`/returns/${returnRequest.id}/status?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(email)}&orderId=${encodeURIComponent(orderId)}`);
};

export default function NewReturn() {
  const { order, eligibleItems, reasons, shop, requiresPhoto, autoAction, resolutionOptions, windowExpired, enableSerialNumbers, serialNumberItems } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [itemFormData, setItemFormData] = useState<Record<string, { qty: string }>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnResolution, setReturnResolution] = useState("REFUND");
  const [returnNote, setReturnNote] = useState("");

  const eligibleItemsKey = eligibleItems.map(i => i.lineItemId).join(",");
  useEffect(() => {
    setSelectedItems(new Set());
    setItemFormData({});
    setReturnReason("");
    setReturnResolution("REFUND");
    setReturnNote("");
  }, [order.id, eligibleItemsKey]);

  const isFormValid = (() => {
    if (selectedItems.size === 0) return false;
    if (!returnReason) return false;
    const reason = reasons.find(r => r.id === returnReason);
    if (!reason) return false;
    if (reason.requiresNote && !returnNote.trim()) return false;
    const normalSelectedItems = Array.from(selectedItems).filter(id => !id.startsWith("sn_"));
    if (normalSelectedItems.length > 0) {
      const allQtyValid = normalSelectedItems.every(itemId => {
        const data = itemFormData[itemId];
        const parsedQty = parseInt(data?.qty);
        if (isNaN(parsedQty) || parsedQty <= 0) return false;
        const item = eligibleItems.find(i => i.lineItemId === itemId);
        if (item && parsedQty > item.returnableQuantity) return false;
        return true;
      });
      if (!allQtyValid) return false;
    }
    return true;
  })();

  const toggleItem = (lineItemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(lineItemId)) {
        next.delete(lineItemId);
      } else {
        next.add(lineItemId);
      }
      return next;
    });
    setItemFormData((prev) => {
      if (prev[lineItemId]) return prev;
      return { ...prev, [lineItemId]: { qty: "1" } };
    });
  };

  const toggleSerialNumberItem = (itemKey: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
    setItemFormData((prev) => {
      if (prev[itemKey]) return prev;
      return { ...prev, [itemKey]: { qty: "1" } };
    });
  };

  const handleQuantityChange = (lineItemId: string, qty: string) => {
    setItemFormData((prev) => ({
      ...prev,
      [lineItemId]: { ...prev[lineItemId], qty }
    }));
  };

  useEffect(() => {
    if (!returnReason) return;
    const reason = reasons.find(r => r.id === returnReason);
    if (!reason) return;

    const hasRxGroupedItem = (() => {
      let found = false;
      if (enableSerialNumbers && serialNumberItems.length > 0) {
        found = Array.from(selectedItems).some(itemKey => {
          if (!itemKey.startsWith("sn_")) return false;
          const sn = itemKey.replace("sn_", "");
          const snItem = serialNumberItems.find(s => s.serialNumber === sn);
          return snItem?.groupedItemTitles && snItem.groupedItemTitles.length > 0;
        });
      }
      if (found) return true;
      return Array.from(selectedItems).some(itemId => {
        if (itemId.startsWith("sn_")) return false;
        const item = eligibleItems.find(i => i.lineItemId === itemId);
        return item?.groupedLineItemIds && item.groupedLineItemIds.length > 1;
      });
    })();

    const rxExcluded = hasRxGroupedItem && resolutionOptions.excludeReplacementForRxGroup;
    const canRefund = reason.appliesToReturn;
    const canReplace = reason.appliesToReplacement && resolutionOptions.enableReplacement && !rxExcluded;

    if (canRefund && !canReplace) setReturnResolution("REFUND");
    else if (!canRefund && canReplace) setReturnResolution("EXCHANGE");
    else setReturnResolution("REFUND");
  }, [returnReason, selectedItems, reasons, enableSerialNumbers, serialNumberItems, eligibleItems, resolutionOptions.enableReplacement, resolutionOptions.excludeReplacementForRxGroup]);

  return (
    <div>
      <div className="mb-4">
        <a href={`/returns?shop=${encodeURIComponent(shop)}`} className="text-sm text-brand-600 hover:text-brand-700">
          &larr; {t("portal.new.backToLookup")}
        </a>
      </div>

      <div className="portal-card mb-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          {t("portal.new.title", { orderName: order.name })}
        </h2>
        <p className="text-sm text-gray-600">
          {t("portal.new.subtitle")}
        </p>
      </div>

      {autoAction === "AUTO_APPROVE" && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
          <p className="text-sm text-green-800">
            {t("portal.new.autoApproveNotice")}
          </p>
        </div>
      )}

      {autoAction === "MANUAL_REVIEW" && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
          <p className="text-sm text-blue-800">
            {t("portal.new.manualReviewNotice")}
          </p>
        </div>
      )}

      {windowExpired && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-md p-4 mb-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-yellow-900 mb-1">
                Return Window Expired
              </p>
              <p className="text-sm text-yellow-800">
                The standard return window for this order has passed. Your return request will be submitted for manual review by our team.
              </p>
            </div>
          </div>
        </div>
      )}

      {requiresPhoto && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
          <p className="text-sm text-amber-800">
            <strong>{t("portal.new.photosRequired")}</strong> {t("portal.new.photosRequiredDetail")}
          </p>
        </div>
      )}

      {actionData && "error" in actionData && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
          <p className="text-sm text-red-700">{actionData.error}</p>
        </div>
      )}

      <Form method="post" aria-hidden={isSubmitting ? "true" : undefined}>
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="orderName" value={order.name} />
        <input type="hidden" name="email" value={order.email} />
        <input type="hidden" name="customerName" value={order.customerName} />
        <input type="hidden" name="resolutionType" value={returnResolution} />
        {enableSerialNumbers && serialNumberItems.length > 0 && (
          <input type="hidden" name="_mode" value="serial" />
        )}

        {eligibleItems.length === 0 && serialNumberItems.length === 0 && (
          <div className="portal-card mb-4 text-center">
            <p className="text-gray-600 font-medium">{t("portal.new.noEligibleItems")}</p>
            <p className="text-sm text-gray-500 mt-1">{t("portal.new.noEligibleItemsDetail")}</p>
          </div>
        )}

        <div className="space-y-3">
          {enableSerialNumbers && serialNumberItems.length > 0 && (
            <SerialNumberItemList
              items={serialNumberItems}
              selectedItems={selectedItems}
              onToggleItem={toggleSerialNumberItem}
            />
          )}

          <ReturnItemList
            items={eligibleItems}
            selectedItems={selectedItems}
            itemFormData={itemFormData}
            onToggleItem={toggleItem}
            onQuantityChange={handleQuantityChange}
          />
        </div>

        <ReturnReasonForm
          reasons={reasons}
          returnReason={returnReason}
          returnResolution={returnResolution}
          returnNote={returnNote}
          selectedItems={selectedItems}
          enableSerialNumbers={enableSerialNumbers}
          serialNumberItems={serialNumberItems}
          eligibleItems={eligibleItems}
          resolutionOptions={resolutionOptions}
          onReasonChange={setReturnReason}
          onResolutionChange={setReturnResolution}
          onNoteChange={setReturnNote}
        />

        <div className="portal-card mt-4">
          <label className="portal-label">{t("portal.new.generalNotes")}</label>
          <textarea
            name="notes"
            rows={3}
            className="portal-input"
            placeholder={t("portal.new.generalNotesPlaceholder")}
          />
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={isSubmitting || !isFormValid}
            className="portal-button-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t("portal.new.submitting") : t("portal.new.submit")}
          </button>
          {selectedItems.size === 0 && (
            <p className="text-sm text-gray-500 text-center mt-2">
              {t("portal.new.selectAtLeastOne")}
            </p>
          )}
          {selectedItems.size > 0 && !isFormValid && (
            <p className="text-sm text-gray-500 text-center mt-2">
              {t("portal.new.selectReasonForAll")}
            </p>
          )}
        </div>
      </Form>

      {isSubmitting && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" role="alert">
          <div className="bg-white rounded-lg p-6 shadow-xl text-center">
            <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full mx-auto mb-3"></div>
            <p className="text-gray-700 font-medium">{t("portal.new.submittingOverlay")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary } from "~/components/portal/ErrorBoundary";
