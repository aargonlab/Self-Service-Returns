import { unauthenticated } from "~/shopify.server";
import type { ShopifyOrder } from "~/services/shopify.types";
import {
  ORDER_QUERY,
  ORDERS_SEARCH_QUERY,
} from "~/utils/shopifyGraphql";

function sanitizeSearchTerm(term: string): string {
  // BUG FIX: Prevent ReDoS by limiting input length and using non-regex approach
  // Limit input length to prevent ReDoS attacks
  const limited = term.slice(0, 200);

  // M-INF4: Remove special characters, boolean operators, and wildcards
  const cleaned = limited
    .replace(/[\\/*+?^${}()|[\]:'"]/g, "")
    .replace(/[%_*?]/g, "") // Escape GraphQL/Prisma/SQL wildcards
    .split(/\s+/)
    .filter(word => !["AND", "OR", "NOT"].includes(word.toUpperCase()))
    .join(" ")
    .trim();

  // If sanitization produced empty string, return empty rather than raw input
  return cleaned || "";
}

async function createGraphqlClient(shop: string) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

export async function lookupOrderForPortal(
  shop: string,
  orderName: string,
  email: string,
): Promise<ShopifyOrder | null> {
  const admin = await createGraphqlClient(shop);
  const cleanName = orderName.replace(/^#/, "");
  // Bug #388: Trim email to prevent whitespace mismatch
  const trimmedEmail = email.trim();

  const response = await admin.graphql(ORDERS_SEARCH_QUERY, {
    variables: {
      query: `name:"${sanitizeSearchTerm(cleanName)}" email:"${sanitizeSearchTerm(trimmedEmail)}"`,
    },
  });

  const json = await response.json();
  const orders = json?.data?.orders?.nodes ?? [];

  const match = orders.find(
    (o: ShopifyOrder) =>
      o.name === `#${cleanName}` &&
      o.email?.trim().toLowerCase() === trimmedEmail.toLowerCase(),
  );

  return match ?? null;
}

export async function getOrderForPortal(
  shop: string,
  orderId: string,
  email: string,
): Promise<ShopifyOrder | null> {
  const admin = await createGraphqlClient(shop);
  // Bug #388: Trim email to prevent whitespace mismatch
  const trimmedEmail = email.trim();

  const response = await admin.graphql(ORDER_QUERY, {
    variables: { id: orderId },
  });

  const json = await response.json();
  const order = json?.data?.order ?? null;

  // Validate that the order's email matches the provided email
  if (!order || order.email?.trim().toLowerCase() !== trimmedEmail.toLowerCase()) {
    return null;
  }

  return order;
}
