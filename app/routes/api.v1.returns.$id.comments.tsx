import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiNotFound, apiBadRequest, apiInternalError, handleCors } from "~/services/api.auth.server";
import { addCommentAction } from "~/services/returnActions.server";
import { resolveReturnId } from "~/models/returnRequest.server";
import prisma from "~/db.server";

/**
 * @route GET /api/v1/returns/:id/comments
 * @description List comments on a return request. By default, only non-internal comments are returned.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope returns:read
 *
 * @pathparam {string} id — The return request ID (cuid format).
 *
 * @queryparam {string} [includeInternal] — Set to "true" to include internal notes. Default is false (only public comments).
 *
 * @returns {object} 200 — `{ comments: Comment[] }` — Array of comment objects ordered by creation date (ascending).
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 404 — `{ error: { code: "NOT_FOUND", message: "Return not found" } }` — Return does not exist or does not belong to this shop.
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`
 *
 * @example
 * // Request
 * curl -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/comments?includeInternal=true"
 *
 * // Response
 * {
 *   "comments": [
 *     {
 *       "id": "...",
 *       "content": "Customer requested expedited processing",
 *       "isInternal": false,
 *       "author": "API",
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

    const url = new URL(request.url);
    const includeInternal = url.searchParams.get("includeInternal") === "true";

    const comments = await prisma.returnComment.findMany({
      where: {
        returnRequestId: resolvedId,
        ...(includeInternal ? {} : { isInternal: false }),
      },
      orderBy: { createdAt: "asc" },
    });

    return apiSuccess({ comments }, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API get comments error:", error);
    return apiInternalError("Internal server error", shop, origin);
  }
};

const MAX_COMMENT_LENGTH = 5000;

/**
 * @route POST /api/v1/returns/:id/comments
 * @description Add a comment to a return request. Comments can be marked as internal (visible only to staff) or public.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @header Content-Type — application/json
 * @scope returns:write
 *
 * @pathparam {string} id — The return request ID (cuid format).
 *
 * @bodyparam {string} content — The comment text content (required). Max 5000 characters.
 * @bodyparam {boolean} [isInternal=false] — Whether this is an internal note (not visible to customers).
 * @bodyparam {string} [author=API] — The author name. Defaults to "API".
 *
 * @returns {object} 201 — `{ success: true, comment: {...} }` — Comment created successfully.
 * @returns {object} 400 — `{ error: { code: "BAD_REQUEST", message: "..." } }` — Invalid JSON, missing content, or content exceeds max length.
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 404 — `{ error: { code: "NOT_FOUND", message: "Return not found" } }` — Return does not exist or does not belong to this shop.
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`
 *
 * @example
 * // Request
 * curl -X POST \
 *      -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      -H "Content-Type: application/json" \
 *      -d '{"content": "Customer called to confirm shipping address", "isInternal": true, "author": "Support Agent"}' \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/comments"
 *
 * // Response
 * {
 *   "success": true,
 *   "comment": {
 *     "id": "...",
 *     "content": "Customer called to confirm shipping address",
 *     "isInternal": true,
 *     "author": "Support Agent",
 *     "createdAt": "2026-03-11T10:00:00.000Z"
 *   }
 * }
 */
export const action = async ({ params, request }: ActionFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const ctx = await authenticateApiRequest(request, ["returns:write"]);
    const returnId = params.id!;

    const resolvedId = await resolveReturnId(returnId, ctx.shop);
    if (!resolvedId) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return apiBadRequest("Request body must be valid JSON", undefined, ctx.shop, ctx.requestOrigin);
    }

    if (!body.content?.trim()) {
      return apiBadRequest("'content' is required", undefined, ctx.shop, ctx.requestOrigin);
    }

    const content = body.content.trim();

    // Validate content length
    if (content.length > MAX_COMMENT_LENGTH) {
      return apiBadRequest(
        `Comment content must not exceed ${MAX_COMMENT_LENGTH} characters`,
        { currentLength: content.length, maxLength: MAX_COMMENT_LENGTH },
        ctx.shop,
        ctx.requestOrigin
      );
    }

    const actor = {
      name: body.author || "API",
      type: "AGENT" as const,
    };

    const result = await addCommentAction(
      resolvedId,
      content,
      body.isInternal === true,
      ctx.shop,
      actor,
    );

    if (!result.success) return apiBadRequest(result.message, undefined, ctx.shop, ctx.requestOrigin);
    return apiSuccess(result, 201, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API add comment error:", error);
    const shop = request.headers.get("X-Shop-Domain") ?? undefined;
    const origin = request.headers.get("Origin") ?? undefined;
    return apiInternalError("Internal server error", shop, origin);
  }
};
