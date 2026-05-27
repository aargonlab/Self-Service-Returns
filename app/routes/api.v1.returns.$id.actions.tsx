import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateApiRequest, apiSuccess, apiBadRequest, apiNotFound, apiConflict, apiInternalError, handleCors } from "~/services/api.auth.server";
import {
  approveReturn,
  rejectReturn,
  cancelReturn,
  processRefundAction,
  processReplacementAction,
  transitionStatusAction,
} from "~/services/returnActions.server";
import { resolveReturnId, getReturnRequest } from "~/models/returnRequest.server";
import { InvalidTransitionError } from "~/services/stateMachine.server";

const VALID_ACTIONS = [
  "approve",
  "reject",
  "cancel",
  "process_refund",
  "process_replacement",
  "transition",
  "skip_shipping",
] as const;

type ValidAction = typeof VALID_ACTIONS[number];

const MAX_TEXT_FIELD_LENGTH = 2000;

/**
 * @route GET /api/v1/returns/:id/actions
 * @description Not supported. This endpoint requires POST method.
 * @authentication Required — Bearer token via `Authorization` header.
 *
 * @returns {object} 400 — `{ error: { code: "BAD_REQUEST", message: "Use POST to execute actions" } }`
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shopDomain = request.headers.get("X-Shop-Domain") || undefined;
  const requestOrigin = request.headers.get("Origin") || undefined;
  const corsResponse = handleCors(request, shopDomain);
  if (corsResponse) return corsResponse;
  return apiBadRequest("Use POST to execute actions", undefined, shopDomain, requestOrigin);
};

/**
 * @route POST /api/v1/returns/:id/actions
 * @description Execute an action on a return request. Supports approval, rejection, cancellation, refunds, replacement, and status transitions.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @header Content-Type — application/json
 * @scope returns:write
 *
 * @pathparam {string} id — The return request ID (cuid format).
 *
 * @bodyparam {string} action — Action to execute. Valid values: `approve`, `reject`, `cancel`, `process_refund`, `process_replacement`, `transition` (required).
 * @bodyparam {string} [reason] — Reason for the action. Required for `reject` action. Max 2000 characters.
 * @bodyparam {string} [notes] — Additional notes. Optional for `process_replacement`. Max 2000 characters.
 * @bodyparam {string} [status] — Target status. Required for `transition` action. Must be a valid ReturnStatus enum value.
 * @bodyparam {string} [actor=API] — Name of the actor performing the action. Defaults to "API". Max 100 characters.
 *
 * @returns {object} 200 — `{ success: true, message: "...", returnRequest: {...} }` — Action executed successfully.
 * @returns {object} 400 — `{ error: { code: "BAD_REQUEST", message: "..." } }` — Invalid JSON, missing required fields, invalid action name, or validation error.
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 404 — `{ error: { code: "NOT_FOUND", message: "Return not found" } }` — Return does not exist or does not belong to this shop.
 * @returns {object} 405 — `{ error: "Method not allowed. Use POST." }` — Non-POST method used.
 * @returns {object} 409 — `{ error: { code: "CONFLICT", message: "Action cannot be performed in current state" } }` — Invalid state transition.
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Failed to process action. Please try again or contact support." } }`
 *
 * @example
 * // Request: Approve a return
 * curl -X POST \
 *      -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      -H "Content-Type: application/json" \
 *      -d '{"action": "approve", "actor": "John Doe"}' \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/actions"
 *
 * // Request: Reject a return
 * curl -X POST \
 *      -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      -H "Content-Type: application/json" \
 *      -d '{"action": "reject", "reason": "Items do not meet return criteria"}' \
 *      "https://app.example.com/api/v1/returns/c1234567890abcdefghij/actions"
 *
 * // Response
 * {
 *   "success": true,
 *   "message": "Return approved successfully",
 *   "returnRequest": {...}
 * }
 */
export const action = async ({ params, request }: ActionFunctionArgs) => {
  const shopDomain = request.headers.get("X-Shop-Domain") || undefined;
  const requestOrigin = request.headers.get("Origin") || undefined;
  const corsResponse = handleCors(request, shopDomain);
  if (corsResponse) return corsResponse;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Allow": "POST" },
    });
  }

  try {
    const ctx = await authenticateApiRequest(request, ["returns:write"]);
    const returnId = params.id!;

    const resolvedId = await resolveReturnId(returnId, ctx.shop);
    if (!resolvedId) return apiNotFound("Return not found", ctx.shop, ctx.requestOrigin);

    // After resolveReturnId, verify the return belongs to this shop
    const returnRequest = await getReturnRequest(resolvedId, ctx.shop);
    if (!returnRequest) {
      return apiNotFound("Return not found or does not belong to this shop.", ctx.shop, ctx.requestOrigin);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return apiBadRequest("Invalid JSON body", undefined, ctx.shop, ctx.requestOrigin);
    }

    const actionName = typeof body.action === "string" ? body.action : "";
    if (!actionName) {
      return apiBadRequest("'action' field is required and must be a string", undefined, ctx.shop, ctx.requestOrigin);
    }

    // Validate action against whitelist
    if (!VALID_ACTIONS.includes(actionName as ValidAction)) {
      return apiBadRequest(
        `Invalid action: '${actionName}'. Valid actions: ${VALID_ACTIONS.join(", ")}`,
        undefined,
        ctx.shop,
        ctx.requestOrigin
      );
    }

    // Validate text field lengths
    if (body.reason && typeof body.reason === "string" && body.reason.length > MAX_TEXT_FIELD_LENGTH) {
      return apiBadRequest(
        `'reason' field must not exceed ${MAX_TEXT_FIELD_LENGTH} characters`,
        { currentLength: body.reason.length, maxLength: MAX_TEXT_FIELD_LENGTH },
        ctx.shop,
        ctx.requestOrigin
      );
    }

    if (body.notes && typeof body.notes === "string" && body.notes.length > MAX_TEXT_FIELD_LENGTH) {
      return apiBadRequest(
        `'notes' field must not exceed ${MAX_TEXT_FIELD_LENGTH} characters`,
        { currentLength: body.notes.length, maxLength: MAX_TEXT_FIELD_LENGTH },
        ctx.shop,
        ctx.requestOrigin
      );
    }

    const actorName = typeof body.actor === "string" ? body.actor.slice(0, 100).trim() || "API" : "API";
    const actor = { name: actorName, type: "AGENT" as const };

    let result;

    try {
      switch (actionName) {
        case "approve":
          result = await approveReturn(ctx.admin, resolvedId, ctx.shop, actor);
          break;
        case "reject":
          if (!body.reason) return apiBadRequest("'reason' is required for reject action", undefined, ctx.shop, ctx.requestOrigin);
          result = await rejectReturn(resolvedId, ctx.shop, body.reason, actor);
          break;
        case "cancel":
          result = await cancelReturn(ctx.admin, resolvedId, ctx.shop, actor);
          break;
        case "process_refund": {
          // Note: process_refund via API does not require OTP verification.
          // API keys are high-trust credentials with explicit scopes.
          // OTP is only required for interactive admin UI sessions.
          //
          // Unlike the admin UI, the API allows skipping the physical-return
          // path (IN_TRANSIT → RECEIVED) when the ERP signals that a refund
          // should be emitted earlier. We enable `force` automatically when
          // the return is in any post-approval state — never accept a force
          // flag from the request body, the decision is server-side only.
          const FORCE_FROM: ReadonlyArray<typeof returnRequest.status> = [
            "APPROVED",
            "AWAITING_SHIPMENT",
            "IN_TRANSIT",
          ];
          const force = FORCE_FROM.includes(returnRequest.status);
          result = await processRefundAction(ctx.admin, resolvedId, ctx.shop, actor, { force });
          break;
        }
        case "process_replacement": {
          // Same rationale as process_refund: the API skips the physical
          // return-receipt path when the ERP triggers the replacement
          // earlier. The decision is server-side only — never read a force
          // flag from the request body.
          const FORCE_FROM: ReadonlyArray<typeof returnRequest.status> = [
            "APPROVED",
            "AWAITING_SHIPMENT",
            "IN_TRANSIT",
          ];
          const force = FORCE_FROM.includes(returnRequest.status);
          result = await processReplacementAction(ctx.admin, resolvedId, ctx.shop, body.notes, actor, { force });
          break;
        }
        case "transition":
          if (!body.status) return apiBadRequest("'status' is required for transition action", undefined, ctx.shop, ctx.requestOrigin);
          result = await transitionStatusAction(resolvedId, body.status, ctx.shop, actor);
          break;
        case "skip_shipping":
          if (returnRequest.status !== "APPROVED") {
            return apiBadRequest("skip_shipping is only available when the return is in APPROVED status", undefined, ctx.shop, ctx.requestOrigin);
          }
          result = await transitionStatusAction(resolvedId, "AWAITING_SHIPMENT", ctx.shop, actor);
          break;
        default:
          // This should never happen due to earlier validation, but TypeScript doesn't know that
          return apiBadRequest(`Unknown action: ${actionName}`, undefined, ctx.shop, ctx.requestOrigin);
      }
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return apiConflict(error.message, ctx.shop, ctx.requestOrigin);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`API action error for action '${actionName}' on return ${resolvedId}: ${errorMessage}`);
      return apiInternalError("Failed to process action. Please try again or contact support.", ctx.shop, ctx.requestOrigin);
    }

    if (!result.success) {
      // Determine appropriate status code based on message
      const msg = result.message.toLowerCase();
      if (msg.includes("not found")) return apiNotFound("The requested resource was not found", ctx.shop, ctx.requestOrigin);
      if (msg.includes("transition") || msg.includes("not allowed") || msg.includes("invalid state")) {
        return apiConflict(result.message, ctx.shop, ctx.requestOrigin);
      }
      return apiBadRequest(result.message || "Action failed", undefined, ctx.shop, ctx.requestOrigin);
    }

    const updatedReturn = await getReturnRequest(resolvedId, ctx.shop);
    return apiSuccess({ ...result, returnRequest: updatedReturn }, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API action error:", error);
    return apiInternalError("An unexpected error occurred", shopDomain, requestOrigin);
  }
};
