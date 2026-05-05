import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiNotFound, apiBadRequest, apiInternalError, handleCors, verifyReturnOwnership } from "~/services/api.auth.server";
import { getReturnRequest, getReturnRequestByShopifyId } from "~/models/returnRequest.server";

/**
 * @route GET /api/v1/returns/:id
 * @description Get detailed information for a single return request.
 *   The :id parameter accepts:
 *   - Internal return ID (CUID format, e.g., `clx123abc...`)
 *   - Shopify return GID (e.g., `gid://shopify/Return/123456789`)
 *   - Shopify return numeric ID (e.g., `123456789` — auto-expanded to full GID)
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope returns:read
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const shopDomain = request.headers.get("X-Shop-Domain") || undefined;
  const requestOrigin = request.headers.get("Origin") || undefined;

  try {
    const ctx = await authenticateApiRequest(request, ["returns:read"]);
    const idParam = params.id!;

    if (!idParam || !idParam.trim()) {
      return apiBadRequest("Return ID is required", undefined, shopDomain, requestOrigin);
    }

    let returnRequest;

    // Detect if this is a Shopify return ID
    if (idParam.startsWith("gid://shopify/Return/")) {
      // Full Shopify GID format
      returnRequest = await getReturnRequestByShopifyId(idParam, ctx.shop);
    } else if (/^\d+$/.test(idParam)) {
      // Numeric-only ID — expand to full Shopify GID
      const shopifyGid = `gid://shopify/Return/${idParam}`;
      returnRequest = await getReturnRequestByShopifyId(shopifyGid, ctx.shop);
    } else if (/^c[a-z0-9]{20,}$/i.test(idParam)) {
      // Internal CUID format
      const isOwner = await verifyReturnOwnership(idParam, ctx.shop);
      if (!isOwner) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);
      returnRequest = await getReturnRequest(idParam, ctx.shop);
    } else {
      return apiBadRequest(
        "Invalid return ID format. Accepted formats: internal ID (CUID), Shopify GID (gid://shopify/Return/...), or Shopify numeric ID",
        undefined,
        shopDomain,
        requestOrigin,
      );
    }

    if (!returnRequest) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

    // Filter out internal comments for API consumers
    // Add label download URL so consumers can fetch the full label file separately
    const filtered = {
      ...returnRequest,
      comments: returnRequest.comments.filter((c: any) => !c.isInternal),
      shippingLabel: returnRequest.shippingLabel
        ? {
            ...returnRequest.shippingLabel,
            labelDownloadUrl: `/api/v1/returns/${returnRequest.id}/label`,
          }
        : null,
    };

    return apiSuccess(filtered, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API get return error:", error);
    return apiInternalError("Failed to retrieve return request", shopDomain, requestOrigin);
  }
};
