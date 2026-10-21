import { defineRouting } from "next-intl/routing";

/**
 * Locale routing for the whole site (no middleware: next.config.ts rewrites map the
 * prefix-less English URLs onto the `[locale]` segment).
 *
 *   English  → no prefix   (/pricing)
 *   Chinese  → /zh prefix  (/zh/pricing)
 *
 * `localeDetection: false`: the URL alone decides the language. The language switcher
 * stores an explicit choice in the NEXT_LOCALE cookie, which only the proxy reads (for
 * `/app*` without a prefix).
 */
export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const LOCALES = routing.locales;
export const DEFAULT_LOCALE: Locale = routing.defaultLocale;

/** Cookie the language switcher writes and the proxy reads. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** BCP 47 tag for `<html lang>`, `hreflang`, Intl and Clerk. */
export const HTML_LANG: Record<Locale, string> = { en: "en", zh: "zh-CN" };

/** Open Graph locale. */
export const OG_LOCALE: Record<Locale, string> = { en: "en_US", zh: "zh_CN" };

/** The language's own name, shown in the switcher (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", zh: "中文" };

/** Short form for compact switchers. */
export const LOCALE_SHORT: Record<Locale, string> = { en: "EN", zh: "中" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}
