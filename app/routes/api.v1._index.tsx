/**
 * @module API v1 — Root
 * @description API information endpoint. Returns available endpoints, authentication requirements, scopes, and error format.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCors, corsHeaders } from "~/services/api.auth.server";
import { json } from "@remix-run/node";

/**
 * @route GET /api/v1
 * @description Returns API information including version, available endpoints, authentication requirements, scopes, and error format documentation.
 * @authentication None — This endpoint is publicly accessible for API discovery.
 *
 * @returns {object} 200 — API documentation object containing name, version, authentication details, endpoints, scopes, error format, and valid status values.
 *
 * @example
 * // Request
 * curl "https://app.example.com/api/v1"
 *
 * // Response
 * {
 *   "name": "SelfServiceReturn API",
 *   "version": "1.0.0",
 *   "authentication": { ... },
 *   "endpoints": { ... },
 *   "scopes": { ... },
 *   "error_format": { ... },
 *   "status_values": [...]
 * }
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  return json({
    name: "SelfServiceReturn API",
    version: "1.0.0",
    authentication: {
      description: "All endpoints require API key authentication",
      headers: {
        "X-Shop-Domain": "your-store.myshopify.com (required)",
        "Authorization": "Bearer ssr_live_xxxxxxxxxxxx (required)",
      },
    },
    endpoints: {
      "GET /api/v1/returns": {
        description: "List returns with filtering and pagination",
        scope: "returns:read",
        query_params: {
          status: "Filter by status (optional)",
          search: "Search by order name, customer name/email (optional)",
          dateFrom: "ISO date filter (optional)",
          dateTo: "ISO date filter (optional)",
          page: "Page number, default 1",
          pageSize: "Items per page, default 20, max 100",
        },
      },
      "GET /api/v1/returns/:id": {
        description: "Get return details including items, comments (non-internal), and timeline",
        scope: "returns:read",
        notes: "The :id parameter accepts internal CUID, Shopify GID (gid://shopify/Return/...), or Shopify numeric ID. When serial numbers are enabled, each return item includes a serialNumber string field.",
      },
      "POST /api/v1/returns/:id/actions": {
        description: "Execute an action on a return",
        scope: "returns:write",
        body: {
          action: "approve | reject | cancel | process_refund | process_replacement | transition",
          reason: "Required for reject",
          notes: "Optional for process_replacement",
          status: "Required for transition (e.g. IN_TRANSIT, RECEIVED)",
          actor: "Optional actor name, defaults to 'API'",
        },
      },
      "GET /api/v1/returns/:id/comments": {
        description: "List comments on a return",
        scope: "returns:read",
        query_params: {
          includeInternal: "Set to 'true' to include internal notes",
        },
      },
      "POST /api/v1/returns/:id/comments": {
        description: "Add a comment to a return",
        scope: "returns:write",
        body: {
          content: "Comment text (required)",
          isInternal: "Boolean, default false",
          author: "Optional author name, defaults to 'API'",
        },
      },
      "GET /api/v1/returns/:id/timeline": {
        description: "Get timeline events for a return",
        scope: "returns:read",
      },
      "GET /api/v1/returns/:id/label": {
        description: "Get shipping label for a return",
        scope: "returns:read",
      },
      "GET /api/v1/settings": {
        description: "Get return settings for the shop (read-only). Settings can only be modified through the Shopify admin UI.",
        scope: "settings:read",
        response: {
          returnWindowDays: "Number — days within which returns are accepted",
          allowedReasons: "Array of reason objects",
          returnInstructions: "String — instructions shown to customers",
          autoApprove: "Boolean — whether returns are auto-approved",
          enableReplacement: "Boolean — whether replacement/exchange is enabled",
          enableSerialNumbers: "Boolean — whether serial number tracking is enabled for orders",
        },
      },
    },
    scopes: {
      "returns:read": "Read return data (list, detail, timeline, comments, label)",
      "returns:write": "Execute actions on returns (approve, reject, refund, etc.) and add comments",
      "settings:read": "Read shop return settings (read-only, no write API available)",
      "admin": "Full access to all read/write endpoints",
    },
    error_format: {
      description: "All errors return a consistent JSON structure",
      example: {
        error: {
          code: "BAD_REQUEST",
          message: "Description of what went wrong",
        },
      },
      codes: {
        "400 BAD_REQUEST": "Invalid request or validation error",
        "401 UNAUTHORIZED": "Missing or invalid API key",
        "403 FORBIDDEN": "Valid key but insufficient scope",
        "404 NOT_FOUND": "Resource not found",
        "409 CONFLICT": "Invalid state transition",
        "500 INTERNAL_ERROR": "Server error",
      },
    },
    status_values: [
      "SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED",
      "AWAITING_SHIPMENT", "IN_TRANSIT", "RECEIVED",
      "INSPECTION_PENDING", "PARTIALLY_ACCEPTED",
      "REFUNDED", "EXCHANGED",
      "CLOSED", "CANCELLED",
    ],
  }, { headers: corsHeaders() });
};
