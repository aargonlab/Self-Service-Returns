import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
}

let hmrConfig;
if (process.env.SHOPIFY_APP_URL) {
  const host = new URL(process.env.SHOPIFY_APP_URL).host;
  hmrConfig = {
    protocol: "wss",
    host: host,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    host: "localhost",
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: false,
        v3_singleFetch: false,
      },
    }),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    include: [
      "@remix-run/node",
      "@remix-run/react",
      "@shopify/shopify-app-remix/server",
      "@shopify/shopify-app-remix/react",
      "@shopify/shopify-app-remix/adapters/node",
      "@shopify/app-bridge-react",
      "@shopify/polaris",
      "@shopify/shopify-app-session-storage-prisma",
      "@shopify/shopify-api/rest/admin/2025-01",
      "@prisma/client",
    ],
  },
  build: {
    assetsInlineLimit: 0,
  },
}) satisfies UserConfig;
