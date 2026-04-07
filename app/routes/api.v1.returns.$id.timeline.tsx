import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiNotFound, apiInternalError, handleCors } from "~/services/api.auth.server";
import { resolveReturnId } from "~/models/returnRequest.server";
import prisma from "~/db.server";

/**
 * @route GET /api/v1/returns/:id/timeline
 * @description Get timeline events for a return request. Timeline events track all state changes and significant actions.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope returns:read
 *
 * @pathparam {string} id — The return request ID (cuid format).
 *
 * @returns {object} 200 — `{ timeline: TimelineEvent[] }` — Array of timeline events ordered by creation date (descending, most recent first).
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 404 — `{ error: { code: "NOT_FOUND", message: "Return not found" } }` — Return does not exist or does not belong to this shop.
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`
 *
 * @example
 * // Request
 * curl -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/timeline"
 *
 * // Response
 * {
 *   "timeline": [
 *     {
 *       "id": "...",
 *       "event": "Return approved",
 *       "actor": "John Doe",
 *       "actorType": "AGENT",
 *       "createdAt": "2026-03-11T12:00:00.000Z"
 *     },
 *     {
 *       "id": "...",
 *       "event": "Return submitted",
 *       "actor": "Customer",
 *       "actorType": "CUSTOMER",
 *       "createdAt": "2026-03-11T10:00:00.000Z"
 *     }
 *   ]
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

    const timeline = await prisma.returnTimeline.findMany({
      where: { returnRequestId: resolvedId },
      orderBy: { createdAt: "desc" },
    });

    return apiSuccess({ timeline }, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API get timeline error:", error);
    return apiInternalError("Internal server error", shop, origin);
  }
};
