import NextLink from "next/link";
import { createNavigation } from "next-intl/navigation";
import { createElement, type ComponentProps } from "react";
import { routing } from "./routing";

/**
 * Locale-aware navigation. Always import `Link`, `redirect`, `permanentRedirect`,
 * `usePathname`, `useRouter` and `getPathname` from here for internal pages, never from
 * `next/link` / `next/navigation` (route handlers and external links excepted).
 *
 *   <Link href="/pricing" />                     → "/pricing" (en) or "/zh/pricing" (zh)
 *   <Link href="/blog" locale="en" />            → always "/blog" (English-only pages), from any locale
 *   usePathname()                                → path WITHOUT the locale prefix
 *   getPathname({ href: "/app", locale: "zh" })  → "/zh/app"
 *   permanentRedirect({ href: "/blog/x", locale: "en" }) → "/blog/x" (zh → English-only page)
 */
const nav = createNavigation(routing);

export const { redirect, permanentRedirect, usePathname, useRouter, getPathname } = nav;

type IntlLinkProps = ComponentProps<typeof nav.Link>;

/**
 * next-intl's Link, except for links to the default locale (`locale="en"`, used for the
 * English-only SEO pages). next-intl forces a prefix whenever `locale` is passed ("/en/blog"),
 * which here is a 308 hop (next.config redirects /en/* → /*) on every such link, and it would
 * also rewrite the visitor's NEXT_LOCALE cookie to "en" on click (a zh reader opening an
 * English-only guide has not switched their language). Those links render a plain Next link
 * to the canonical unprefixed URL instead. Isomorphic: works in server and client components.
 *
 * Any link that names a locale explicitly is NOT prefetched (unless the caller asks): each
 * locale has its own root layout ([locale]/layout.tsx), and the App Router re-requests a
 * prefetch whose root layout differs from the current one in an endless loop (measured on
 * production: ~120 RSC requests per second from /zh pages to /blog). Crossing root layouts is a
 * full page load anyway, so prefetching it buys nothing.
 */
export function Link(props: IntlLinkProps) {
  const { href, locale } = props;
  const internal = typeof href !== "string" || href.startsWith("/");
  if (locale === routing.defaultLocale && internal) {
    const rest: Record<string, unknown> = { ...props };
    delete rest.locale;
    // With localePrefix "as-needed" the default locale's URL is the href itself, unprefixed.
    return createElement(NextLink, {
      ...(rest as unknown as ComponentProps<typeof NextLink>),
      prefetch: (rest.prefetch as boolean | null | undefined) ?? false,
      hrefLang: (rest.hrefLang as string | undefined) ?? "en",
    });
  }
  if (locale !== undefined && props.prefetch === undefined) return createElement(nav.Link, { ...props, prefetch: false });
  return createElement(nav.Link, props);
}
