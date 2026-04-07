import type { ReturnStatus } from "@prisma/client";
import prisma from "~/db.server";
import {
  fetchOrder,
  createReturnOnShopify,
  processRefund,
  createReplacementDraftOrder,
  closeShopifyReturn,
  cancelShopifyReturn,
} from "~/services/shopify.server";
import { transitionStatus } from "~/services/stateMachine.server";
import { generateShippingLabel } from "~/services/shippingLabel.server";
import {
  getReplacementInstruction,
  updateReplacementStatus,
} from "~/models/replacement.server";
import {
  getReturnRequest,
  updateReturnRequestShopifyId,
} from "~/models/returnRequest.server";
import { addComment } from "~/models/returnComment.server";
import { addTimelineEvent } from "~/models/returnTimeline.server";
import { getSettings } from "~/models/returnSettings.server";
import {
  sendReturnApprovedEmail,
  sendReturnRejectedEmail,
  sendRefundProcessedEmail,
} from "~/services/email.server";
import { STATUS_LABELS } from "~/utils/constants";
import { releaseSerialNumbers } from "~/models/serialNumber.server";
import { sendWebhookNotification } from "~/services/webhook.server";

// Type for the Shopify admin client (works with both authenticate.admin and unauthenticated.admin)
type AdminApi = {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response>;
};

export interface ActionResult {
  success: boolean;
  message: string;
  warning?: string;
  data?: Record<string, unknown>;
}

export interface ActorInfo {
  name: string;
  type: "AGENT" | "CUSTOMER" | "SYSTEM";
}

/**
 * Approve a return request.
 * Fetches order, transitions to APPROVED, creates Shopify return,
 * generates shipping label, transitions to AWAITING_SHIPMENT, sends email.
 */
export async function approveReturn(
  admin: AdminApi,
  returnId: string,
  shop: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    // Fetch the original order FIRST — we cannot proceed without it
    const order = await fetchOrder(admin, returnRequest.shopifyOrderId);
    if (!order) {
      return {
        success: false,
        message:
          "Could not fetch the original order from Shopify. Please try again.",
      };
    }

    // Prevent approving returns for cancelled orders
    // Note: closedAt is set on fully-fulfilled orders (normal state for returnable orders), so we only block on cancelledAt
    if (order.cancelledAt) {
      return {
        success: false,
        message: "Cannot approve this return: the order has been cancelled in Shopify.",
      };
    }

    // Create Shopify return BEFORE transitioning to APPROVED
    let labelWarning = "";
    const returnItems = returnRequest.items.map((item) => ({
      lineItemId: item.shopifyLineItemId,
      quantity: item.quantity,
      returnReason: item.returnReason,
      customerNote: item.customerNote || undefined,
    }));

    const shopifyResult = await createReturnOnShopify(
      admin,
      order,
      returnItems,
    );

    if (!("returnId" in shopifyResult)) {
      // Shopify return creation failed - don't transition status, return error
      return {
        success: false,
        message: `Failed to create Shopify return: ${shopifyResult.error}. Please try again.`,
      };
    }

    // Shopify return created successfully - now transition to APPROVED
    await transitionStatus(returnId, "APPROVED", actor, undefined, shop);
    await updateReturnRequestShopifyId(returnId, shop, shopifyResult.returnId);

    // Add window override audit trail if applicable
    if (returnRequest.windowOverride) {
      await addTimelineEvent({
        returnRequestId: returnId,
        event: "Return window override: Return created outside standard window with admin authorization",
        actor: actor.name,
        actorType: actor.type,
        shop: shop,
      });
    }

    // Auto-generate return shipping label
    if (order.shippingAddress) {
      try {
        const customerAddr = {
          name:
            `${order.shippingAddress.firstName || ""} ${order.shippingAddress.lastName || ""}`.trim() ||
            returnRequest.customerName,
          company: order.shippingAddress.company || undefined,
          address1: order.shippingAddress.address1 || "",
          address2: order.shippingAddress.address2 || undefined,
          city: order.shippingAddress.city || "",
          province: order.shippingAddress.province || undefined,
          zip: order.shippingAddress.zip || "",
          country: order.shippingAddress.country || "",
          phone: order.shippingAddress.phone || undefined,
        };
        // Validate address completeness and minimum lengths before generating label
        const MIN_LENGTHS: Record<string, number> = { name: 1, address1: 1, city: 1, zip: 1, country: 2 };
        const requiredFields = ['name', 'address1', 'city', 'zip', 'country'] as const;
        const missing = requiredFields.filter(f => {
          const val = customerAddr[f]?.trim();
          return !val || val.length < (MIN_LENGTHS[f] || 1);
        });
        if (missing.length > 0) {
          throw new Error(`Incomplete shipping address. Missing or too short: ${missing.join(", ")}`);
        }
        await generateShippingLabel({
          returnRequestId: returnId,
          customerAddress: customerAddr,
          orderName: returnRequest.shopifyOrderName,
          itemCount: returnRequest.items.length,
          shop: returnRequest.shop,
          marketId: returnRequest.marketId,
        });
      } catch (err) {
        console.error("Failed to generate shipping label:", err);
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        labelWarning = ` (Warning: Shipping label generation failed: ${errorMsg})`;
        // Add timeline event so merchant can see the failure
        try {
          await addTimelineEvent({
            returnRequestId: returnId,
            event: "Warning: Shipping label generation failed",
            actor: "System",
            actorType: "SYSTEM",
            details: { error: errorMsg },
            shop: returnRequest.shop,
          });
        } catch (timelineErr) {
          console.error("Failed to add label-failure timeline entry:", timelineErr);
        }
      }
    }

    // Auto-transition to AWAITING_SHIPMENT
    await transitionStatus(returnId, "AWAITING_SHIPMENT", {
      name: "System",
      type: "SYSTEM",
    }, undefined, shop);

    // Send approval email
    const settings = await getSettings(returnRequest.shop);
    const fullReturn = await getReturnRequest(returnId, shop);
    let emailWarning: string | undefined;
    if (fullReturn) {
      await sendReturnApprovedEmail(
        fullReturn,
        settings.returnInstructions || undefined,
      ).catch((err) => {
        console.error("Failed to send approval email:", err);
        emailWarning = "Customer notification email failed to send";
      });
    }

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "return.approved", returnId).catch(() => {});

    return {
      success: true,
      message: `Return approved successfully.${labelWarning}`,
      warning: emailWarning,
    };
  } catch (error) {
    console.error("approveReturn error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Approval failed: ${message}` };
  }
}

/**
 * Reject a return request.
 * Transitions to REJECTED, adds comment with reason, sends email.
 */
export async function rejectReturn(
  returnId: string,
  shop: string,
  reason: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    await transitionStatus(returnId, "REJECTED", actor, { reason }, shop);

    // Release any serial numbers that were part of this return (with retry)
    // updateMany with count check — if count is 0, SNs were already released or don't exist
    const returnItemIds = returnRequest.items.map(item => item.id);
    let serialReleaseError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await releaseSerialNumbers(shop, returnRequest.shopifyOrderId, returnItemIds);
        serialReleaseError = null;
        break;
      } catch (err) {
        serialReleaseError = err instanceof Error ? err : new Error(String(err));
        console.error(`[rejectReturn] Serial number release attempt ${attempt}/3 failed for return ${returnId}:`, err);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    if (serialReleaseError) {
      console.error(`[rejectReturn] CRITICAL: All 3 attempts to release serial numbers failed for return ${returnId}`);
      try {
        await addTimelineEvent({
          returnRequestId: returnId,
          event: "CRITICAL: Serial numbers were NOT released after rejection. Manual intervention required.",
          actor: "System",
          actorType: "SYSTEM",
          details: { error: serialReleaseError.message },
          shop,
        });
      } catch {
        // Best-effort timeline logging
      }
    }

    if (reason) {
      await addComment(shop, {
        returnRequestId: returnId,
        author: actor.name,
        authorType: actor.type,
        content: `Return rejected: ${reason}`,
        isInternal: false,
      });
    }

    // Send rejection email
    const fullReturn = await getReturnRequest(returnId, shop);
    let emailWarning: string | undefined;
    if (fullReturn) {
      await sendReturnRejectedEmail(fullReturn, reason).catch((err) => {
        console.error("Failed to send rejection email:", err);
        emailWarning = "Customer notification email failed to send";
      });
    }

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "return.rejected", returnId, { reason }).catch(() => {});

    return { success: true, message: "Return rejected.", warning: emailWarning };
  } catch (error) {
    console.error("rejectReturn error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Rejection failed: ${message}` };
  }
}

/**
 * Cancel a return request.
 * Closes the Shopify return if one was created, then transitions to CANCELLED.
 */
export async function cancelReturn(
  admin: AdminApi,
  returnId: string,
  shop: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    // Cancel the Shopify return if one was created
    if (returnRequest.shopifyReturnId) {
      const cancelResult = await cancelShopifyReturn(admin, returnRequest.shopifyReturnId);
      if ("error" in cancelResult) {
        console.error(`[cancelReturn] Failed to cancel Shopify return ${returnRequest.shopifyReturnId}:`, cancelResult.error);
        return { success: false, message: `Failed to cancel return in Shopify: ${cancelResult.error}` };
      }
    }

    await transitionStatus(returnId, "CANCELLED", actor, undefined, shop);

    // Release any serial numbers that were part of this return (with retry)
    const returnItemIds = returnRequest.items.map(item => item.id);
    let serialReleaseError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await releaseSerialNumbers(shop, returnRequest.shopifyOrderId, returnItemIds);
        serialReleaseError = null;
        break;
      } catch (err) {
        serialReleaseError = err instanceof Error ? err : new Error(String(err));
        console.error(`[cancelReturn] Serial number release attempt ${attempt}/3 failed for return ${returnId}:`, err);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    if (serialReleaseError) {
      console.error(`[cancelReturn] CRITICAL: All 3 attempts to release serial numbers failed for return ${returnId}`);
      try {
        await addTimelineEvent({
          returnRequestId: returnId,
          event: "CRITICAL: Serial numbers were NOT released after cancellation. Manual intervention required.",
          actor: "System",
          actorType: "SYSTEM",
          details: { error: serialReleaseError.message },
          shop,
        });
      } catch {
        // Best-effort timeline logging
      }
    }

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "return.cancelled", returnId).catch(() => {});

    return { success: true, message: "Return cancelled." };
  } catch (error) {
    console.error("cancelReturn error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Cancellation failed: ${message}` };
  }
}

/**
 * Process a refund for a return.
 * Validates not a replacement, processes refund via Shopify,
 * transitions to REFUNDED then CLOSED.
 */
export async function processRefundAction(
  admin: AdminApi,
  returnId: string,
  shop: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    const returnRequestForRefund = await getReturnRequest(returnId, shop);

    if (!returnRequestForRefund) {
      return { success: false, message: "Return not found." };
    }

    // Block refund on replacements
    if (returnRequestForRefund.resolutionType === "EXCHANGE") {
      return {
        success: false,
        message:
          "Refunds are not allowed for replacement returns. Use the replacement flow instead.",
      };
    }

    // Use refundCreate (reliable across API versions) to process the refund
    const refundResult = await processRefund(
      admin,
      returnRequestForRefund.shopifyOrderId,
      returnRequestForRefund.items.map((item) => ({
        lineItemId: item.shopifyLineItemId,
        quantity: item.quantity,
      })),
    );

    // Check if refund succeeded BEFORE closing the Shopify return
    if ("error" in refundResult) {
      return {
        success: false,
        message: `Refund failed: ${refundResult.error}`,
      };
    }

    // Close the Shopify return if one exists (only after successful refund)
    let closeWarning: string | undefined;
    if (returnRequestForRefund.shopifyReturnId) {
      let closeResult = await closeShopifyReturn(admin, returnRequestForRefund.shopifyReturnId);
      // Retry once if failed
      if ("error" in closeResult) {
        console.error(`[CRITICAL] First attempt to close Shopify return ${returnRequestForRefund.shopifyReturnId} failed for return ${returnId}:`, closeResult.error);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        closeResult = await closeShopifyReturn(admin, returnRequestForRefund.shopifyReturnId);
      }
      if ("error" in closeResult) {
        console.error(`[CRITICAL] Failed to close Shopify return ${returnRequestForRefund.shopifyReturnId} after retry for return ${returnId}. Full error:`, closeResult);
        // Persist warning in timeline so merchants know
        try {
          await addTimelineEvent({
            returnRequestId: returnId,
            event: "Warning: Failed to close Shopify return - may need manual closure",
            actor: "System",
            actorType: "SYSTEM",
            details: { error: closeResult.error, shopifyReturnId: returnRequestForRefund.shopifyReturnId },
            shop: shop,
          });
        } catch (timelineErr) {
          console.error("Failed to add close-failure timeline entry:", timelineErr);
        }
        // Don't fail the refund — it already succeeded — but warn the caller
        closeWarning = "Refund processed but Shopify return could not be closed. Manual closure may be needed.";
      }
    }

    await transitionStatus(
      returnId,
      "REFUNDED",
      actor,
      {
        refundId: refundResult.refundId,
        amount: refundResult.amount,
        currency: refundResult.currency,
      },
      shop,
    );

    // Send refund email
    const fullReturn = await getReturnRequest(returnId, shop);
    let emailWarning: string | undefined;
    if (fullReturn) {
      await sendRefundProcessedEmail(
        fullReturn,
        refundResult.amount,
        refundResult.currency,
      ).catch((err) => {
        console.error("Failed to send refund email:", err);
        emailWarning = "Customer notification email failed to send";
      });
    }

    // Auto-close after refund
    try {
      await transitionStatus(returnId, "CLOSED", {
        name: "System",
        type: "SYSTEM",
      }, undefined, shop);
    } catch (err) {
      // Only ignore invalid transition errors (e.g., already closed)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("Invalid transition") || errorMessage.includes("InvalidTransitionError")) {
        // Expected error - ignore
      } else {
        console.error("Unexpected error during auto-close:", err);
        throw err;
      }
    }

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "refund.processed", returnId, {
      refundId: refundResult.refundId,
      amount: refundResult.amount,
      currency: refundResult.currency,
    }).catch(() => {});

    return {
      success: true,
      message: `Status updated to ${STATUS_LABELS["REFUNDED"]}.`,
      warning: [emailWarning, closeWarning].filter(Boolean).join("; ") || undefined,
    };
  } catch (error) {
    console.error("processRefundAction error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Refund failed: ${message}` };
  }
}

/**
 * Process a replacement for a return.
 * Creates replacement order, transitions to EXCHANGED then CLOSED.
 */
export async function processReplacementAction(
  admin: AdminApi,
  returnId: string,
  shop: string,
  notes: string | undefined,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    // Validate items exist
    if (!returnRequest.items || returnRequest.items.length === 0) {
      return {
        success: false,
        message: "Cannot process replacement: no items in return request.",
      };
    }

    // Check if replacement instruction already exists
    let existingReplacement = await getReplacementInstruction(returnId, shop);
    if (!existingReplacement) {
      // Use transaction to claim the slot BEFORE creating the Shopify order (prevents race condition)
      const claimed = await prisma.$transaction(async (tx) => {
        // Check if already exists within transaction
        const existing = await tx.replacementInstruction.findUnique({
          where: { returnRequestId: returnId },
        });
        if (existing) return null; // Already exists, skip

        // Create a placeholder record to claim the slot
        return tx.replacementInstruction.create({
          data: {
            returnRequestId: returnId,
            replacementItems: returnRequest.items.map((item) => ({
              title: item.productTitle,
              variantTitle: item.variantTitle,
              quantity: item.quantity,
            })),
            status: "PENDING",
            notes: "Creating replacement order...",
          },
        });
      });

      if (!claimed) {
        // Another request already claimed it - use existing
        existingReplacement = await getReplacementInstruction(returnId, shop);
      } else {
        // We claimed the slot - now create the Shopify order
        // Fetch the order to get customer info
        const order = await fetchOrder(admin, returnRequest.shopifyOrderId);

        let replacementOrderInfo: {
          draftOrderId: string;
          orderId: string;
          orderName: string;
        } | null = null;
        if (order) {
          // Create free replacement order on Shopify (zero cost, auto-completed)
          const replacementResult = await createReplacementDraftOrder(
            admin,
            order,
            returnId,
            returnRequest.items.map((item) => ({
              lineItemId: item.shopifyLineItemId,
              title: item.productTitle,
              variantTitle: item.variantTitle,
              variantId: item.shopifyVariantId,
              quantity: item.quantity,
            })),
          );

          if ("orderId" in replacementResult) {
            replacementOrderInfo = replacementResult;
          } else {
            console.error(
              "Failed to create replacement order:",
              replacementResult.error,
            );
            // Bug #4 Fix: Update placeholder with FAILED status and error message
            await prisma.replacementInstruction.update({
              where: { returnRequestId: returnId },
              data: {
                status: "FAILED",
                notes: `Failed to create replacement order: ${replacementResult.error}`,
              },
            });
          }
        }

        // Update replacement with real data or keep as pending
        if (replacementOrderInfo) {
          await updateReplacementStatus(returnId, returnRequest.shop, {
            status: "CREATED",
            shopifyNewOrderId: replacementOrderInfo.orderId,
            notes: `Replacement order ${replacementOrderInfo.orderName} created (free of charge).`,
          });
        } else if (!order) {
          // Order fetch failed — mark as FAILED, not PENDING
          await prisma.replacementInstruction.update({
            where: { returnRequestId: returnId },
            data: {
              status: "FAILED",
              notes: notes || "Replacement failed: could not fetch original order from Shopify. Manual order creation required.",
            },
          });
        }
        existingReplacement = await getReplacementInstruction(returnId, shop);

        // Check if replacement failed
        if (existingReplacement?.status === "FAILED") {
          return {
            success: false,
            message: `Replacement order creation failed: ${existingReplacement.notes || "Unknown error"}. Manual processing may be required.`,
          };
        }

        // Close the Shopify return (no refund for replacements)
        if (returnRequest.shopifyReturnId) {
          let closeResult = await closeShopifyReturn(
            admin,
            returnRequest.shopifyReturnId,
          );
          // Retry once if failed
          if ("error" in closeResult) {
            console.error(`[CRITICAL] First attempt to close Shopify return ${returnRequest.shopifyReturnId} failed for return ${returnId}:`, closeResult.error);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            closeResult = await closeShopifyReturn(admin, returnRequest.shopifyReturnId);
          }
          if ("error" in closeResult) {
            console.error(`[CRITICAL] Failed to close Shopify return ${returnRequest.shopifyReturnId} after retry for return ${returnId}. Full error:`, closeResult);
            // Persist warning in timeline so merchants know
            try {
              await addTimelineEvent({
                returnRequestId: returnId,
                event: "Warning: Failed to close Shopify return - may need manual closure",
                actor: "System",
                actorType: "SYSTEM",
                details: { error: closeResult.error, shopifyReturnId: returnRequest.shopifyReturnId },
                shop: shop,
              });
            } catch (timelineErr) {
              console.error("Failed to add close-failure timeline entry:", timelineErr);
            }
          }
        }
      }
    }

    await transitionStatus(
      returnId,
      "EXCHANGED",
      actor,
      {
        notes,
      },
      returnRequest.shop,
    );

    // Auto-close after replacement
    try {
      await transitionStatus(returnId, "CLOSED", {
        name: "System",
        type: "SYSTEM",
      }, undefined, returnRequest.shop);
    } catch (err) {
      // Only ignore invalid transition errors (e.g., already closed)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("Invalid transition") || errorMessage.includes("InvalidTransitionError")) {
        // Expected error - ignore
      } else {
        console.error("Unexpected error during auto-close:", err);
        throw err;
      }
    }

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "replacement.processed", returnId, {
      replacementOrderId: existingReplacement?.shopifyNewOrderId,
      notes,
    }).catch(() => {});

    return {
      success: true,
      message: `Status updated to ${STATUS_LABELS["EXCHANGED"]}.`,
    };
  } catch (error) {
    console.error("processReplacementAction error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Replacement processing failed: ${message}` };
  }
}

/**
 * Generic status transition for statuses like IN_TRANSIT, RECEIVED, etc.
 * Includes auto-close logic for REFUNDED/EXCHANGED.
 */
export async function transitionStatusAction(
  returnId: string,
  newStatus: string,
  shop: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    // Validate status against enum before proceeding
    // REFUNDED and EXCHANGED are excluded from direct transition and must go through:
    // - processRefundAction() for REFUNDED - requires OTP verification for security
    // - processReplacementAction() for EXCHANGED - requires modal confirmation with notes
    // This design ensures proper authorization and context collection for financial/inventory actions.
    const VALID_STATUSES = [
      "SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED", "AWAITING_SHIPMENT",
      "IN_TRANSIT", "RECEIVED", "PARTIALLY_ACCEPTED",
      "CLOSED", "CANCELLED"
    ] as const;

    if (!VALID_STATUSES.includes(newStatus as any)) {
      return { success: false, message: "Invalid status value." };
    }

    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    await transitionStatus(returnId, newStatus as ReturnStatus, actor, undefined, returnRequest.shop);

    // Send webhook notification (fire-and-forget)
    sendWebhookNotification(shop, "return.status_changed", returnId, {
      previousStatus: returnRequest.status,
      newStatus,
    }).catch(() => {});

    return {
      success: true,
      message: `Status updated to ${STATUS_LABELS[newStatus as ReturnStatus]}.`,
    };
  } catch (error) {
    console.error("transitionStatusAction error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Status transition failed: ${message}` };
  }
}

/**
 * Add a comment to a return.
 * Creates comment and optionally timeline event.
 */
export async function addCommentAction(
  returnId: string,
  content: string,
  isInternal: boolean,
  shop: string,
  actor: ActorInfo,
): Promise<ActionResult> {
  try {
    if (!content?.trim()) {
      return { success: false, message: "Comment cannot be empty." };
    }

    const returnRequest = await getReturnRequest(returnId, shop);
    if (!returnRequest) {
      return { success: false, message: "Return not found." };
    }

    await addComment(shop, {
      returnRequestId: returnId,
      author: actor.name,
      authorType: actor.type,
      content: content.trim(),
      isInternal,
    });

    if (!isInternal) {
      await addTimelineEvent({
        returnRequestId: returnId,
        event: "Comment added by support team",
        actor: actor.name,
        actorType: actor.type,
        shop: shop,
      });
    }

    return { success: true, message: "Comment added." };
  } catch (error) {
    console.error("addCommentAction error:", error);
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: `Comment failed: ${message}` };
  }
}

