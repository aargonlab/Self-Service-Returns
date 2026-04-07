// Global type definitions for Shopify App Bridge
// Available in embedded Shopify apps via the App Bridge script

declare const shopify: {
  toast: {
    show(message: string, options?: { duration?: number; isError?: boolean }): void;
  };
};
