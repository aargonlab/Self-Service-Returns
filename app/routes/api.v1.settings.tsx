import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiInternalError, handleCors } from "~/services/api.auth.server";
import { getSettings } from "~/models/returnSettings.server";

/**
 * @route GET /api/v1/settings
 * @description Get return settings for the shop (read-only).
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope settings:read
 *
 * @returns {object} 200 — `{ settings: { returnWindowDays, allowedReasons, returnInstructions, autoApprove, enableReplacement, enableSerialNumbers } }`
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "..." } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "..." } }`
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shopDomain = request.headers.get("X-Shop-Domain") || undefined;
  const requestOrigin = request.headers.get("Origin") || undefined;
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const ctx = await authenticateApiRequest(request, ["settings:read"]);
    const settings = await getSettings(ctx.shop);
    return apiSuccess({ settings }, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API get settings error:", error);
    return apiInternalError("An unexpected error occurred", shopDomain, requestOrigin);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  return new Response(
    JSON.stringify({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Settings API is read-only. Settings can only be modified through the admin panel.",
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "GET",
      },
    },
  );
};
