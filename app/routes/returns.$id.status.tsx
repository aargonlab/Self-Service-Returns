import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { getReturnRequestByIdAndEmail } from "~/models/returnRequest.server";
import {
  STATUS_PROGRESS,
  RETURN_REASONS,
} from "~/utils/constants";
import type { ReturnStatus as ReturnStatusType } from "@prisma/client";
import { useTranslation } from "~/utils/useTranslation";
import prisma from "~/db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");
  const email = url.searchParams.get("email");
  const orderId = url.searchParams.get("orderId");

  // If shop is missing, try to look it up from the return ID
  if (!shop) {
    const returnId = params.id;
    if (returnId) {
      const returnRecord = await prisma.returnRequest.findUnique({
        where: { id: returnId },
        select: { shop: true },
      });
      if (returnRecord) {
        shop = returnRecord.shop;
      }
    }
  }

  // Portal authentication security model:
  // The combination of returnRequestId (cuid) + email + orderId provides sufficient security.
  // The returnRequestId is a cryptographically random cuid (not guessable from orderId alone),
  // which prevents enumeration attacks. An attacker would need to know all three values:
  // the unguessable cuid, the customer's email, AND the order ID.
  if (!id || !email || !orderId) {
    throw new Response("Missing required parameters", { status: 400 });
  }

  const returnRequest = await getReturnRequestByIdAndEmail(id, email);

  if (!returnRequest) {
    throw new Response("Return request not found", { status: 404 });
  }

  // Verify order ID matches (case-insensitive for user convenience)
  if (returnRequest.shopifyOrderId?.toLowerCase() !== orderId.toLowerCase()) {
    throw new Response("Invalid credentials", { status: 403 });
  }

  // Bug #241 Fix: Include shop in loader response
  return json({
    returnRequest,
    shop: returnRequest.shop
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const email = formData.get("email") as string;
  const orderId = formData.get("orderId") as string;

  if (!id || !email || !orderId) {
    return json({ error: "Missing required parameters" }, { status: 400 });
  }

  if (intent === "accept-disclaimer") {
    // Import prisma and the timeline helper
    const prisma = (await import("~/db.server")).default;
    const { addTimelineEvent } = await import("~/models/returnTimeline.server");

    // Verify ownership (same auth as loader)
    const { getReturnRequestByIdAndEmail } = await import("~/models/returnRequest.server");
    const returnRequest = await getReturnRequestByIdAndEmail(id, email);

    if (!returnRequest || returnRequest.shopifyOrderId?.toLowerCase() !== orderId.toLowerCase()) {
      return json({ error: "Invalid credentials" }, { status: 403 });
    }

    // Prevent re-acceptance (irrevocable - already accepted)
    if (returnRequest.disclaimerAcceptedAt) {
      return json({ success: true, alreadyAccepted: true });
    }

    // Only allow acceptance if shipping eligibility is required
    if (!returnRequest.requiresShoppingEligibility) {
      return json({ error: "Disclaimer not required for this return" }, { status: 400 });
    }

    // Record the acceptance timestamp
    const now = new Date();
    await prisma.returnRequest.update({
      where: { id },
      data: { disclaimerAcceptedAt: now },
    });

    // Add timeline event
    await addTimelineEvent({
      returnRequestId: id,
      event: "Customer accepted shipping eligibility disclaimer",
      actor: returnRequest.customerName || email,
      actorType: "CUSTOMER",
      details: { acceptedAt: now.toISOString() },
      shop: returnRequest.shop,
    });

    // Send webhook notification for disclaimer acceptance (fire-and-forget)
    const { sendWebhookNotification } = await import("~/services/webhook.server");
    sendWebhookNotification(returnRequest.shop, "disclaimer.accepted", id, {
      acceptedAt: now.toISOString(),
    }).catch(() => {});

    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function ReturnStatus() {
  const { returnRequest, shop } = useLoaderData<typeof loader>();
  const { t, formatDate } = useTranslation();
  const fetcher = useFetcher();
  const isAccepting = fetcher.state === "submitting";
  const status = returnRequest.status as ReturnStatusType;
  const progress = STATUS_PROGRESS[status];
  const statusLabel = t(`portal.statusLabel.${status}`);

  const isTerminal = status === "CLOSED" || status === "CANCELLED" || status === "REJECTED";
  const isNegative = status === "REJECTED" || status === "CANCELLED";

  return (
    <div>
      {/* Bug #260 Fix: Update back navigation URL */}
      <div className="mb-4">
        <a
          href={`/returns/order?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(returnRequest.customerEmail)}${returnRequest.shopifyOrderId ? `&orderId=${encodeURIComponent(returnRequest.shopifyOrderId)}` : ""}`}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          &larr; {t("portal.status.backToOrder")}
        </a>
      </div>
      <div className="portal-card mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {t("portal.status.title")}
          </h2>
          <span className="text-sm text-gray-500">
            {t("portal.status.orderLabel", { orderName: returnRequest.shopifyOrderName })}
          </span>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              isNegative
                ? "bg-red-100 text-red-800"
                : isTerminal
                  ? "bg-gray-100 text-gray-800"
                  : "bg-brand-100 text-brand-800"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Progress bar */}
        {!isNegative && (
          <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
            <div
              className="bg-brand-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Status message */}
        <p className="text-sm text-gray-600 mt-3">
          {t(`portal.status.msg.${status}`)}
        </p>
      </div>

      {/* Shipping Eligibility Disclaimer */}
      {returnRequest.requiresShoppingEligibility && (
        <div className="portal-card mb-4">
          {!returnRequest.disclaimerAcceptedAt ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <h3 className="font-semibold text-gray-900">
                  {t("portal.disclaimer.shoppingEligibility.title")}
                </h3>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {t("portal.disclaimer.shoppingEligibility.body")}
                </p>
              </div>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="accept-disclaimer" />
                <input type="hidden" name="email" value={returnRequest.customerEmail} />
                <input type="hidden" name="orderId" value={returnRequest.shopifyOrderId || ""} />
                <button
                  type="submit"
                  disabled={isAccepting}
                  className="w-full py-3 px-4 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand-500, #0284c7)" }}
                >
                  {isAccepting
                    ? t("portal.disclaimer.shoppingEligibility.accepting")
                    : t("portal.disclaimer.shoppingEligibility.accept")}
                </button>
              </fetcher.Form>
            </>
          ) : (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg p-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm">
                {t("portal.disclaimer.shoppingEligibility.accepted", {
                  date: formatDate(returnRequest.disclaimerAcceptedAt, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <div className="portal-card mb-4">
        <h3 className="font-medium text-gray-900 mb-3">{t("portal.status.itemsTitle")}</h3>
        <div className="divide-y divide-gray-100">
          {returnRequest.items.map((item) => (
            <div key={item.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.productTitle}</p>
                  {item.variantTitle && (
                    <p className="text-xs text-gray-500">{item.variantTitle}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {t("portal.status.qty", { quantity: item.quantity })} &middot;{" "}
                    {RETURN_REASONS[item.returnReason as keyof typeof RETURN_REASONS]?.label ||
                      item.returnReason.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}
                  </p>
                </div>
              </div>
              {item.customerNote && (
                <p className="text-xs text-gray-500 mt-1 italic">"{item.customerNote}"</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {returnRequest.timeline.length > 0 && (
        <div className="portal-card mb-4">
          <h3 className="font-medium text-gray-900 mb-3">{t("portal.status.timelineTitle")}</h3>
          <div className="space-y-3">
            {returnRequest.timeline.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-900">{event.event}</p>
                  <p className="text-xs text-gray-500">
                    {formatDate(event.createdAt, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments visible to customer */}
      {(() => {
        const visibleComments = returnRequest.comments.filter(comment => !comment.isInternal);
        return visibleComments.length > 0 && (
          <div className="portal-card mb-4">
            <h3 className="font-medium text-gray-900 mb-3">{t("portal.status.messagesTitle")}</h3>
            <div className="space-y-3">
              {visibleComments.map((comment) => (
                <div key={comment.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-medium text-gray-700">
                      {comment.authorType === "CUSTOMER" ? t("portal.status.you") : t("portal.status.supportTeam")}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(comment.createdAt, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{comment.content}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="text-center">
        <p className="text-sm text-gray-500">
          {t("portal.status.requestId", { id: returnRequest.id })}
        </p>
      </div>
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary } from "~/components/portal/ErrorBoundary";
