import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiNotFound, apiInternalError, apiBadRequest, handleCors } from "~/services/api.auth.server";
import { getShippingLabel, uploadManualLabel, updateManualLabel } from "~/services/shippingLabel.server";
import { resolveReturnId } from "~/models/returnRequest.server";

/**
 * @route GET /api/v1/returns/:id/label
 * @description Get the shipping label for a return request. Includes carrier information, tracking details, and label URL.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope returns:read
 *
 * @pathparam {string} id — The return request ID (cuid format).
 *
 * @returns {object} 200 — `{ label: { carrier: string, trackingNumber: string, trackingUrl: string, labelUrl: string, barcode: string } }`
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 404 — `{ error: { code: "NOT_FOUND", message: "Return not found" } }` — Return does not exist, does not belong to this shop, or no shipping label found.
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`
 *
 * @example
 * // Request
 * curl -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/label"
 *
 * // Response
 * {
 *   "label": {
 *     "carrier": "UPS",
 *     "trackingNumber": "1Z999AA10123456784",
 *     "trackingUrl": "https://wwwapps.ups.com/tracking/...",
 *     "labelUrl": "https://example.com/labels/...",
 *     "barcode": "..."
 *   }
 * }
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const shop = request.headers.get("X-Shop-Domain") ?? undefined;
  const origin = request.headers.get("Origin") ?? undefined;

  try {
    const ctx = await authenticateApiRequest(request, ["returns:read"]);
    const returnId = params.id!;

    const resolvedId = await resolveReturnId(returnId, ctx.shop);
    if (!resolvedId) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

    const label = await getShippingLabel(resolvedId, ctx.shop);
    if (!label) return apiNotFound("No shipping label found for this return", ctx.shop, ctx.requestOrigin);

    return apiSuccess({ label }, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API get label error:", error);
    return apiInternalError("Internal server error", shop, origin);
  }
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const shop = request.headers.get("X-Shop-Domain") ?? undefined;
  const origin = request.headers.get("Origin") ?? undefined;

  try {
    const method = request.method.toUpperCase();

    if (method === "POST") {
      // Upload a new manual label
      const ctx = await authenticateApiRequest(request, ["returns:write"]);
      const returnId = params.id!;

      const resolvedId = await resolveReturnId(returnId, ctx.shop);
      if (!resolvedId) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

      const body = await request.json();
      if (!body.carrier || !body.trackingNumber || !body.labelFileBase64 || !body.labelContentType) {
        return apiBadRequest("Missing required fields: carrier, trackingNumber, labelFileBase64, labelContentType", undefined, ctx.shop, ctx.requestOrigin);
      }

      const result = await uploadManualLabel({
        returnRequestId: resolvedId,
        shop: ctx.shop,
        carrier: body.carrier,
        trackingNumber: body.trackingNumber,
        trackingUrl: body.trackingUrl || undefined,
        labelFileBase64: body.labelFileBase64,
        labelContentType: body.labelContentType,
        labelFileName: body.labelFileName || "label",
      });

      return apiSuccess({ label: result }, 201, ctx.shop, ctx.requestOrigin);
    }

    if (method === "PATCH") {
      // Update tracking info on existing label
      const ctx = await authenticateApiRequest(request, ["returns:write"]);
      const returnId = params.id!;

      const resolvedId = await resolveReturnId(returnId, ctx.shop);
      if (!resolvedId) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

      const body = await request.json();
      const result = await updateManualLabel({
        returnRequestId: resolvedId,
        shop: ctx.shop,
        carrier: body.carrier || undefined,
        trackingNumber: body.trackingNumber || undefined,
        trackingUrl: body.trackingUrl,
      });

      return apiSuccess(result, 200, ctx.shop, ctx.requestOrigin);
    }

    return apiBadRequest("Method not allowed", undefined, shop, origin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API label action error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return apiInternalError(message, shop, origin);
  }
};
