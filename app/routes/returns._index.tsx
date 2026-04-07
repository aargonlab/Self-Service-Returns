import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import { orderLookupSchema } from "~/utils/validators";
import { lookupOrderForPortal } from "~/services/shopifyPortal.server";
import { useTranslation } from "~/utils/useTranslation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const redirectError = url.searchParams.get("error");
  if (!shop) {
    return json({ error: "Shop parameter is required. Please use the return link provided by the store." });
  }
  return json({ shop, redirectError });
};

// NOTE: Order lookup is rate-limited by Shopify's app proxy rate limits (2 requests/second).
// Additional application-level rate limiting may be needed for high-traffic stores.
export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const raw = {
    orderName: formData.get("orderName") as string,
    email: formData.get("email") as string,
    shop: formData.get("shop") as string,
  };

  if (!raw.shop) {
    return json(
      {
        errors: { shop: ["Shop parameter is missing. Please use the return link provided by the store."] },
        values: raw,
      },
      { status: 400 },
    );
  }

  const parsed = orderLookupSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { errors: parsed.error.flatten().fieldErrors, values: raw },
      { status: 400 },
    );
  }

  const { orderName, email, shop } = parsed.data;

  try {
    const order = await lookupOrderForPortal(shop, orderName, email);

    if (!order) {
      return json(
        {
          errors: { orderName: ["Order not found. Please check your order number and email."] },
          values: raw,
        },
        { status: 404 },
      );
    }

    const params = new URLSearchParams({
      shop,
      orderId: order.id,
      email,
    });

    return redirect(`/returns/order?${params.toString()}`);
  } catch (error) {
    console.error("Order lookup error:", error instanceof Error ? error.message : error);
    return json(
      {
        errors: { orderName: ["Something went wrong. Please try again."] },
        values: raw,
      },
      { status: 500 },
    );
  }
};

export default function ReturnsIndex() {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const shop = ("shop" in loaderData ? loaderData.shop : "") || "";
  const redirectError = ("redirectError" in loaderData ? (loaderData as any).redirectError : null) as string | null;

  // useEffect runs client-side only — window is always available here
  useEffect(() => {
    if (redirectError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [redirectError]);

  if ("error" in loaderData && !shop) {
    return (
      <div className="portal-card text-center">
        <div className="text-4xl mb-4">&#9888;</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {t("portal.lookup.invalidLink")}
        </h2>
        <p className="text-sm text-gray-600">
          {(loaderData as any).error}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="portal-card">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {t("portal.lookup.title")}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {t("portal.lookup.subtitle")}
        </p>

        {redirectError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700 font-medium">{redirectError}</p>
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="shop" value={shop} />
          <div className="space-y-4">
            {(actionData as any)?.errors && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 font-medium">
                  {(actionData as any).errors.shop?.[0] ||
                    (actionData as any).errors.orderName?.[0] ||
                    (actionData as any).errors.email?.[0] ||
                    "Something went wrong. Please try again."}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="orderName" className="portal-label">
                {t("portal.lookup.orderNumber")}
              </label>
              <input
                type="text"
                id="orderName"
                name="orderName"
                placeholder="#1001"
                autoFocus
                maxLength={50}
                defaultValue={(actionData as any)?.values?.orderName || ""}
                className="portal-input"
                required
              />
              {(actionData as any)?.errors?.orderName && (
                <p className="mt-1 text-sm text-red-600">
                  {(actionData as any).errors.orderName[0]}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="portal-label">
                {t("portal.lookup.email")}
              </label>
              <input
                type="email"
                id="email"
                name="email"
                placeholder="you@example.com"
                maxLength={255}
                defaultValue={(actionData as any)?.values?.email || ""}
                className="portal-input"
                required
              />
              {(actionData as any)?.errors?.email && (
                <p className="mt-1 text-sm text-red-600">
                  {(actionData as any).errors.email[0]}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="portal-button-primary w-full"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                  {t("portal.lookup.submitting")}
                </span>
              ) : t("portal.lookup.submit")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}

export { PortalErrorBoundary as ErrorBoundary } from "~/components/portal/ErrorBoundary";
