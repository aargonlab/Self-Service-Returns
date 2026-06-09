// Pure, dependency-free matching helpers for the customer portal order
// lookup. Live outside the .server file so they can be unit-tested without
// Shopify auth.

/**
 * Normalize an order name for case-insensitive comparison and tolerate
 * Shopify's optional leading "#" — shops can replace the "#" prefix with a
 * custom one (e.g. "NA1023" instead of "#1023") under Settings → General →
 * Orders, so we cannot rely on its presence either way.
 */
function normalizeOrderName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/^#/, "").toLowerCase().trim();
}

/**
 * Normalize an email for case-insensitive comparison with whitespace tolerance.
 */
function normalizeEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

export interface PortalOrderLike {
  name: string;
  email: string | null;
  customer?: {
    email: string | null;
  } | null;
}

/**
 * Whether a Shopify order matches the customer-provided order name.
 *
 * Tolerates "#" on either side and is case-insensitive. Returns true when
 * the order's stripped name equals the input's stripped name, which covers:
 *   - Default Shopify naming (e.g. "#1023" vs typed "1023" or "#1023").
 *   - Custom order-name prefix (e.g. "NA1023" vs typed "NA1023" or "#NA1023").
 */
export function orderNameMatches(
  candidateName: string | null | undefined,
  inputName: string | null | undefined,
): boolean {
  const a = normalizeOrderName(candidateName);
  const b = normalizeOrderName(inputName);
  return a !== "" && a === b;
}

/**
 * Whether the customer-provided email matches the order's contact email or
 * the linked customer's email. We accept either because:
 *   - order.email can be empty for some checkout paths.
 *   - order.email may have been overridden by staff post-checkout while the
 *     customer keeps using their personal address.
 *   - The customer record's email is the canonical "who am I" identifier
 *     once Shopify links the order to a customer.
 */
export function orderEmailMatches(
  order: PortalOrderLike,
  inputEmail: string | null | undefined,
): boolean {
  const target = normalizeEmail(inputEmail);
  if (!target) return false;
  return (
    normalizeEmail(order.email) === target ||
    normalizeEmail(order.customer?.email) === target
  );
}
