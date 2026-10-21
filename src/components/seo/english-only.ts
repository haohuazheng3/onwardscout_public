import "server-only";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { permanentRedirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * The first call of every English-only page (/opportunities, /careers, /organizations,
 * /guides, /blog): validates the locale, sets it for static rendering, and answers a /zh/…
 * request with a permanent redirect to the English URL (`path` is the unprefixed path).
 */
export function englishOnly(locale: string, path: string): void {
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  if (locale !== routing.defaultLocale) permanentRedirect({ href: path, locale: routing.defaultLocale });
}

/**
 * generateStaticParams for English-only pages: the same list for every locale. Returning [] for
 * zh made Next 16 pass the parent's {locale:"zh"} through as an incomplete path, which disables
 * prerendering for the WHOLE route (English included). The zh entries prerender as the cached
 * 308 to the English URL (`englishOnly` redirects before any data is read).
 */
export function forEnglish<T>(_locale: string | undefined, make: () => T[]): T[] {
  return make();
}
