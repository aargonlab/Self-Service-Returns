import type { LoaderFunctionArgs } from "@remix-run/node";
import type { ReturnStatus, ResolutionType } from "@prisma/client";
import { authenticateApiRequest, apiSuccess, apiBadRequest, apiInternalError, handleCors } from "~/services/api.auth.server";
import { listReturnRequests } from "~/models/returnRequest.server";

// Valid return status enum values
const VALID_STATUSES: ReturnStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "RECEIVED",
  "PARTIALLY_ACCEPTED",
  "REFUNDED",
  "EXCHANGED",
  "CLOSED",
  "CANCELLED",
];

/**
 * @route GET /api/v1/returns
 * @description List return requests with filtering and pagination.
 * @authentication Required — Bearer token via `Authorization` header.
 * @header Authorization — Bearer token (format: `Bearer ssr_live_xxx`).
 * @header X-Shop-Domain — The shop's myshopify.com domain (required).
 * @scope returns:read
 *
 * @queryparam {string} [status] — Filter by return status. Valid values: SUBMITTED, PENDING_REVIEW, APPROVED, REJECTED, AWAITING_SHIPMENT, IN_TRANSIT, RECEIVED, PARTIALLY_ACCEPTED, REFUNDED, EXCHANGED, CLOSED, CANCELLED.
 * @queryparam {string} [search] — Search by order name, customer name, or email.
 * @queryparam {string} [dateFrom] — ISO 8601 date string for start of date range.
 * @queryparam {string} [dateTo] — ISO 8601 date string for end of date range.
 * @queryparam {number} [page=1] — Page number (1-based).
 * @queryparam {number} [pageSize=20] — Items per page (1-100).
 *
 * @returns {object} 200 — `{ returns: ReturnRequest[], total: number, page: number, pageSize: number }`
 * @returns {object} 400 — `{ error: { code: "BAD_REQUEST", message: "Invalid status value. Valid values: ..." } }` — Invalid status, invalid date format, or other validation error.
 * @returns {object} 401 — `{ error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" } }`
 * @returns {object} 403 — `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`
 * @returns {object} 500 — `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`
 *
 * @example
 * // Request
 * curl -H "Authorization: Bearer ssr_live_xxx" \
 *      -H "X-Shop-Domain: my-store.myshopify.com" \
 *      "https://app.example.com/api/v1/returns?status=SUBMITTED&page=1&pageSize=10"
 *
 * // Response
 * {
 *   "returns": [...],
 *   "total": 42,
 *   "page": 1,
 *   "pageSize": 10
 * }
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  // Extract shop/origin for CORS in error responses
  const shopDomain = request.headers.get("X-Shop-Domain") || undefined;
  const requestOrigin = request.headers.get("Origin") || undefined;

  try {
    const ctx = await authenticateApiRequest(request, ["returns:read"]);
    const url = new URL(request.url);

    const statusParam = url.searchParams.get("status");
    let statusFilter: ReturnStatus | ReturnStatus[] | undefined = undefined;

    if (statusParam) {
      const statuses = statusParam.split(",").map(s => s.trim());
      const invalid = statuses.filter(s => !VALID_STATUSES.includes(s as ReturnStatus));
      if (invalid.length > 0) {
        return apiBadRequest(
          `Invalid status value(s): ${invalid.join(", ")}. Valid values: ${VALID_STATUSES.join(", ")}`,
          undefined,
          ctx.shop,
          ctx.requestOrigin
        );
      }
      statusFilter = statuses.length === 1
        ? statuses[0] as ReturnStatus
        : statuses as ReturnStatus[];
    }

    const resolutionTypeParam = url.searchParams.get("resolutionType");
    let resolutionType: ResolutionType | undefined = undefined;
    if (resolutionTypeParam) {
      if (!["REFUND", "EXCHANGE"].includes(resolutionTypeParam)) {
        return apiBadRequest(
          "Invalid resolutionType value. Valid values: REFUND, EXCHANGE",
          undefined,
          ctx.shop,
          ctx.requestOrigin
        );
      }
      resolutionType = resolutionTypeParam as ResolutionType;
    }

    const search = url.searchParams.get("search") || undefined;
    const dateFromStr = url.searchParams.get("dateFrom");
    const dateToStr = url.searchParams.get("dateTo");
    const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined;
    const dateTo = dateToStr ? new Date(dateToStr) : undefined;
    if (dateFrom && isNaN(dateFrom.getTime())) return apiBadRequest("Invalid 'dateFrom' date format", undefined, ctx.shop, ctx.requestOrigin);
    if (dateTo && isNaN(dateTo.getTime())) return apiBadRequest("Invalid 'dateTo' date format", undefined, ctx.shop, ctx.requestOrigin);

    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const rawPageSize = parseInt(url.searchParams.get("pageSize") || "20", 10);

    if (isNaN(rawPage) || rawPage < 1) {
      return apiBadRequest("'page' must be a positive integer", undefined, ctx.shop, ctx.requestOrigin);
    }
    if (isNaN(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) {
      return apiBadRequest("'pageSize' must be between 1 and 100", undefined, ctx.shop, ctx.requestOrigin);
    }

    const page = rawPage;
    const pageSize = rawPageSize;

    const result = await listReturnRequests({
      shop: ctx.shop,
      status: statusFilter,
      resolutionType,
      search,
      dateFrom,
      dateTo,
      page,
      pageSize,
    });

    return apiSuccess(result, 200, ctx.shop, ctx.requestOrigin);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("API list returns error:", error);
    return apiInternalError(undefined, shopDomain, requestOrigin);
  }
};
