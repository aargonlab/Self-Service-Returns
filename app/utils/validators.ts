import { z } from "zod";

export const orderLookupSchema = z.object({
  orderName: z
    .string()
    .min(1, "Order number is required")
    .refine((val) => {
      // Must contain at least one digit (Shopify order numbers are numeric)
      const cleaned = val.replace(/^#/, "");
      return /\d/.test(cleaned);
    }, "Order number must contain at least one digit")
    .transform((val) => {
      // Normalize: add # prefix if not present
      return val.startsWith("#") ? val : `#${val}`;
    }),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  shop: z.string().min(1, "Shop is required"),
});

export const createReturnRequestSchema = z.object({
  shopifyOrderId: z.string().min(1),
  shopifyOrderName: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  shop: z.string().min(1),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        shopifyLineItemId: z.string().min(1),
        productTitle: z.string().min(1),
        variantTitle: z.string().optional(),
        sku: z.string().optional(),
        imageUrl: z.string().optional(),
        price: z.string().optional(),
        quantity: z.number().int().min(1),
        returnReason: z.string().min(1, "Return reason is required"),
        compositeCode: z.string().regex(/^(RET|REP)-\w+$/, "Must be RET-<code> or REP-<code>").optional(),
        customerNote: z.string().optional(),
      }),
    )
    .min(1, "At least one item must be selected for return"),
});

export const commentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty").max(2000),
  isInternal: z.boolean().default(false),
});

export const settingsSchema = z.object({
  returnWindowDays: z
    .number()
    .int()
    .min(1, "Return window must be at least 1 day")
    .max(365, "Return window cannot exceed 365 days"),
  allowedReasons: z
    .array(z.string())
    .min(1, "At least one return reason must be enabled"),
  returnInstructions: z.string().optional(),
  autoApprove: z.boolean(),
  enableReplacement: z.boolean().optional(),
});

export const statusUpdateSchema = z.object({
  status: z.enum([
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
  ]),
  reason: z.string().optional(),
});

export const policyConditionSchema = z.object({
  field: z.enum([
    "days_since_fulfillment",
    "order_total",
    "customer_return_count",
    "return_reason",
    "product_title",
    "product_sku",
    "product_tag",
    "product_tags",
    "product_type",
    "product_vendor",
    "item_price",
    "customer_email",
  ]),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "greater_than",
    "less_than",
    "in",
    "not_in",
  ]),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});

export const policyOutcomeSchema = z.object({
  action: z.enum([
    "EXCLUDE",
    "AUTO_APPROVE",
    "AUTO_REJECT",
    "REQUIRE_PHOTO",
    "MANUAL_REVIEW",
    "OVERRIDE_WINDOW",
  ]),
  message: z.string().optional(),
  returnWindowDays: z.number().int().min(1).max(365).optional(),
});

export const createPolicySchema = z.object({
  name: z.string().min(1, "Policy name is required").max(100),
  description: z.string().max(500).optional(),
  type: z.enum(["ELIGIBILITY", "AUTO_ACTION", "EXCLUSION", "REQUIREMENT"]),
  priority: z.number().int().min(0).max(100).default(0),
  conditions: z.array(policyConditionSchema).min(1, "At least one condition is required"),
  outcome: policyOutcomeSchema,
});

/**
 * Validates that a URL is safe for server-side fetching (SSRF protection).
 * Blocks private IPs, localhost, link-local, and metadata endpoints.
 * Returns the validated URL string or throws an Error.
 */
export function validateExternalUrl(url: string, context: string = "URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context}: Invalid URL format`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${context}: Only HTTP and HTTPS URLs are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedPatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^\[::1\]$/,
    /^\[fc/i,
    /^\[fd/i,
    /^\[fe80:/i,
    /^metadata\.google\.internal$/,
  ];

  if (blockedPatterns.some(p => p.test(hostname))) {
    throw new Error(`${context}: URLs pointing to internal or private networks are not allowed`);
  }

  return parsed.toString();
}
