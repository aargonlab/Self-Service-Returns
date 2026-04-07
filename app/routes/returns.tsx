import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { useState } from "react";
import portalStyles from "~/styles/portal.css?url";
import { getSettings } from "~/models/returnSettings.server";
import { resolveLocale, loadTranslationMessages, getActiveLocalesWithNames } from "~/services/portalTranslation.server";
import { TranslationProvider } from "~/utils/useTranslation";

// Simple locale cache — 60 second TTL per shop
const localeCache = new Map<string, { locales: string[]; expiry: number }>();

function getCachedLocales(shop: string): string[] | null {
  const entry = localeCache.get(shop);
  if (entry && Date.now() < entry.expiry) return entry.locales;
  localeCache.delete(shop);
  return null;
}

function setCachedLocales(shop: string, locales: string[]): void {
  localeCache.set(shop, { locales, expiry: Date.now() + 60000 });
  // Prevent cache from growing unbounded
  if (localeCache.size > 100) {
    const oldestKey = localeCache.keys().next().value;
    if (oldestKey) localeCache.delete(oldestKey);
  }
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const storeName = shop.replace(/\.myshopify\.com$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Store";

  let logoUrl: string | null = null;
  let portalLogoPosition = "left";
  let portalButtonColor: string | null = null;
  let portalButtonTextColor: string | null = null;
  let portalTextColor: string | null = null;
  let portalHeadingFont = "sans-serif";
  let portalBodyFont = "sans-serif";

  if (shop) {
    try {
      const settings = await getSettings(shop);
      logoUrl = settings.logoUrl || null;
      portalLogoPosition = settings.portalLogoPosition || "left";
      portalButtonColor = settings.portalButtonColor || null;
      portalButtonTextColor = settings.portalButtonTextColor || null;
      portalTextColor = settings.portalTextColor || null;
      portalHeadingFont = settings.portalHeadingFont || "sans-serif";
      portalBodyFont = settings.portalBodyFont || "sans-serif";
    } catch {
      // Settings not available — use defaults
    }
  }

  const requestedLocale = url.searchParams.get("locale");
  const acceptLanguage = request.headers.get("Accept-Language");
  const locale = await resolveLocale(shop, requestedLocale, acceptLanguage);
  const messages = await loadTranslationMessages(shop, locale);

  // Use cached locales if available
  let activeLocales = shop ? getCachedLocales(shop) : null;
  if (!activeLocales) {
    const localesWithNames = await getActiveLocalesWithNames(shop);
    activeLocales = localesWithNames.map(l => l.code);
    if (shop) setCachedLocales(shop, activeLocales);
    return json({
      storeName, shop, logoUrl, locale, messages, activeLocales: localesWithNames,
      portalLogoPosition, portalButtonColor, portalButtonTextColor,
      portalTextColor, portalHeadingFont, portalBodyFont,
    });
  }

  // If using cache, fetch names for cached codes
  const { SUPPORTED_LOCALES } = await import("~/utils/portalTranslations");
  const activeLocalesWithNames = activeLocales
    .map((code) => {
      const info = SUPPORTED_LOCALES.find((l) => l.code === code);
      return info ? { code: info.code, nativeName: info.nativeName } : { code, nativeName: code };
    })
    .sort((a, b) => a.nativeName.localeCompare(b.nativeName));

  return json({
    storeName, shop, logoUrl, locale, messages, activeLocales: activeLocalesWithNames,
    portalLogoPosition, portalButtonColor, portalButtonTextColor,
    portalTextColor, portalHeadingFont, portalBodyFont,
  });
};

const FONT_STACKS: Record<string, string> = {
  "sans-serif": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  "serif": "Georgia, 'Times New Roman', Times, serif",
  "mono": "'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
};

export default function ReturnsLayout() {
  const {
    storeName, shop, logoUrl, locale, messages, activeLocales,
    portalLogoPosition, portalButtonColor, portalButtonTextColor,
    portalTextColor, portalHeadingFont, portalBodyFont,
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [showLangModal, setShowLangModal] = useState(false);

  const searchParams = new URLSearchParams(location.search);
  const shopParam = searchParams.get("shop") || shop;
  const returnUrl = shopParam ? `/returns?shop=${encodeURIComponent(shopParam)}` : "/returns";

  const buildLocaleUrl = (code: string) => {
    const params = new URLSearchParams(location.search);
    params.set("locale", code);
    return `${location.pathname}?${params.toString()}`;
  };

  // Build CSS custom property overrides from settings
  const cssVars: Record<string, string> = {};
  if (portalButtonColor) cssVars["--portal-btn-bg"] = portalButtonColor;
  if (portalButtonTextColor) cssVars["--portal-btn-text"] = portalButtonTextColor;
  if (portalTextColor) cssVars["--portal-text-color"] = portalTextColor;
  if (portalHeadingFont && FONT_STACKS[portalHeadingFont]) {
    cssVars["--portal-heading-font"] = FONT_STACKS[portalHeadingFont];
  }
  if (portalBodyFont && FONT_STACKS[portalBodyFont]) {
    cssVars["--portal-body-font"] = FONT_STACKS[portalBodyFont];
  }

  const headerInnerClass = `portal-header-inner${portalLogoPosition === "center" ? " portal-logo-center" : ""}`;

  // Validate logo URL - must be HTTPS or data: URI to prevent XSS
  const safeLogoUrl = logoUrl && (logoUrl.startsWith("https://") || logoUrl.startsWith("data:image/")) ? logoUrl : null;

  return (
    <div className="portal-page" style={Object.keys(cssVars).length > 0 ? cssVars as React.CSSProperties : undefined}>
      <header className="portal-header">
        <div className={headerInnerClass}>
          <a href={returnUrl} className="portal-header-link">
            {safeLogoUrl ? (
              <img
                src={safeLogoUrl}
                alt={storeName}
                className="portal-logo"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = "block";
                }}
              />
            ) : null}
            <span
              className="portal-store-name"
              style={safeLogoUrl ? { display: "none" } : undefined}
            >
              {storeName}
            </span>
          </a>
          {activeLocales.length > 1 && (
            <div className="portal-header-actions">
              <button
                onClick={() => setShowLangModal(true)}
                className="portal-lang-button"
                aria-label="Change language"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {showLangModal && (
        <div className="portal-lang-overlay" onClick={() => setShowLangModal(false)}>
          <div className="portal-lang-modal" onClick={(e) => e.stopPropagation()}>
            <div className="portal-lang-modal-header">
              <h3>Language</h3>
              <button onClick={() => setShowLangModal(false)} aria-label="Close">&times;</button>
            </div>
            <div className="portal-lang-list">
              {activeLocales.map((loc: { code: string; nativeName: string }) => (
                <a
                  key={loc.code}
                  href={buildLocaleUrl(loc.code)}
                  className={`portal-lang-item ${locale === loc.code ? 'portal-lang-item-active' : ''}`}
                >
                  <span>{loc.nativeName}</span>
                  {locale === loc.code && <span>✓</span>}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="portal-main">
        <TranslationProvider locale={locale} messages={messages}>
          <Outlet />
        </TranslationProvider>
      </main>

      <footer className="portal-footer">
        <div className="portal-footer-inner">
          <p className="portal-footer-text">
            {messages["portal.layout.copyright"]
              ?.replace("{{year}}", String(new Date().getFullYear()))
              .replace("{{storeName}}", storeName) || `© ${new Date().getFullYear()} ${storeName}`}
          </p>
        </div>
      </footer>
    </div>
  );
}
