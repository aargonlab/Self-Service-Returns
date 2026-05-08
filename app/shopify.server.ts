import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "~/db.server";

// Startup validation
if (!process.env.SHOPIFY_APP_URL) {
  console.warn("[Shopify] SHOPIFY_APP_URL environment variable is not set or may be misconfigured");
}

if (!process.env.SHOPIFY_API_KEY) {
  throw new Error("SHOPIFY_API_KEY environment variable is required");
}

if (!process.env.SHOPIFY_API_SECRET) {
  throw new Error("SHOPIFY_API_SECRET environment variable is required");
}

// Bug #396 Fix: Validate SCOPES environment variable
if (process.env.SCOPES) {
  const KNOWN_SCOPES = [
    "read_orders", "write_orders", "read_products", "write_products",
    "read_customers", "write_customers", "read_returns", "write_returns",
    "read_draft_orders", "write_draft_orders",
    "read_inventory", "write_inventory", "read_locations", "read_shipping",
    "read_markets", "read_merchant_managed_fulfillment_orders",
    "write_merchant_managed_fulfillment_orders",
    "read_third_party_fulfillment_orders",
  ];
  const scopes = process.env.SCOPES.split(",").map(s => s.trim());
  const unknownScopes = scopes.filter(scope => !KNOWN_SCOPES.includes(scope));
  if (unknownScopes.length > 0) {
    console.warn(`[Shopify] WARNING: Unknown scopes detected: ${unknownScopes.join(", ")}. Please verify these are valid Shopify API scopes.`);
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
