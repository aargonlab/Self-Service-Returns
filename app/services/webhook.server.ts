import { createHmac } from "crypto";
import { getSettings } from "~/models/returnSettings.server";
import { getReturnRequest } from "~/models/returnRequest.server";
import { getShippingLabel } from "~/services/shippingLabel.server";
import { getReplacementInstruction } from "~/models/replacement.server";
import { validateExternalUrl } from "~/utils/validators";
import { decryptCredential } from "~/utils/encryption.server";

export type WebhookEvent =
  | "return.submitted"
  | "return.approved"
  | "return.rejected"
  | "return.cancelled"
  | "return.status_changed"
  | "refund.processed"
  | "replacement.processed"
  | "disclaimer.accepted";

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  shop: string;
  data: Record<string, unknown>;
}

/**
 * Sign a payload with HMAC-SHA256 using the webhook secret.
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Build a full return payload for the webhook, including items and shipping label.
 */
async function buildReturnPayload(
  returnId: string,
  shop: string,
  extras?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const returnRequest = await getReturnRequest(returnId, shop);
  if (!returnRequest) return null;

  let shippingLabel = null;
  try {
    shippingLabel = await getShippingLabel(returnId, shop);
  } catch {
    // Label may not exist yet — that's fine
  }

  let replacementInstruction = null;
  try {
    replacementInstruction = await getReplacementInstruction(returnId, shop);
  } catch {
    // Replacement may not exist — that's fine
  }

  return {
    id: returnRequest.id,
    shopifyOrderId: returnRequest.shopifyOrderId,
    shopifyOrderName: returnRequest.shopifyOrderName,
    shopifyReturnId: returnRequest.shopifyReturnId,
    status: returnRequest.status,
    customerEmail: returnRequest.customerEmail,
    customerName: returnRequest.customerName,
    resolutionType: returnRequest.resolutionType,
    returnWindow: returnRequest.returnWindow,
    windowOverride: returnRequest.windowOverride,
    requireManualApproval: returnRequest.requireManualApproval,
    requiresShoppingEligibility: returnRequest.requiresShoppingEligibility,
    disclaimerAcceptedAt: returnRequest.disclaimerAcceptedAt,
    marketId: returnRequest.marketId,
    notes: returnRequest.notes,
    createdAt: returnRequest.createdAt,
    updatedAt: returnRequest.updatedAt,
    closedAt: returnRequest.closedAt,
    items: returnRequest.items.map((item) => ({
      id: item.id,
      shopifyLineItemId: item.shopifyLineItemId,
      shopifyVariantId: item.shopifyVariantId,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      sku: item.sku,
      imageUrl: item.imageUrl,
      price: item.price,
      quantity: item.quantity,
      returnReason: item.returnReason,
      compositeCode: item.compositeCode,
      customerNote: item.customerNote,
      serialNumber: item.serialNumber,
      sapLineId: item.sapLineId,
    })),
    shippingLabel: shippingLabel
      ? {
          carrier: shippingLabel.carrier,
          carrierCode: shippingLabel.carrierCode,
          trackingNumber: shippingLabel.trackingNumber,
          trackingUrl: shippingLabel.trackingUrl,
          labelUrl: shippingLabel.labelUrl,
          barcode: shippingLabel.barcode,
          status: shippingLabel.status,
          source: shippingLabel.source,
          sinNumber: shippingLabel.sinNumber,
          freight: shippingLabel.freight,
        }
      : null,
    replacementInstruction: replacementInstruction
      ? {
          id: replacementInstruction.id,
          shopifyNewOrderId: replacementInstruction.shopifyNewOrderId,
          replacementItems: replacementInstruction.replacementItems,
          status: replacementInstruction.status,
          notes: replacementInstruction.notes,
          createdAt: replacementInstruction.createdAt,
          updatedAt: replacementInstruction.updatedAt,
        }
      : null,
    timeline: returnRequest.timeline.map((entry) => ({
      event: entry.event,
      actor: entry.actor,
      actorType: entry.actorType,
      details: entry.details,
      createdAt: entry.createdAt,
    })),
    ...extras,
  };
}

/**
 * Send a webhook notification for a return event.
 * Fire-and-forget: errors are logged but never block the main flow.
 *
 * @param shop - The shop domain
 * @param event - The webhook event type
 * @param returnId - The return request ID
 * @param extras - Additional data to merge into the payload (e.g., previousStatus, refundAmount)
 */
export async function sendWebhookNotification(
  shop: string,
  event: WebhookEvent,
  returnId: string,
  extras?: Record<string, unknown>,
): Promise<void> {
  try {
    const settings = await getSettings(shop);

    // Skip if webhooks not configured or not active
    if (!settings.webhookActive || !settings.webhookUrl) {
      return;
    }

    // Skip if this event type is not enabled in settings
    const enabledEvents = Array.isArray(settings.webhookEvents)
      ? settings.webhookEvents as string[]
      : [];
    if (enabledEvents.length > 0 && !enabledEvents.includes(event)) {
      return;
    }

    // For return.status_changed, check if the target status is in the allowed list
    if (event === "return.status_changed") {
      const statusFilters = Array.isArray(settings.webhookStatusFilters)
        ? settings.webhookStatusFilters as string[]
        : [];
      if (statusFilters.length > 0 && extras?.newStatus) {
        if (!statusFilters.includes(extras.newStatus as string)) {
          return;
        }
      }
    }

    const data = await buildReturnPayload(returnId, shop, extras);
    if (!data) {
      console.warn(`[Webhook] Return ${returnId} not found, skipping ${event} notification`);
      return;
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      shop,
      data,
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Event": event,
      "X-Webhook-Timestamp": payload.timestamp,
    };

    // Add HMAC signature if secret is configured
    if (settings.webhookSecret) {
      let webhookSecret = settings.webhookSecret;
      try {
        webhookSecret = decryptCredential(settings.webhookSecret);
      } catch (error) {
        console.error("[Webhook] Failed to decrypt webhook secret:", error);
      }
      const signature = signPayload(body, webhookSecret);
      headers["X-Webhook-Signature"] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      // SSRF protection: validate webhook URL
      validateExternalUrl(settings.webhookUrl, "Webhook URL");

      const response = await fetch(settings.webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(
          `[Webhook] ${event} delivery failed for return ${returnId}: HTTP ${response.status} ${response.statusText}`,
        );
      } else {
        console.log(`[Webhook] ${event} delivered for return ${returnId} (HTTP ${response.status})`);
      }
    } catch (fetchError) {
      throw fetchError;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // Fire-and-forget — never let webhook failures affect the main flow
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[Webhook] ${event} delivery timed out for return ${returnId}`);
    } else {
      console.error(`[Webhook] ${event} delivery error for return ${returnId}:`, error);
    }
  }
}
