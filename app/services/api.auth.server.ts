/**
 * External API authentication middleware for SelfServiceReturn.
 * Provides API key-based authentication for external API access.
 */

import { createHash, randomBytes } from "crypto";
import { json } from "@remix-run/node";
import prisma from "~/db.server";
import { unauthenticated } from "~/shopify.server";

// ============================================================================
// Types
// ============================================================================

export type ApiScope =
  | "returns:read"
  | "returns:write"
  | "settings:read"
  | "settings:write"
  | "admin";

export interface ApiKeyRecord {
  id: string;
  shop: string;
  name: string;
  scopes: ApiScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  active: boolean;
}

export interface ApiContext {
  shop: string;
  apiKey: ApiKeyRecord;
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  requestOrigin: string | null;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Error Helpers
// ============================================================================

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
  shopDomain?: string,
  requestOrigin?: string | null,
): Response {
  const body: ApiErrorResponse = {
    error: { code, message, ...(details ? { details } : {}) },
  };
  return json(body, { status, headers: corsHeaders(shopDomain, requestOrigin) });
}

export function apiUnauthorized(message = "Unauthorized", details?: unknown, _unused?: unknown, shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("UNAUTHORIZED", message, 401, details, shopDomain, requestOrigin);
}

export function apiForbidden(message = "Forbidden", details?: unknown, _unused?: unknown, shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("FORBIDDEN", message, 403, details, shopDomain, requestOrigin);
}

export function apiNotFound(message = "Not found", shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("NOT_FOUND", message, 404, undefined, shopDomain, requestOrigin);
}

export function apiBadRequest(message: string, details?: unknown, shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("BAD_REQUEST", message, 400, details, shopDomain, requestOrigin);
}

export function apiConflict(message: string, shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("CONFLICT", message, 409, undefined, shopDomain, requestOrigin);
}

export function apiInternalError(message = "Internal server error", shopDomain?: string, requestOrigin?: string | null): Response {
  return apiError("INTERNAL_ERROR", message, 500, undefined, shopDomain, requestOrigin);
}

// ============================================================================
// CORS Headers (for cross-origin API access)
// ============================================================================

/**
 * Generate CORS headers with origin validation.
 * Only allows origins matching the shop's .myshopify.com domain.
 *
 * @param shopDomain The shop domain (e.g., "mystore.myshopify.com")
 * @param requestOrigin The Origin header from the request
 */
export function corsHeaders(shopDomain?: string, requestOrigin?: string | null): HeadersInit {
  const headers: HeadersInit = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Shop-Domain",
    "Content-Type": "application/json",
  };

  // If shop domain and request origin are provided, validate origin
  if (shopDomain && requestOrigin) {
    // Extract base shop name from shop domain (e.g., "mystore" from "mystore.myshopify.com")
    const shopName = shopDomain.replace(/\.myshopify\.com$/, "");

    // Parse origin to validate
    try {
      const originUrl = new URL(requestOrigin);
      const originHost = originUrl.hostname;

      // Allow exact shop domain or admin domain only
      if (
        originHost === shopDomain ||
        originHost === `${shopName}.myshopify.com` ||
        originHost === "admin.shopify.com"
      ) {
        headers["Access-Control-Allow-Origin"] = requestOrigin;
        headers["Access-Control-Allow-Credentials"] = "true";
      } else {
        // If origin doesn't match, use shop domain as fallback
        headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
      }
    } catch {
      // Invalid origin URL, use shop domain as fallback
      headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
    }
  } else if (shopDomain) {
    // If only shop domain is provided (no origin), use it
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  } else {
    // No shop domain available, use restrictive default (no wildcard)
    // This should rarely happen as we require X-Shop-Domain header
    headers["Access-Control-Allow-Origin"] = "https://admin.shopify.com";
  }

  return headers;
}

export function handleCors(request: Request, shopDomain?: string): Response | null {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin");
    return new Response(null, { status: 204, headers: corsHeaders(shopDomain, origin) });
  }
  return null;
}

// ============================================================================
// API Key Utilities
// ============================================================================

const API_KEY_PREFIX = "ssr_live_";
const API_KEY_LENGTH = 32; // 32 random bytes = 64 hex chars

/**
 * Generate a new API key. Returns the plaintext key (show once to user)
 * and the hash (store in database).
 */
export function generateApiKey(): { plaintext: string; hash: string } {
  const randomPart = randomBytes(API_KEY_LENGTH).toString("hex");
  const plaintext = `${API_KEY_PREFIX}${randomPart}`;
  const hash = hashApiKey(plaintext);
  return { plaintext, hash };
}

/**
 * Hash an API key for secure storage.
 * Uses SHA-256 which is appropriate for API keys because:
 * - API keys are high-entropy (256-bit random), not human-chosen passwords
 * - Rainbow tables are infeasible against 256-bit inputs
 * - Brute force against SHA-256 of a 256-bit key is computationally impossible
 * For password hashing, use bcrypt/argon2 instead.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Extract the prefix from an API key for display purposes.
 */
export function getApiKeyPrefix(key: string): string {
  return key.substring(0, API_KEY_PREFIX.length + 8); // "ssr_live_" + first 8 chars
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Authenticate an API request and return the API context.
 *
 * Requires Bearer token authentication: `Authorization: Bearer ssr_live_xxxx`
 * Also requires: `X-Shop-Domain: mystore.myshopify.com`
 *
 * @param request The incoming request
 * @param requiredScopes Scopes required for this endpoint
 * @returns ApiContext if authenticated, or throws a Response
 */
export async function authenticateApiRequest(
  request: Request,
  requiredScopes: ApiScope[],
): Promise<ApiContext> {
  // Extract shop domain first for CORS validation
  const shopDomain = request.headers.get("X-Shop-Domain");
  const requestOrigin = request.headers.get("Origin");

  // Handle CORS preflight
  const shop = shopDomain ? normalizeShopDomain(shopDomain) : undefined;
  const corsResponse = handleCors(request, shop || undefined);
  if (corsResponse) {
    throw corsResponse;
  }

  // Validate shop domain
  if (!shopDomain) {
    throw apiUnauthorized("Missing X-Shop-Domain header", undefined, undefined, shop || undefined, requestOrigin || undefined);
  }

  // Normalize shop domain (ensure .myshopify.com suffix)
  if (!shop) {
    throw apiBadRequest("Invalid shop domain format", undefined, shop || undefined, requestOrigin || undefined);
  }

  // Try Bearer token authentication first
  const authHeader = request.headers.get("Authorization");
  let apiKeyRecord: ApiKeyRecord | null = null;

  if (authHeader && /^bearer /i.test(authHeader)) {
    const token = authHeader.replace(/^bearer /i, "");
    apiKeyRecord = await validateBearerToken(shop, token);
  }

  if (!apiKeyRecord) {
    throw apiUnauthorized("Invalid or missing API credentials", undefined, undefined, shop, requestOrigin);
  }

  // Check if key is active
  if (!apiKeyRecord.active) {
    throw apiUnauthorized("API key is deactivated", undefined, undefined, shop, requestOrigin);
  }

  // Check expiration
  if (apiKeyRecord.expiresAt && new Date() > apiKeyRecord.expiresAt) {
    throw apiUnauthorized("API key has expired", undefined, undefined, shop, requestOrigin);
  }

  // Check scopes
  if (!hasRequiredScopes(apiKeyRecord.scopes, requiredScopes)) {
    throw apiForbidden(
      `Insufficient permissions. Required: ${requiredScopes.join(", ")}`,
      undefined,
      undefined,
      shop,
      requestOrigin,
    );
  }

  // Update last used timestamp (fire and forget)
  updateLastUsed(apiKeyRecord.id).catch(err =>
    console.error(`[API Auth] Failed to update last used for key ${apiKeyRecord.id}:`, err instanceof Error ? err.message : err)
  );

  // Get Shopify admin client for this shop
  let admin;
  try {
    const adminTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Shopify admin client timed out after 30s")), 30000),
    );
    const result = await Promise.race([unauthenticated.admin(shop), adminTimeout]);
    admin = result.admin;
  } catch (error) {
    console.error(`Failed to get admin client for shop ${shop}:`, error);
    throw apiError(
      "SHOP_NOT_INSTALLED",
      "The app is not installed on this shop or the access token has expired.",
      401,
      undefined,
      shop,
      requestOrigin,
    );
  }

  return {
    shop,
    apiKey: apiKeyRecord,
    admin,
    requestOrigin,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate a Bearer token against the database.
 */
async function validateBearerToken(
  shop: string,
  token: string,
): Promise<ApiKeyRecord | null> {
  // Quick validation
  if (!token.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(token);

  const record = await prisma.apiKey.findFirst({
    where: {
      shop,
      keyHash,
    },
  });

  if (!record) return null;

  return {
    id: record.id,
    shop: record.shop,
    name: record.name,
    scopes: record.scopes as ApiScope[],
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    active: record.active,
  };
}


/**
 * Check if the API key has all required scopes.
 */
function hasRequiredScopes(
  keyScopes: ApiScope[],
  requiredScopes: ApiScope[],
): boolean {
  // "admin" scope grants all permissions
  if (keyScopes.includes("admin")) {
    return true;
  }

  return requiredScopes.every((scope) => keyScopes.includes(scope));
}

/**
 * Normalize a shop domain to the standard format.
 */
function normalizeShopDomain(domain: string): string | null {
  // Null/undefined guard
  if (!domain) {
    return null;
  }

  // Remove protocol if present
  let normalized = domain.replace(/^https?:\/\//, "");

  // Remove trailing slash
  normalized = normalized.replace(/\/$/, "");

  // Convert to lowercase for validation
  normalized = normalized.toLowerCase();

  // Length validation
  if (normalized.length > 255) {
    return null;
  }

  // Validate format
  const shopifyDomainRegex = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
  if (!shopifyDomainRegex.test(normalized)) {
    // Only auto-append .myshopify.com if it's a simple store name (no dots)
    if (/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
      normalized = `${normalized}.myshopify.com`;
    } else {
      // Domain contains dots but doesn't match expected pattern
      return null;
    }
  }

  // Bug #5 Fix: After normalizing, ensure the domain matches the strict pattern
  // This prevents path traversal attacks like "evil.com/../shop.myshopify.com"
  const strictPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
  if (!strictPattern.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Update the last used timestamp for an API key.
 */
async function updateLastUsed(keyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { lastUsedAt: new Date() },
  });
}

// ============================================================================
// API Key Management (for admin UI)
// ============================================================================

/**
 * Create a new API key for a shop.
 * Returns the plaintext key (show once to user).
 */
export async function createApiKey(
  shop: string,
  name: string,
  scopes: ApiScope[],
  expiresAt?: Date,
): Promise<{ id: string; plaintext: string; prefix: string }> {
  const { plaintext, hash } = generateApiKey();
  const prefix = getApiKeyPrefix(plaintext);

  const record = await prisma.apiKey.create({
    data: {
      shop,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes,
      expiresAt,
    },
  });

  return { id: record.id, plaintext, prefix };
}

/**
 * List API keys for a shop (without sensitive data).
 */
export async function listApiKeys(shop: string): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: ApiScope[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    active: boolean;
    createdAt: Date;
  }>
> {
  const records = await prisma.apiKey.findMany({
    where: { shop },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return records.map((r) => ({
    ...r,
    prefix: r.keyPrefix,
    scopes: r.scopes as ApiScope[],
  }));
}

/**
 * Revoke (deactivate) an API key.
 */
export async function revokeApiKey(shop: string, keyId: string): Promise<void> {
  await prisma.apiKey.updateMany({
    where: { id: keyId, shop },
    data: { active: false },
  });
}

/**
 * Delete an API key permanently.
 */
export async function deleteApiKey(shop: string, keyId: string): Promise<void> {
  await prisma.apiKey.deleteMany({
    where: { id: keyId, shop },
  });
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create a successful JSON response with CORS headers.
 */
export function apiSuccess<T>(data: T, status = 200, shopDomain?: string, requestOrigin?: string | null): Response {
  return json(data, { status, headers: corsHeaders(shopDomain, requestOrigin) });
}

/**
 * Verify that a return request belongs to the authenticated shop.
 */
export async function verifyReturnOwnership(
  returnId: string,
  shop: string,
): Promise<boolean> {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    select: { shop: true },
  });

  return returnRequest?.shop === shop;
}
