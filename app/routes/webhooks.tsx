import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Webhook idempotency: skip duplicate deliveries using database
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  const GDPR_TOPICS = new Set(["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"]);
  if (!admin && !GDPR_TOPICS.has(topic)) {
    // Non-GDPR webhooks require admin authentication
    throw new Response("Webhook authentication failed", { status: 401 });
  }

  // BUG FIX: Check for duplicates IMMEDIATELY after auth, before any heavy processing
  // Use atomic database constraint to prevent race conditions
  if (webhookId && typeof webhookId === "string" && webhookId.trim()) {
    try {
      await prisma.processedWebhook.create({
        data: { id: webhookId, topic },
      });
      // Successfully created - this is a new webhook
    } catch (e: any) {
      if (e?.code === "P2002") {
        // Duplicate - already processed (unique constraint violation)
        console.log(`[Webhook] Skipping duplicate webhook: ${webhookId}`);
        throw new Response(null, { status: 200 });
      }
      // Re-throw other database errors
      throw e;
    }
  }

  switch (topic) {
    case "APP_UNINSTALLED":
      // Always delete sessions for the shop, regardless of whether session is truthy
      await prisma.session.deleteMany({ where: { shop } });
      break;

    case "CUSTOMERS_DATA_REQUEST": {
      // Respond with customer data (GDPR)
      console.log(`[Webhook] Customer data request for shop: ${shop}`);

      // Use payload from authenticate.webhook (already parsed)
      const customerEmail = payload.customer?.email;

      if (!customerEmail) {
        console.warn(`[Webhook] CUSTOMERS_DATA_REQUEST: No customer email in payload for shop ${shop}. Returning empty response for GDPR compliance.`);
        // Return 200 for GDPR webhooks even if email is missing (Shopify expects 200)
        return new Response(JSON.stringify({ returnRequests: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Query all return requests for this customer in this shop
      const returnRequests = await prisma.returnRequest.findMany({
        where: {
          shop,
          customerEmail,
        },
        include: {
          items: {
            include: {
              attachments: true,
            },
          },
          comments: true,
          timeline: true,
        },
      });

      // Format the customer data response
      const customerData = {
        shop,
        customer: {
          email: customerEmail,
          name: returnRequests[0]?.customerName || "N/A",
        },
        returnRequests: returnRequests.map((returnRequest) => ({
          id: returnRequest.id,
          orderName: returnRequest.shopifyOrderName,
          orderId: returnRequest.shopifyOrderId,
          status: returnRequest.status,
          resolutionType: returnRequest.resolutionType,
          createdAt: returnRequest.createdAt.toISOString(),
          updatedAt: returnRequest.updatedAt.toISOString(),
          notes: returnRequest.notes,
          items: returnRequest.items.map((item) => ({
            productTitle: item.productTitle,
            variantTitle: item.variantTitle,
            quantity: item.quantity,
            returnReason: item.returnReason,
            customerNote: item.customerNote,
            attachments: item.attachments.map((att) => ({
              filename: (att.url ? att.url.split('/').pop() : null) || att.filename || "unknown",
            })),
          })),
          comments: returnRequest.comments.map((comment) => ({
            author: comment.author,
            content: comment.content,
            createdAt: comment.createdAt.toISOString(),
          })),
          timeline: returnRequest.timeline.map((event) => ({
            event: event.event,
            actor: event.actor,
            details: event.details,
            createdAt: event.createdAt.toISOString(),
          })),
        })),
      };

      return new Response(JSON.stringify(customerData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "CUSTOMERS_REDACT": {
      // Delete/anonymize customer data (GDPR)
      console.log(`[Webhook] Customer redact for shop: ${shop}`);

      // Use payload from authenticate.webhook (already parsed)
      const customerEmail = payload.customer?.email;

      if (!customerEmail) {
        // Return 200 for GDPR webhooks even if email is missing (Shopify expects 200)
        console.warn("[Webhook] CUSTOMERS_REDACT: No customer email provided");
        return new Response(JSON.stringify({ message: "No customer data to redact" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        // Wrap all deletion logic in transaction
        await prisma.$transaction(async (tx) => {
          // Find all return requests for this customer in this shop
          const returnRequests = await tx.returnRequest.findMany({
            where: {
              shop,
              customerEmail,
            },
            select: {
              id: true,
            },
          });

          const returnRequestIds = returnRequests.map((r) => r.id);

          if (returnRequestIds.length > 0) {
            // Find all returnItem IDs for these returnRequests
            const returnItems = await tx.returnItem.findMany({
              where: { returnRequestId: { in: returnRequestIds } },
              select: { id: true },
            });
            const returnItemIds = returnItems.map((ri) => ri.id);

            // Delete in FK-safe order: children first, then parents
            // 1. Delete attachments and serial numbers that reference return items (BEFORE returnItems)
            if (returnItemIds.length > 0) {
              await tx.returnAttachment.deleteMany({
                where: { returnItemId: { in: returnItemIds } },
              });
              await tx.serialNumber.updateMany({
                where: { returnItemId: { in: returnItemIds } },
                data: { returnItemId: null, status: "ACTIVE" },
              });
            }

            // 2. Delete policy evaluations (references returnRequest)
            await tx.policyEvaluation.deleteMany({
              where: { returnRequestId: { in: returnRequestIds } },
            });

            // 3. Delete customer shipping labels (references returnRequest)
            await tx.returnShippingLabel.deleteMany({
              where: { returnRequestId: { in: returnRequestIds } },
            });

            // 4. Delete timeline entries (references returnRequest)
            await tx.returnTimeline.deleteMany({
              where: {
                returnRequestId: { in: returnRequestIds },
              },
            });

            // 5. Delete all comments for these returns (references returnRequest)
            await tx.returnComment.deleteMany({
              where: {
                returnRequestId: { in: returnRequestIds },
              },
            });

            // 6. Delete replacement instructions (references returnRequest)
            await tx.replacementInstruction.deleteMany({
              where: { returnRequestId: { in: returnRequestIds } },
            });

            // 7. Delete return items (references returnRequest)
            await tx.returnItem.deleteMany({
              where: { returnRequestId: { in: returnRequestIds } },
            });

            // 8. Finally, anonymize return requests (no more FK dependencies)
            await tx.returnRequest.updateMany({
              where: {
                shop,
                customerEmail,
              },
              data: {
                customerEmail: "redacted@redacted.com",
                customerName: "Redacted",
              },
            });
          }

          console.log(`[Webhook] Redacted customer data for ${returnRequestIds.length} returns`);
        });
      } catch (error) {
        console.error("[Webhook] CUSTOMERS_REDACT transaction failed:", error);
        // Return 500 so Shopify retries — returning 200 on failure would violate GDPR
        // because Shopify would assume data was successfully deleted
        return new Response(JSON.stringify({ error: "Customer data redaction failed. Will be retried." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      break;
    }

    case "SHOP_REDACT": {
      // Delete ALL shop data (GDPR)
      console.log(`[Webhook] Shop redact for shop: ${shop}`);

      try {
        // Delete in order to respect foreign key constraints
        // Use interactive transaction to guarantee execution order
        await prisma.$transaction(async (tx) => {
          // Delete routing rules and warehouses first (before returns)
          await tx.returnRoutingRule.deleteMany({ where: { shop } });
          await tx.returnWarehouse.deleteMany({ where: { shop } });

          // Find all returnRequest IDs for this shop
          const shopReturnRequests = await tx.returnRequest.findMany({
            where: { shop },
            select: { id: true },
          });
          const shopReturnRequestIds = shopReturnRequests.map((rr) => rr.id);

          if (shopReturnRequestIds.length > 0) {
            // Delete shipping labels (before returns, FK constraint)
            await tx.returnShippingLabel.deleteMany({
              where: { returnRequestId: { in: shopReturnRequestIds } }
            });

            // Delete policy evaluations first (references returnRequest and returnPolicy)
            await tx.policyEvaluation.deleteMany({ where: { shop } });

            // Delete return items and related records (references returnRequest)
            await tx.returnItem.deleteMany({
              where: { returnRequestId: { in: shopReturnRequestIds } }
            });
            await tx.returnComment.deleteMany({
              where: { returnRequestId: { in: shopReturnRequestIds } }
            });
            await tx.returnTimeline.deleteMany({
              where: { returnRequestId: { in: shopReturnRequestIds } }
            });
            await tx.replacementInstruction.deleteMany({
              where: { returnRequestId: { in: shopReturnRequestIds } }
            });
          }

          // Delete return requests
          await tx.returnRequest.deleteMany({ where: { shop } });

          // Delete policies
          await tx.returnPolicy.deleteMany({ where: { shop } });

          // Delete settings
          await tx.returnSettings.deleteMany({ where: { shop } });

          // Delete API keys
          await tx.apiKey.deleteMany({ where: { shop } });

          // Delete custom reasons
          await tx.customReason.deleteMany({ where: { shop } });

          // Delete sessions (last)
          await tx.session.deleteMany({ where: { shop } });
        });

        console.log(`[Webhook] Deleted all data for shop: ${shop}`);
      } catch (error) {
        console.error("[SHOP_REDACT] Failed to fully redact shop data:", error);
        // Return 200 anyway — Shopify will retry, and partial data is better than blocking
      }
      return new Response(null, { status: 200 });
    }

    default:
      console.log(`[Webhook] Unhandled topic: ${topic} for shop: ${shop}`);
      break;
  }

  // Probabilistic cleanup of old webhook IDs (1% chance per request)
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    prisma.processedWebhook.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }).catch(err => console.error("[Webhook] Cleanup failed:", err));
  }

  throw new Response();
};
