import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import en from "~/utils/portalTranslations/en";

interface TranslationContextValue {
  locale: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDate: (date: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatCurrency: (amount: number | string, currency?: string) => string;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

/**
 * Interpolate {{variable}} placeholders in a translated string.
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
  });
}

interface TranslationProviderProps {
  locale: string;
  messages: Record<string, string>;
  children: ReactNode;
}

export function TranslationProvider({ locale, messages, children }: TranslationProviderProps) {
  const t = (key: string, vars?: Record<string, string | number>): string => {
    // Bug #454 Fix: Fall back to English if key missing in current locale
    const template = messages[key] ?? (locale !== "en" ? en[key] : undefined) ?? key;
    return interpolate(template, vars);
  };

  const formatDate = (date: string | Date, options?: Intl.DateTimeFormatOptions): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "—";
    const defaultOptions: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...options,
    };
    return d.toLocaleDateString(locale, defaultOptions);
  };

  const formatCurrency = (amount: number | string, currency: string = "USD"): string => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    // Bug #8 Fix: Return placeholder instead of silently converting NaN to $0.00
    if (isNaN(num) || !isFinite(num)) {
      console.warn(`formatCurrency received NaN or Infinity value: ${amount}`);
      return "—";
    }
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(num);
  };

  return (
    <TranslationContext.Provider value={{ locale, t, formatDate, formatCurrency }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    // Fallback when not wrapped — return identity functions
    return {
      locale: "en",
      t: (key: string) => key,
      formatDate: (date: string | Date) => new Date(typeof date === "string" ? date : date).toLocaleDateString("en-US"),
      formatCurrency: (amount: number | string) => {
        const num = typeof amount === "string" ? parseFloat(amount) : amount;
        // Bug #8 Fix: Return placeholder instead of silently converting NaN to $0.00
        if (isNaN(num) || !isFinite(num)) return "—";
        return `$${num.toFixed(2)}`;
      },
    };
  }
  return ctx;
}
