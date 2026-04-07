import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { isbot } from "isbot";
import type { EntryContext } from "@remix-run/node";
import { addDocumentResponseHeaders } from "~/shopify.server";

const ABORT_DELAY = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  const prohibitOutOfOrderStreaming =
    isbot(request.headers.get("user-agent")) || remixContext.isSpaMode;

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(request, responseStatusCode, responseHeaders, remixContext)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext);
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  // Security headers
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP: 'unsafe-inline' and 'unsafe-eval' are REQUIRED for Shopify embedded apps.
  // Shopify App Bridge and Polaris require inline scripts/styles and eval for proper operation.
  // DO NOT remove these directives as it will break the embedded app functionality.
  responseHeaders.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com; style-src 'self' 'unsafe-inline' https://cdn.shopify.com; img-src 'self' data: https:; font-src 'self' data: https://cdn.shopify.com; connect-src 'self' https://*.shopify.com https://api.anthropic.com; frame-ancestors https://*.shopify.com https://admin.shopify.com;"
  );
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onAllReady() {
          clearTimeout(timeoutId);
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          clearTimeout(timeoutId);
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
    timeoutId = setTimeout(abort, ABORT_DELAY);
    // Clear timeout if stream completes before timeout fires
    request.signal?.addEventListener("abort", () => clearTimeout(timeoutId));
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  // Security headers
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // CSP: 'unsafe-inline' and 'unsafe-eval' are REQUIRED for Shopify embedded apps.
  // Shopify App Bridge and Polaris require inline scripts/styles and eval for proper operation.
  // DO NOT remove these directives as it will break the embedded app functionality.
  responseHeaders.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com; style-src 'self' 'unsafe-inline' https://cdn.shopify.com; img-src 'self' data: https:; font-src 'self' data: https://cdn.shopify.com; connect-src 'self' https://*.shopify.com https://api.anthropic.com; frame-ancestors https://*.shopify.com https://admin.shopify.com;"
  );
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        onShellReady() {
          clearTimeout(timeoutId);
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          clearTimeout(timeoutId);
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
    timeoutId = setTimeout(abort, ABORT_DELAY);
    // Clear timeout if stream completes before timeout fires
    request.signal?.addEventListener("abort", () => clearTimeout(timeoutId));
  });
}
