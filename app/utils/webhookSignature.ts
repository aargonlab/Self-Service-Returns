import { createHmac } from "crypto";

/**
 * Sign a webhook payload with HMAC-SHA256.
 *
 * Returns the digest as Base64 (the Shopify webhook convention).
 * Receivers must compute HMAC-SHA256 over the raw HTTP body with the shared
 * secret, encode the result as Base64, and compare with the
 * `X-Webhook-Signature` header in constant time.
 *
 * Keep this module dependency-free so it can be imported from unit tests.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}
