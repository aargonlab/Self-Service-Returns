import { getActiveTranslations, getDefaultTranslation } from "~/models/portalTranslation.server";
import { translations, DEFAULT_LOCALE } from "~/utils/portalTranslations";

/**
 * Parse Accept-Language header into an ordered list of locale codes.
 * E.g., "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7" → ["it-IT", "it", "en-US", "en"]
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [locale, q] = part.trim().split(";");
      return {
        locale: locale.trim(),
        quality: q ? parseFloat(q.split("=")[1]) : 1,
      };
    })
    .sort((a, b) => b.quality - a.quality)
    .map((item) => item.locale);
}

/**
 * Resolve the locale for a portal request.
 * Priority: 1) ?locale= URL param  2) shop default locale  3) browser Accept-Language  4) "en"
 */
export async function resolveLocale(
  shop: string,
  requestedLocale?: string | null,
  acceptLanguage?: string | null,
): Promise<string> {
  // 1. Explicit locale param takes priority
  if (requestedLocale) {
    // Validate against active locales for this shop
    if (shop) {
      try {
        const activeTranslations = await getActiveTranslations(shop);
        const activeCodes = activeTranslations.map(t => t.locale).filter(code => {
          // Ensure the locale is active (not disabled)
          const trans = activeTranslations.find(t => t.locale === code);
          return trans?.active !== false;
        });
        if (activeCodes.length > 0 && !activeCodes.includes(requestedLocale)) {
          // Fall through to other resolution methods
        } else {
          return requestedLocale;
        }
      } catch {
        return requestedLocale;
      }
    } else {
      return requestedLocale;
    }
  }
  // 2. Shop's configured default locale
  if (shop) {
    try {
      const defaultTrans = await getDefaultTranslation(shop);
      if (defaultTrans) return defaultTrans.locale;
    } catch {
      // DB not available — fall through
    }
  }
  // 3. Browser Accept-Language detection
  if (acceptLanguage) {
    const { getBestLocale } = await import("~/utils/portalTranslations");
    const preferredLocales = parseAcceptLanguage(acceptLanguage);
    const detected = getBestLocale(preferredLocales);
    if (detected !== "en") return detected; // Only override if we detect something non-default
    return detected;
  }
  // 4. English fallback
  return "en";
}

/**
 * Load merged translation messages for a locale.
 * Static defaults (from bundled files) are merged with DB overrides.
 * DB values take precedence.
 */
export async function loadTranslationMessages(
  shop: string,
  locale: string,
): Promise<Record<string, string>> {
  // 1. Load static defaults for this locale
  const staticMessages = translations[locale] || translations[DEFAULT_LOCALE];

  // 2. Merge with DB overrides (if any)
  if (shop) {
    try {
      const dbTranslation = await getActiveTranslations(shop);
      const match = dbTranslation.find((t) => t.locale === locale);
      if (match && typeof match.messages === "object" && match.messages !== null) {
        const dbMessages = match.messages as Record<string, string>;
        // DB overrides take precedence
        return { ...staticMessages, ...dbMessages };
      }
    } catch {
      // DB not available — use static only
    }
  }

  return staticMessages;
}

/**
 * Get the list of active locales for a shop.
 * Returns active DB locales if configured, otherwise all supported locales.
 */
export async function getActiveLocalesForShop(shop: string): Promise<string[]> {
  if (!shop) return ["en"];
  try {
    const active = await getActiveTranslations(shop);
    if (active.length > 0) {
      return active.map((t) => t.locale);
    }
  } catch {
    // DB not available
  }
  return ["en"];
}

/**
 * Get active locales for a shop with their native names.
 * Returns an array of { code, nativeName } sorted by native name.
 */
export async function getActiveLocalesWithNames(shop: string): Promise<Array<{ code: string; nativeName: string }>> {
  const { SUPPORTED_LOCALES } = await import("~/utils/portalTranslations");
  const activeCodes = await getActiveLocalesForShop(shop);
  return activeCodes
    .map((code) => {
      const info = SUPPORTED_LOCALES.find((l) => l.code === code);
      return info ? { code: info.code, nativeName: info.nativeName } : { code, nativeName: code };
    })
    .sort((a, b) => a.nativeName.localeCompare(b.nativeName));
}
