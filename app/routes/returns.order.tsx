import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { getOrderForPortal } from "~/services/shopifyPortal.server";
import { checkReturnEligibility } from "~/services/shopify.server";
import { getSettings } from "~/models/returnSettings.server";
import { findReturnRequestsByOrderAndEmail } from "~/models/returnRequest.server";
import { evaluatePolicies } from "~/services/policyEngine.server";
import { getMarketFromOrder, fetchMarketsForShop } from "~/services/shopifyMarkets.server";
import { CUSTOMER_FACING_STATUSES, STATUS_PROGRESS } from "~/utils/constants";
import type { ReturnStatus } from "@prisma/client";
import { useTranslation } from "~/utils/useTranslation";

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
    return redirect(
      `/returns?shop=${encodeURIComponent(shop)}&error=${encodeURIComponent("Order not found.")}`,
    );
  }

  // Get existing return requests for this order + email
  const existingReturns = await findReturnRequestsByOrderAndEmail(shop, orderId, email);

  // Check if new return is possible
  const settings = await getSettings(shop);
  const markets = await fetchMarketsForShop(shop);
  const marketId = getMarketFromOrder(order, markets);

  let canCreateNew = false;
  let eligibleItemCount = 0;
  let eligibilityError = false;
  let eligibilityErrorMessage = "";
  try {
    const eligibility = await checkReturnEligibility(
      { graphql: async () => { throw new Error("not used"); } } as any,
      order,
      settings,
      shop,
      marketId,
    );

    if (eligibility.eligible && eligibility.eligibleItems.length > 0) {
      const policyEval = await evaluatePolicies(shop, order, settings);
      const filtered = eligibility.eligibleItems.filter(
        (item) => !policyEval.excludedItems.includes(item.lineItemId),
      );
      eligibleItemCount = filtered.length;
      canCreateNew = policyEval.eligible && filtered.length > 0;
    }
  } catch (err) {
    // Log the error and flag as system error
    console.error(`[Eligibility] Failed to check return eligibility for order ${orderId}, shop ${shop}:`, err);
    eligibilityError = true;
    // Distinguish transient errors from permanent ones
    const isTransient = err instanceof Error &&
      (err.message.includes("timeout") || err.message.includes("ECONNREFUSED") || err.message.includes("fetch"));
    eligibilityErrorMessage = isTransient
      ? "Unable to check eligibility right now. Please try again in a few moments."
      : "Unable to check return eligibility for this order. Please contact support.";
  }

  return json({
    shop,
    orderId,
    email,
    orderName: order.name,
    customerName: order.customer
      ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
      : email,
    existingReturns: existingReturns.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      resolutionType: r.resolutionType,
      itemCount: r.items.length,
      items: r.items.map((item) => ({
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        quantity: item.quantity,
        imageUrl: item.imageUrl,
      })),
    })),
    canCreateNew,
    eligibleItemCount,
    eligibilityError,
    eligibilityErrorMessage,
  });
};

export default function OrderHub() {
  const { t, formatDate } = useTranslation();
  const {
    shop, orderId, email, orderName, customerName,
    existingReturns, canCreateNew, eligibleItemCount, eligibilityError, eligibilityErrorMessage,
  } = useLoaderData<typeof loader>();

  const newReturnParams = new URLSearchParams({ shop, orderId, email });

  return (
    <div>
      <div className="mb-4">
        <a
          href={`/returns?shop=${encodeURIComponent(shop)}`}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          &larr; {t("portal.order.backToLookup")}
        </a>
      </div>

      <div className="portal-card mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {t("portal.order.title", { orderName })}
            </h2>
            <p className="text-sm text-gray-600">{customerName}</p>
          </div>
          {canCreateNew && (
            <a
              href={`/returns/new?${newReturnParams.toString()}`}
              className="portal-button-primary text-sm"
            >
              {t("portal.order.startNewReturn")}
            </a>
          )}
        </div>
      </div>

      {existingReturns.length > 0 && (
        <div className="space-y-3 mb-4">
          <h3 className="text-sm font-medium text-gray-700">
            {t("portal.order.yourReturns")}
          </h3>
          {existingReturns.map((ret) => {
            const status = ret.status as ReturnStatus;
            const statusLabel = t(`portal.statusLabel.${status}`) || CUSTOMER_FACING_STATUSES[status] || ret.status;
            const progress = STATUS_PROGRESS[status] || 0;
            const isTerminal = status === "CLOSED" || status === "CANCELLED" || status === "REJECTED";
            const isNegative = status === "REJECTED" || status === "CANCELLED";
            const isComplete = status === "CLOSED" || status === "REFUNDED" || status === "EXCHANGED";

            return (
              <Link
                key={ret.id}
                to={`/returns/${ret.id}/status?shop=${encodeURIComponent(shop)}&email=${encodeURIComponent(email)}&orderId=${encodeURIComponent(orderId)}`}
                className="portal-card block hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isNegative
                          ? "bg-red-100 text-red-800"
                          : isComplete
                            ? "bg-green-100 text-green-800"
                            : isTerminal
                              ? "bg-gray-100 text-gray-800"
                              : "bg-brand-100 text-brand-800"
                      }`}
                    >
                      {statusLabel}
                    </span>
                    {ret.resolutionType === "EXCHANGE" && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {t("portal.order.replacement")}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {formatDate(ret.createdAt)}
                  </span>
                </div>

                {/* Mini progress bar */}
                {!isNegative && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-3">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        isComplete ? "bg-green-500" : "bg-brand-500"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}

                {/* Items summary */}
                <div className="flex items-center gap-3">
                  {ret.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.productTitle}
                          className="w-10 h-10 object-cover rounded border border-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border border-gray-200 bg-gray-100 flex items-center justify-center text-gray-400 text-xs font-semibold">
                          {item.productTitle.charAt(0)}
                        </div>
                      )}
                    </div>
                  ))}
                  {ret.items.length > 3 && (
                    <span className="text-xs text-gray-500">
                      {t("portal.order.moreItems", { count: ret.items.length - 3 })}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-500">
                    {ret.itemCount !== 1
                      ? t("portal.order.itemCountPlural", { count: ret.itemCount })
                      : t("portal.order.itemCount", { count: ret.itemCount })}
                  </span>
                </div>

                <div className="mt-2 text-xs text-brand-600 font-medium">
                  {t("portal.order.viewDetails")} &rarr;
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {existingReturns.length === 0 && !canCreateNew && !eligibilityError && (
        <div className="portal-card text-center">
          <p className="text-gray-600 font-medium">{t("portal.order.noReturnsNotEligible")}</p>
          <p className="text-sm text-gray-500 mt-1">
            {t("portal.order.notEligibleMessage")}
          </p>
        </div>
      )}

      {eligibilityError && (
        <div className="portal-card text-center">
          <p className="text-gray-600 font-medium">{t("portal.order.eligibilityError")}</p>
          <p className="text-sm text-gray-500 mt-1">
            {eligibilityErrorMessage || t("portal.order.eligibilityErrorMessage")}
          </p>
        </div>
      )}

      {existingReturns.length === 0 && canCreateNew && (
        <div className="portal-card text-center">
          <p className="text-gray-600 mb-3">
            {t("portal.order.noReturnsYet")}
          </p>
          <a
            href={`/returns/new?${newReturnParams.toString()}`}
            className="portal-button-primary inline-block"
          >
            {eligibleItemCount !== 1
              ? t("portal.order.startReturnPlural", { count: eligibleItemCount })
              : t("portal.order.startReturn", { count: eligibleItemCount })}
          </a>
        </div>
      )}

      {canCreateNew && existingReturns.length > 0 && (
        <div className="text-center">
          <p className="text-sm text-gray-500">
            {eligibleItemCount !== 1
              ? t("portal.order.stillEligiblePlural", { count: eligibleItemCount })
              : t("portal.order.stillEligible", { count: eligibleItemCount })}
          </p>
        </div>
      )}
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary } from "~/components/portal/ErrorBoundary";
