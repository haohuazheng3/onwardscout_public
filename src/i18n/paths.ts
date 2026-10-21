import { DEFAULT_LOCALE, isLocale, type Locale } from "./routing";

/*
 * Pure path helpers shared by the language switcher, the sign-in page and SEO code.
 * "Path" here always means the URL path WITHOUT the locale prefix ("/pricing"), and
 * "href" the URL a browser should load ("/zh/pricing").
 */

/** Programmatic SEO pages and the blog exist in English only; `/zh/...` redirects to them. */
export const ENGLISH_ONLY_PREFIXES = ["/opportunities", "/careers", "/organizations", "/guides", "/blog"] as const;

function normalisePath(path: string): string {
  if (!path) return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") || "/" : "/";
}

/** "/zh/pricing" → { locale: "zh", path: "/pricing" }; "/en" → { locale: "en", path: "/" }; "/pricing" → en. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const p = normalisePath(pathname);
  const seg = p.split("/")[1] ?? "";
  if (isLocale(seg)) {
    const rest = p.slice(seg.length + 1);
    return { locale: seg, path: normalisePath(rest) };
  }
  return { locale: DEFAULT_LOCALE, path: p };
}

export function isEnglishOnlyPath(path: string): boolean {
  const p = normalisePath(path);
  return ENGLISH_ONLY_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * The URL of `path` in `locale`. English has no prefix; English-only pages always resolve
 * to their English URL (their `/zh` variant would only redirect there).
 */
export function localizePath(path: string, locale: Locale): string {
  const p = normalisePath(path);
  if (locale === DEFAULT_LOCALE || isEnglishOnlyPath(p)) return p;
  return p === "/" ? `/${locale}` : `/${locale}${p}`;
}

/**
 * Where the language switcher sends a visitor who is on `pathname` (as the browser shows
 * it, prefix included) and picks `target`. The path is kept; an English-only page has no
 * Chinese version, so choosing Chinese there opens the Chinese home page instead (and the
 * switcher says so) rather than bouncing back to the same English URL.
 */
export function switchLocaleHref(
  pathname: string,
  target: Locale,
  extras: { search?: string; hash?: string } = {},
): { href: string; englishOnly: boolean } {
  const { path } = splitLocale(pathname);
  const englishOnly = isEnglishOnlyPath(path);
  const suffix = `${extras.search && extras.search !== "?" ? (extras.search.startsWith("?") ? extras.search : `?${extras.search}`) : ""}${
    extras.hash && extras.hash !== "#" ? (extras.hash.startsWith("#") ? extras.hash : `#${extras.hash}`) : ""
  }`;
  if (englishOnly && target !== DEFAULT_LOCALE) return { href: localizePath("/", target), englishOnly };
  return { href: `${localizePath(path, target)}${suffix}`, englishOnly };
}

const SIGN_IN_RE = /^\/(?:[a-z]{2}\/)?sign-in(?:[/?#]|$)/;

/**
 * Accepts only a same-site destination for after sign-in: a path ("/app/scout?x=1") or an
 * absolute URL on `siteOrigin`. Rejects other origins, protocol-relative and backslash
 * tricks, `javascript:`, API routes and the sign-in page itself (no loops). Returns the
 * path + search + hash, or null.
 */
export function safeRedirectPath(raw: unknown, opts: { siteOrigin?: string } = {}): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;

  let url: URL;
  const base = "https://onwardscout.invalid";
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    if (url.origin !== base) return null;
  } else {
    const allowed = opts.siteOrigin ? safeOrigin(opts.siteOrigin) : null;
    if (!allowed || url.origin !== allowed) return null;
  }

  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (SIGN_IN_RE.test(path)) return null;
  if (path === "/api" || path.startsWith("/api/")) return null;
  return path;
}

function safeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

/**
 * A redirect target in the visitor's language: an unprefixed path is prefixed for Chinese
 * (unless English-only); a path that already names a locale is left alone; "/en/x" is
 * normalised to "/x".
 */
export function localizeRedirect(path: string, locale: Locale): string {
  const match = /^([^?#]*)(.*)$/.exec(path);
  const pathname = match?.[1] ?? path;
  const rest = match?.[2] ?? "";
  const seg = normalisePath(pathname).split("/")[1] ?? "";
  if (isLocale(seg)) {
    const { locale: given, path: bare } = splitLocale(pathname);
    return `${localizePath(bare, given)}${rest}`;
  }
  return `${localizePath(pathname, locale)}${rest}`;
}
