/**
 * Portal translations barrel file.
 * Imports all locale translations and exports utilities for i18n.
 */
import en from "./en";
import it from "./it";
import de from "./de";
import fr from "./fr";
import es from "./es";
import pt from "./pt";
import nl from "./nl";
import pl from "./pl";
import cs from "./cs";
import da from "./da";
import sv from "./sv";
import fi from "./fi";
import no from "./no";
import ro from "./ro";
import hu from "./hu";
import bg from "./bg";
import el from "./el";
import ja from "./ja";
import ko from "./ko";
import zh from "./zh";
import tr from "./tr";
import ar from "./ar";
import ru from "./ru";
import uk from "./uk";
import he from "./he";
import th from "./th";
import vi from "./vi";

export const DEFAULT_LOCALE = "en";

export const SUPPORTED_LOCALES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
];

export const translations: Record<string, Record<string, string>> = {
  en,
  it,
  de,
  fr,
  es,
  pt,
  nl,
  pl,
  cs,
  da,
  sv,
  fi,
  no,
  ro,
  hu,
  bg,
  el,
  ja,
  ko,
  zh,
  tr,
  ar,
  ru,
  uk,
  he,
  th,
  vi,
};

/**
 * Get translation for a key in the specified locale.
 * Falls back to English if the locale or key doesn't exist.
 */
export function t(
  key: string,
  locale: string = DEFAULT_LOCALE,
  replacements?: Record<string, string | number>
): string {
  const localeDict = translations[locale] || translations[DEFAULT_LOCALE];
  let message = localeDict[key] || translations[DEFAULT_LOCALE][key] || key;

  // Perform simple variable replacement
  if (replacements) {
    Object.entries(replacements).forEach(([varName, value]) => {
      // Use split/join instead of RegExp to avoid escaping issues
      let result = message;
      result = result.split(`{{${varName}}}`).join(String(value ?? ""));
      message = result;
    });
  }

  return message;
}

/**
 * Check if a locale is supported.
 */
export function isSupportedLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === locale);
}

/**
 * Get the best matching locale from a list of preferred locales.
 * Falls back to DEFAULT_LOCALE if no match is found.
 */
export function getBestLocale(preferredLocales: string[]): string {
  for (const preferred of preferredLocales) {
    // Try exact match first
    if (isSupportedLocale(preferred)) {
      return preferred;
    }
    // Try language-only match (e.g., "en-US" -> "en")
    const langOnly = preferred.split("-")[0];
    if (isSupportedLocale(langOnly)) {
      return langOnly;
    }
  }
  return DEFAULT_LOCALE;
}
