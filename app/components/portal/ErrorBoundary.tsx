import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import en from "~/utils/portalTranslations/en";

export function PortalErrorBoundary() {
  const error = useRouteError();

  let title = en["portal.error.title"];
  let message = en["portal.error.message"];

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = en["portal.error.notFound"];
      message = en["portal.error.notFoundMessage"];
    } else if (error.status === 400) {
      title = en["portal.error.invalidRequest"];
      message = typeof error.data === "string" ? error.data : en["portal.error.invalidRequestMessage"];
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : en["portal.error.title"];
    }
  }

  // Bug #243 & #278 Fix: Extract shop param from URL for server-rendered href, guard window access
  const shopParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('shop')
    : null;
  // BUG 1 FIX: Validate shop param against myshopify.com pattern
  const isValidShop = shopParam ? /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopParam) : false;
  const safeShop = isValidShop ? shopParam : "";
  const backUrl = safeShop ? `/returns?shop=${encodeURIComponent(safeShop)}` : '/returns';

  return (
    <div className="portal-container">
      <div className="portal-card text-center">
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>!</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <a
          href={backUrl}
          className="portal-button-primary"
        >
          {en["portal.error.backToCenter"]}
        </a>
      </div>
    </div>
  );
}
