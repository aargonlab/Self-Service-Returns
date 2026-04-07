import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Banner,
  Select,
  Checkbox,
  Thumbnail,
  Box,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "~/shopify.server";
import { fetchOrder, checkReturnEligibility } from "~/services/shopify.server";
import { getSettings } from "~/models/returnSettings.server";
import { createReturnRequest } from "~/models/returnRequest.server";
import { addTimelineEvent } from "~/models/returnTimeline.server";
import { evaluatePolicies } from "~/services/policyEngine.server";
import { transitionStatus } from "~/services/stateMachine.server";
import { approveReturn } from "~/services/returnActions.server";
import { ensureDefaultReasons, listActiveReasons, getReasonResolutions } from "~/models/customReason.server";
import { getMarketFromOrder, fetchMarkets } from "~/services/shopifyMarkets.server";
import { ORDERS_SEARCH_QUERY } from "~/utils/shopifyGraphql";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const searchQuery = url.searchParams.get("q");

  const settings = await getSettings(session.shop);
  await ensureDefaultReasons(session.shop);

  // If searching for orders
  let searchResults: Array<{ id: string; name: string; email: string }> = [];
  if (searchQuery) {
    const response = await admin.graphql(ORDERS_SEARCH_QUERY, {
      variables: { query: `name:${searchQuery}` },
    });
    const responseJson = await response.json();
    searchResults = responseJson?.data?.orders?.nodes ?? [];
  }

  // If an order is selected, load full order + eligibility
  let orderData = null;
  let eligibleItems: any[] = [];
  let reasonsForReturn: any[] = [];
  let reasonsForReplacement: any[] = [];
  let requiresPhoto = false;
  let autoAction = null;
  let windowExpired = false;
  let windowWarning = "";
  let effectiveWindowDays: number | null = null;
  let daysSinceFulfillment: number | null = null;
  let ineligibleReason: string | null = null;

  if (orderId) {
    const order = await fetchOrder(admin, orderId);
    if (order) {
      const { markets: shopMarkets } = await fetchMarkets(admin);
      const marketId = getMarketFromOrder(order, shopMarkets);
      const eligibility = await checkReturnEligibility(
        admin,
        order,
        settings,
        session.shop,
        marketId,
      );
      const policyEval = await evaluatePolicies(session.shop, order, settings);

      // Fix: Account for OVERRIDE_WINDOW policy when determining window expiration
      if (policyEval.overriddenWindowDays != null && eligibility.windowExpired) {
        const overriddenDays = policyEval.overriddenWindowDays;
        if (eligibility.daysSinceFulfillment != null && eligibility.daysSinceFulfillment <= overriddenDays) {
          eligibility.windowExpired = false;
          eligibility.warnings = eligibility.warnings?.filter(w => !w.toLowerCase().includes('window'));
          eligibility.reasons = eligibility.reasons?.filter(r => !r.toLowerCase().includes('window'));
          eligibility.effectiveWindowDays = overriddenDays;
        }
      }

      if (!eligibility.eligible) {
        ineligibleReason = eligibility.reasons?.[0] || "This order is not eligible for return.";
      }

      let filteredItems = eligibility.eligibleItems.filter(
        (item) => !policyEval.excludedItems.includes(item.lineItemId),
      );

      // RX Grouping: same logic as customer portal
      if (settings.enableRxGrouping) {
        const lineItems = order.lineItems.nodes;
        const relationshipGroups = new Map<string, string[]>();
        for (const li of lineItems) {
          const relAttr = li.customAttributes?.find(
            (attr: any) => attr.key === "_itemsRelationshipId" && attr.value,
          );
          if (relAttr?.value) {
            const group = relationshipGroups.get(relAttr.value) || [];
            group.push(li.id);
            relationshipGroups.set(relAttr.value, group);
          }
        }

        const hiddenLineItemIds = new Set<string>();
        for (const [, groupIds] of relationshipGroups) {
          if (groupIds.length < 2) continue;
          const groupLineItems = groupIds
            .map((id) => lineItems.find((li: any) => li.id === id))
            .filter(Boolean) as typeof lineItems;
          const lensKeywords = /lens|lente|rx\s*lens|prescription\s*lens/i;
          const frameItem = groupLineItems.find((li: any) => !lensKeywords.test(li.title)) || groupLineItems[0];

          for (const li of groupLineItems) {
            if (li.id !== frameItem.id) hiddenLineItemIds.add(li.id);
          }

          const frameEligible = filteredItems.find((ei) => ei.lineItemId === frameItem.id);
          if (frameEligible) {
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

        filteredItems = filteredItems.filter((item) => !hiddenLineItemIds.has(item.lineItemId));
      }

      // ALL reasons — no customerVisible filter (this is admin)
      const allReasons = await listActiveReasons(session.shop, {
        marketId: marketId || undefined,
      });
      const returnReasons = getReasonResolutions(allReasons, "return", marketId || undefined);
      const replacementReasons = getReasonResolutions(allReasons, "replacement", marketId || undefined);

      orderData = {
        id: order.id,
        name: order.name,
        email: order.email || "",
        customerName: order.customer
          ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
          : order.email || "",
      };
      eligibleItems = filteredItems;
      reasonsForReturn = returnReasons.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        requiresNote: r.requiresNote,
        customerVisible: r.customerVisible,
      }));
      reasonsForReplacement = replacementReasons.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        requiresNote: r.requiresNote,
        customerVisible: r.customerVisible,
      }));
      requiresPhoto = policyEval.requiresPhoto || false;
      autoAction = policyEval.autoAction;

      // Window expiration data from eligibility check
      windowExpired = eligibility.windowExpired === true;
      effectiveWindowDays = eligibility.effectiveWindowDays ?? null;
      daysSinceFulfillment = eligibility.daysSinceFulfillment ?? null;
      if (windowExpired) {
        windowWarning = `This order was fulfilled ${daysSinceFulfillment} days ago, which exceeds the ${effectiveWindowDays}-day return window.`;
      }
    }
  }

  return json({
    searchResults,
    orderData,
    eligibleItems,
    reasonsForReturn,
    reasonsForReplacement,
    requiresPhoto,
    autoAction,
    settings: {
      enableReplacement: settings.enableReplacement,
      enableRxGrouping: settings.enableRxGrouping,
      excludeReplacementForRxGroup: settings.excludeReplacementForRxGroup ?? false,
    },
    shop: session.shop,
    searchQuery: searchQuery || "",
    orderId: orderId || "",
    windowExpired,
    windowWarning,
    effectiveWindowDays,
    daysSinceFulfillment,
    ineligibleReason,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent !== "create") {
    return json({ error: "Invalid action" }, { status: 400 });
  }

  const orderId = formData.get("orderId") as string;
  const orderName = formData.get("orderName") as string;
  const email = formData.get("email") as string;
  const customerName = formData.get("customerName") as string;
  const notes = formData.get("notes") as string;
  const resolutionType = (formData.get("resolutionType") as string) || "REFUND";
  const windowOverrideAck = formData.get("windowOverrideAck") === "true";

  // Parse selected items
  const itemKeys = Array.from(formData.keys()).filter((k) => k.startsWith("item_"));
  const selectedLineItemIds = itemKeys.map((k) => k.replace("item_", ""));

  if (selectedLineItemIds.length === 0) {
    return json({ error: "Please select at least one item." }, { status: 400 });
  }

  if (!["REFUND", "EXCHANGE"].includes(resolutionType)) {
    return json({ error: "Invalid resolution type." }, { status: 400 });
  }

  // Fetch order via authenticated admin API
  const order = await fetchOrder(admin, orderId);
  if (!order) {
    return json({ error: "Order not found." }, { status: 400 });
  }

  const settings = await getSettings(session.shop);
  const { markets: actionMarkets } = await fetchMarkets(admin);
  const marketId = getMarketFromOrder(order, actionMarkets);

  // RX Grouping: auto-expand selected frames to include grouped lenses
  const groupedToPrimary = new Map<string, string>(); // lensId → frameId
  if (settings.enableRxGrouping) {
    const lineItems = order.lineItems.nodes;
    const alreadySelected = new Set(selectedLineItemIds);
    for (const selectedId of [...selectedLineItemIds]) {
      const li = lineItems.find((l: any) => l.id === selectedId);
      const relAttr = li?.customAttributes?.find(
        (attr: any) => attr.key === "_itemsRelationshipId" && attr.value,
      );
      if (!relAttr?.value) continue;
      for (const otherLi of lineItems) {
        if (alreadySelected.has(otherLi.id)) continue;
        const otherRel = otherLi.customAttributes?.find(
          (a: any) => a.key === "_itemsRelationshipId" && a.value === relAttr.value,
        );
        if (otherRel) {
          selectedLineItemIds.push(otherLi.id);
          alreadySelected.add(otherLi.id);
          groupedToPrimary.set(otherLi.id, selectedId);
        }
      }
    }
  }

  // Fix: Validate expanded items against policy exclusions
  if (settings.enableRxGrouping && selectedLineItemIds.length > 0) {
    const expansionPolicyEval = await evaluatePolicies(session.shop, order, settings);
    for (const expandedId of selectedLineItemIds) {
      if (expansionPolicyEval.excludedItems.includes(expandedId)) {
        return json({ error: "One or more grouped items are excluded by store policy." }, { status: 400 });
      }
    }
  }

  // Build items from order data (prevent tampering)
  const resolutionPrefix = resolutionType === "EXCHANGE" ? "REP" : "RET";
  const reasonId = (formData.get("reason") as string);
  const returnNote = (formData.get("returnNote") as string) || "";
  const items = selectedLineItemIds.map((lineItemId, index) => {
    const orderItem = order.lineItems.nodes.find((li) => li.id === lineItemId);
    // For grouped lens items, inherit qty from the frame but force qty=1 for lenses
    const primaryId = groupedToPrimary.get(lineItemId) || lineItemId;
    const isGroupedLens = groupedToPrimary.has(lineItemId);
    const rawQty = parseInt(formData.get(`qty_${primaryId}`) as string) || 1;
    const qty = isGroupedLens ? 1 : rawQty;

    // Bug #385: Validate shopifyLineItemId and quantity
    if (!lineItemId || !orderItem) {
      return { error: `Invalid item at position ${index + 1}`, item: null };
    }
    if (isNaN(qty) || qty < 1) {
      return { error: `Invalid quantity for item "${orderItem?.title || 'Unknown'}"`, item: null };
    }

    return {
      error: null,
      item: {
        shopifyLineItemId: lineItemId,
        shopifyVariantId: orderItem?.variant?.id || undefined,
        productTitle: orderItem?.title || "Unknown",
        variantTitle: orderItem?.variantTitle || undefined,
        sku: orderItem?.sku || undefined,
        imageUrl: orderItem?.image?.url || undefined,
        price: orderItem?.discountedUnitPriceSet?.shopMoney?.amount || undefined,
        quantity: qty,
        returnReason: "", // Will be set after validation
        compositeCode: "", // Will be set after validation
        customerNote: returnNote || undefined,
      }
    };
  });

  // Check for validation errors
  const firstError = items.find(result => result.item === null);
  if (firstError) {
    return json({ error: firstError.error || "Invalid item or quantity. Please check your selection." }, { status: 400 });
  }

  const validItems = items.map(result => result.item).filter((item): item is NonNullable<typeof item> => item !== null);

  // Validate reason — admin can use ALL reasons (no customerVisible filter)
  await ensureDefaultReasons(session.shop);
  const reasonType =
    resolutionType === "EXCHANGE" ? ("replacement" as const) : ("return" as const);
  const validReasons = await listActiveReasons(session.shop, {
    type: reasonType,
    marketId: marketId || undefined,
  });
  const validIds = validReasons.map((r) => r.id);
  if (!reasonId || !validIds.includes(reasonId)) {
    return json({ error: "The selected return reason is no longer available. Please refresh the page and try again." }, { status: 400 });
  }
  // Resolve reason code from id
  const selectedReasonObj = validReasons.find((r) => r.id === reasonId);
  const reasonCode = selectedReasonObj?.code || "OTHER";

  // Update items with resolved reason code
  for (const item of validItems) {
    item.returnReason = reasonCode;
    item.compositeCode = `${resolutionPrefix}-${reasonCode}`;
  }
  if (selectedReasonObj?.requiresNote && !returnNote?.trim()) {
    return json({ error: `Note is required for reason: ${selectedReasonObj.label}` }, { status: 400 });
  }

  // Fix: Re-validate that the selected reason allows the chosen resolution type in this market
  if (resolutionType === "EXCHANGE") {
    const { getReasonResolutions: getResolutions } = await import("~/models/customReason.server");
    const allActiveReasons = await listActiveReasons(session.shop, { marketId: marketId || undefined });
    const replacementReasons = getResolutions(allActiveReasons, "replacement", marketId || undefined);
    if (!replacementReasons.some(r => r.id === reasonId)) {
      return json({ error: "Replacement is not available for this reason in the current market." }, { status: 400 });
    }
  }

  // Validate resolution type against settings
  if (resolutionType === "EXCHANGE" && !settings.enableReplacement) {
    return json({ error: "Replacement is not enabled." }, { status: 400 });
  }

  // Validate: if excludeReplacementForRxGroup is enabled, block replacement for grouped RX items
  if (resolutionType === "EXCHANGE" && settings.excludeReplacementForRxGroup && settings.enableRxGrouping) {
    const lineItems = order.lineItems.nodes;
    for (const selectedId of selectedLineItemIds) {
      const li = lineItems.find((l: any) => l.id === selectedId);
      const relAttr = li?.customAttributes?.find(
        (attr: any) => attr.key === "_itemsRelationshipId" && attr.value,
      );
      if (relAttr?.value) {
        return json({ error: "Replacement is not available for prescription products. Please select refund instead." }, { status: 400 });
      }
    }
  }

  // Check eligibility
  const eligibility = await checkReturnEligibility(
    admin,
    order,
    settings,
    session.shop,
    marketId,
  );
  if (!eligibility.eligible) {
    return json({ error: "This order is not eligible for returns." }, { status: 400 });
  }

  // Window override gate: if window is expired, admin MUST acknowledge
  const windowExpired = eligibility.windowExpired === true;
  if (windowExpired && !windowOverrideAck) {
    return json(
      { error: "You must acknowledge the return window override to proceed." },
      { status: 400 }
    );
  }

  // Evaluate policies
  const policyResolutionType = resolutionType === "EXCHANGE" ? "EXCHANGE" : "REFUND";
  const policyEvaluation = await evaluatePolicies(session.shop, order, settings, reasonCode, policyResolutionType, reasonId);

  // Fix: Account for OVERRIDE_WINDOW policy when determining window expiration
  if (policyEvaluation.overriddenWindowDays != null && eligibility.windowExpired) {
    const overriddenDays = policyEvaluation.overriddenWindowDays;
    if (eligibility.daysSinceFulfillment != null && eligibility.daysSinceFulfillment <= overriddenDays) {
      eligibility.windowExpired = false;
      eligibility.effectiveWindowDays = overriddenDays;
    }
  }

  const filteredEligibleItems = eligibility.eligibleItems.filter(
    (item) => !policyEvaluation.excludedItems.includes(item.lineItemId),
  );

  // Validate quantities
  for (const item of validItems) {
    const eligible = filteredEligibleItems.find((e) => e.lineItemId === item.shopifyLineItemId);
    if (!eligible || item.quantity > eligible.returnableQuantity) {
      return json({ error: "Invalid quantity for one or more items." }, { status: 400 });
    }
  }

  // Idempotency: prevent rapid double-click duplicate submissions (5 minute window to handle slow connections)
  const { default: prismaClient } = await import("~/db.server");
  const recentReturn = await prismaClient.returnRequest.findFirst({
    where: {
      shop: session.shop,
      shopifyOrderId: orderId,
      status: { in: ["SUBMITTED", "PENDING_REVIEW"] },
      createdAt: { gte: new Date(Date.now() - 300_000) }, // 5 minutes = 300 seconds
    },
    select: { id: true },
  });
  if (recentReturn) {
    return redirect(`/app/returns/${recentReturn.id}`);
  }

  // Determine initial status: AUTO_REJECT should create directly as REJECTED
  const isAutoReject = policyEvaluation.autoAction === "AUTO_REJECT";
  const initialStatus = isAutoReject ? "REJECTED" : "SUBMITTED";

  try {
    const returnRequest = await createReturnRequest({
      shopifyOrderId: orderId,
      shopifyOrderName: orderName,
      customerEmail: email,
      customerName: customerName || email || "Customer",
      shop: session.shop,
      status: initialStatus,
      resolutionType: resolutionType as any,
      notes: notes || undefined,
      requireManualApproval: policyEvaluation.autoAction === "MANUAL_REVIEW",
      marketId,
      items: validItems,
      windowOverride: windowExpired ? 1 : undefined,
    });

    await addTimelineEvent({
      returnRequestId: returnRequest.id,
      event: "Return request created by staff",
      actor: "Admin",
      actorType: "AGENT",
      details: { itemCount: validItems.length },
      shop: session.shop,
    });

    if (isAutoReject) {
      await addTimelineEvent({
        returnRequestId: returnRequest.id,
        event: "Return automatically rejected by policy",
        actor: "Policy Engine",
        actorType: "SYSTEM",
        details: { reason: "Automatically rejected by policy" },
        shop: session.shop,
      });
    }

    // Same auto-action handling as customer portal
    if (policyEvaluation.autoAction === "AUTO_APPROVE") {
      // Use the same approveReturn() flow as manual approval
      // This creates the Shopify return, generates label, transitions to AWAITING_SHIPMENT, sends email
      const approvalResult = await approveReturn(
        admin,
        returnRequest.id,
        session.shop,
        { name: "Policy Engine", type: "SYSTEM" },
      );
      if (!approvalResult.success) {
        console.error(`[AdminAutoApprove] approveReturn failed for ${returnRequest.id}: ${approvalResult.message}`);
        // Fallback: transition to PENDING_REVIEW so it doesn't sit in SUBMITTED
        try {
          await transitionStatus(
            returnRequest.id,
            "PENDING_REVIEW",
            { name: "Policy Engine", type: "SYSTEM" },
            { reason: `Auto-approve failed: ${approvalResult.message}. Requires manual approval.` },
            session.shop,
          );
        } catch (transErr) {
          console.error(`[AdminAutoApprove] Also failed to transition to PENDING_REVIEW:`, transErr);
        }
      } else {
        console.info(`[AdminAutoApprove] Return ${returnRequest.id} fully approved via approveReturn: ${approvalResult.message}`);
      }
    } else if (policyEvaluation.autoAction === "AUTO_REJECT") {
      if (!isAutoReject) {
        // Only transition if not already created as REJECTED
        await transitionStatus(
          returnRequest.id,
          "REJECTED",
          { name: "Policy Engine", type: "SYSTEM" },
          { reason: "Automatically rejected by policy" },
          session.shop,
        );
      }
      // Send rejection email
      try {
        const { sendReturnRejectedEmail } = await import("~/services/email.server");
        const { getReturnRequest: getReturn } = await import("~/models/returnRequest.server");
        const fullReq = await getReturn(returnRequest.id, session.shop);
        if (fullReq) {
          sendReturnRejectedEmail(fullReq, "This return was automatically declined based on our return policy.").catch(console.error);
        }
      } catch {}
    } else if (policyEvaluation.autoAction === "MANUAL_REVIEW") {
      await transitionStatus(
        returnRequest.id,
        "PENDING_REVIEW",
        { name: "Policy Engine", type: "SYSTEM" },
        { reason: "Flagged for manual review by policy" },
        session.shop,
      );
    }

    // Send confirmation email (non-blocking)
    try {
      const { sendReturnConfirmationEmail } = await import("~/services/email.server");
      const { getReturnRequest } = await import("~/models/returnRequest.server");
      const fullRequest = await getReturnRequest(returnRequest.id, session.shop);
      if (fullRequest) {
        sendReturnConfirmationEmail(fullRequest).catch(console.error);
      }
    } catch {}

    return redirect(`/app/returns/${returnRequest.id}`);
  } catch (error) {
    console.error("Error creating return:", error);
    return json(
      { error: "Failed to create return. Please try again." },
      { status: 500 },
    );
  }
};

export default function AdminNewReturn() {
  const {
    searchResults,
    orderData,
    eligibleItems,
    reasonsForReturn,
    reasonsForReplacement,
    settings,
    searchQuery,
    orderId,
    windowExpired,
    windowWarning,
    ineligibleReason,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const isSubmitting = navigation.state === "submitting";
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [resolutionType, setResolutionType] = useState("REFUND");
  const [itemData, setItemData] = useState<
    Record<string, { qty: string }>
  >({});
  const [returnReason, setReturnReason] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [notes, setNotes] = useState("");
  const [windowOverrideAck, setWindowOverrideAck] = useState(false);

  const currentReasons =
    resolutionType === "EXCHANGE" ? reasonsForReplacement : reasonsForReturn;
  // Check if any selected item belongs to an RX group
  const hasSelectedRxGrouped = settings.enableRxGrouping && Array.from(selectedItems).some(itemId => {
    const item = eligibleItems.find((i: any) => i.lineItemId === itemId);
    return item?.groupedLineItemIds && item.groupedLineItemIds.length > 1;
  });

  // Block replacement for RX grouped items when flag is set
  const rxReplacementBlocked = hasSelectedRxGrouped && settings.excludeReplacementForRxGroup;

  // Resolution options for Select
  const resolutionOptions = [
    { label: "Refund", value: "REFUND" },
    ...(settings.enableReplacement && !rxReplacementBlocked
      ? [{ label: "Replacement", value: "EXCHANGE" }]
      : []),
  ];

  // Auto-switch to REFUND when replacement becomes blocked
  useEffect(() => {
    if (rxReplacementBlocked && resolutionType === "EXCHANGE") {
      setResolutionType("REFUND");
      // Reset reason — the available reasons list changes with resolution type
      setReturnReason("");
      setReturnNote("");
    }
  }, [rxReplacementBlocked, resolutionType]);

  // Reset reason when it's not in the current reasons list (e.g., after resolution type change)
  useEffect(() => {
    if (returnReason && !currentReasons.some(r => r.id === returnReason)) {
      setReturnReason("");
      setReturnNote("");
    }
  }, [returnReason, currentReasons]);

  // Bug #238 Fix: Reset form state when order changes
  useEffect(() => {
    setSelectedItems(new Set());
    setItemData({});
    setResolutionType("REFUND");
    setReturnReason("");
    setReturnNote("");
    setWindowOverrideAck(false);
  }, [orderId]);

  return (
    <Page
      title="Create Return"
      backAction={{ content: "Returns", url: "/app/returns" }}
    >
      <BlockStack gap="500">
        {/* Error banner */}
        {actionData && "error" in actionData && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}

        {/* Step 1: Order Search (shown when no order selected) */}
        {!orderData && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Find Order
              </Text>
              <Form method="get">
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      label="Order number"
                      value={searchInput}
                      onChange={setSearchInput}
                      name="q"
                      autoComplete="off"
                      placeholder="e.g. 1001"
                      connectedRight={
                        <Button submit loading={isLoading} variant="primary">
                          Search
                        </Button>
                      }
                    />
                  </div>
                </InlineStack>
              </Form>

              {searchResults.length > 0 && (
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {searchResults.length} order(s) found
                  </Text>
                  {searchResults.map((result) => (
                    <InlineStack
                      key={result.id}
                      align="space-between"
                      blockAlign="center"
                    >
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {result.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {result.email}
                        </Text>
                      </BlockStack>
                      <Button
                        url={`/app/returns/new?orderId=${encodeURIComponent(result.id)}`}
                        size="slim"
                      >
                        Select
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}

              {searchQuery && searchResults.length === 0 && (
                <Banner tone="info">No orders found for &quot;{searchQuery}&quot;.</Banner>
              )}
            </BlockStack>
          </Card>
        )}

        {/* Step 2: Return Form (shown when order is selected) */}
        {orderData && (
          <>
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Order {orderData.name}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {orderData.customerName} ({orderData.email})
                  </Text>
                </BlockStack>
                <Button url="/app/returns/new" variant="plain">
                  Change order
                </Button>
              </InlineStack>
            </Card>

            {eligibleItems.length === 0 ? (
              <Card>
                <Banner tone="warning">
                  {ineligibleReason || "No items in this order are eligible for return."}
                </Banner>
              </Card>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <input type="hidden" name="orderId" value={orderData.id} />
                <input type="hidden" name="orderName" value={orderData.name} />
                <input type="hidden" name="email" value={orderData.email} />
                <input type="hidden" name="customerName" value={orderData.customerName} />
                <input type="hidden" name="notes" value={notes} />
                <input type="hidden" name="resolutionType" value={resolutionType} />
                <input type="hidden" name="reason" value={returnReason} />
                <input type="hidden" name="returnNote" value={returnNote} />
                <input type="hidden" name="windowOverrideAck" value={String(windowOverrideAck)} />

                <BlockStack gap="400">
                  {/* Window override warning banner */}
                  {windowExpired && (
                    <Banner tone="warning">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd">
                          <strong>Return window has expired.</strong>
                        </Text>
                        <Text as="p" variant="bodySm">
                          {windowWarning}
                        </Text>
                        <Checkbox
                          label="I acknowledge that this return is outside the normal return window and authorize it to proceed."
                          checked={windowOverrideAck}
                          onChange={setWindowOverrideAck}
                        />
                      </BlockStack>
                    </Banner>
                  )}
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">
                        Select Items
                      </Text>

                      {eligibleItems.map((item) => {
                        const isSelected = selectedItems.has(item.lineItemId);
                        const data = itemData[item.lineItemId] || {
                          qty: "1",
                        };

                        return (
                          <Box
                            key={item.lineItemId}
                            padding="300"
                            borderColor="border"
                            borderWidth="025"
                            borderRadius="200"
                          >
                            <BlockStack gap="300">
                              <InlineStack gap="300" blockAlign="center">
                                <Checkbox
                                  label=""
                                  labelHidden
                                  checked={isSelected}
                                  onChange={(checked) => {
                                    const next = new Set(selectedItems);
                                    if (checked) {
                                      next.add(item.lineItemId);
                                      if (!itemData[item.lineItemId]) {
                                        setItemData((prev) => ({
                                          ...prev,
                                          [item.lineItemId]: {
                                            qty: "1",
                                          },
                                        }));
                                      }
                                    } else {
                                      next.delete(item.lineItemId);
                                    }
                                    setSelectedItems(next);
                                  }}
                                />
                                {item.imageUrl && (
                                  <Thumbnail
                                    source={item.imageUrl}
                                    alt={item.title}
                                    size="small"
                                  />
                                )}
                                <BlockStack gap="050">
                                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                                    {item.title}
                                  </Text>
                                  {item.variantTitle && (
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {item.variantTitle}
                                    </Text>
                                  )}
                                  {item.groupedItemTitles && item.groupedItemTitles.length > 0 && (
                                    <BlockStack gap="0">
                                      {item.groupedItemTitles.map((title: string, i: number) => (
                                        <Text key={i} as="span" variant="bodySm" tone="subdued">
                                          + {title}
                                        </Text>
                                      ))}
                                    </BlockStack>
                                  )}
                                  <Text as="span" variant="bodySm">
                                    {item.price} × {item.returnableQuantity} available
                                  </Text>
                                </BlockStack>
                              </InlineStack>

                              {isSelected && (
                                <>
                                  <input
                                    type="hidden"
                                    name={`item_${item.lineItemId}`}
                                    value="1"
                                  />
                                  <div style={{ width: "100px" }}>
                                    <Select
                                      label="Qty"
                                      options={Array.from(
                                        { length: item.returnableQuantity },
                                        (_, i) => ({
                                          label: String(i + 1),
                                          value: String(i + 1),
                                        }),
                                      )}
                                      value={data.qty}
                                      name={`qty_${item.lineItemId}`}
                                      onChange={(val) =>
                                        setItemData((prev) => ({
                                          ...prev,
                                          [item.lineItemId]: {
                                            ...prev[item.lineItemId],
                                            qty: val,
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                </>
                              )}
                            </BlockStack>
                          </Box>
                        );
                      })}
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Select
                        label="Return reason"
                        options={[
                          { label: "Select a reason...", value: "" },
                          ...currentReasons.map((r) => ({
                            label:
                              r.customerVisible === false
                                ? `${r.label} (Admin only)`
                                : r.label,
                            value: r.id,
                          })),
                        ]}
                        value={returnReason}
                        onChange={setReturnReason}
                      />
                      {currentReasons.find((r) => r.id === returnReason)
                        ?.requiresNote && (
                        <TextField
                          label="Note (required for this reason)"
                          value={returnNote}
                          onChange={setReturnNote}
                          autoComplete="off"
                          multiline={2}
                        />
                      )}
                      <Select
                        label="Resolution type"
                        options={resolutionOptions}
                        value={resolutionType}
                        onChange={setResolutionType}
                      />
                      {rxReplacementBlocked && (
                        <Banner tone="warning">
                          <p>Replacement is not available for prescription products. Only refund is offered.</p>
                        </Banner>
                      )}
                      <TextField
                        label="Internal notes (optional)"
                        value={notes}
                        onChange={setNotes}
                        autoComplete="off"
                        multiline={2}
                        helpText="Only visible to staff, not the customer"
                      />
                    </BlockStack>
                  </Card>

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      submit
                      loading={isSubmitting}
                      disabled={
                        isSubmitting ||
                        selectedItems.size === 0 ||
                        !returnReason ||
                        !currentReasons.some(r => r.id === returnReason) ||
                        (windowExpired && !windowOverrideAck) ||
                        (() => {
                          const selectedReasonObj = currentReasons.find(r => r.id === returnReason);
                          return selectedReasonObj?.requiresNote && !returnNote.trim();
                        })()
                      }
                    >
                      Create Return
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
