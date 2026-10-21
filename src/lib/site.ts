/**
 * Brand constants and site-wide path rules. Everything user-facing that names the brand reads
 * from here, so the entity stays consistent across pages, schema.org data and notifications.
 * Pure (no imports): safe in the proxy, client components and tests.
 */

export type Locale = "en" | "zh";
export const LOCALES: readonly Locale[] = ["en", "zh"];
export const DEFAULT_LOCALE: Locale = "en";

/** Canonical origin for this deployment (no trailing slash). */
export function siteUrl(vars: Record<string, string | undefined> = process.env): string {
  const explicit = vars.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  // Preview deployments get their own origin so Clerk redirects and Stripe return URLs resolve.
  const vercel = vars.VERCEL_URL?.trim();
  if (vercel && vars.VERCEL_ENV !== "production") return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "https://onwardscout.com";
}

export const SITE = {
  name: "Onward Scout",
  legalName: "Onward Scout",
  domain: "onwardscout.com",
  url: siteUrl(),
  tagline: "Your scout for every opportunity.",
  description:
    "Onward Scout turns the résumé, deck or portfolio you already have into a sourced profile, finds real jobs, investors, grants, competitions and programs you can win, and prepares each application for you to approve with a tap.",
  email: "contact@onwardscout.com",
  supportEmail: "support@onwardscout.com",
  replyTime: "We reply to every message within two business days.",
  foundingYear: 2026,
  locale: "en_US",
} as const;

/** Chinese brand copy for metadata defaults and JSON-LD on /zh pages (the name stays "Onward Scout"). */
export const SITE_ZH = {
  tagline: "替你争取每一个机会的侦察兵。",
  description:
    "Onward Scout 把你已有的简历、商业计划书或作品集整理成有出处的个人档案，找到你能争取到的真实岗位、投资、基金、比赛与项目，并把每一份申请准备好，你只需点一下确认。",
  replyTime: "每一条留言我们都会在两个工作日内回复。",
  locale: "zh_CN",
} as const;

/** Pages that must never be indexed or listed in the sitemap (robots disallow + noindex). */
export const PRIVATE_PATHS = [
  "/app",
  "/checkout",
  "/admin",
  "/sign-in",
  "/api/",
  "/sandbox/",
  "/zh/app",
  "/zh/checkout",
  "/zh/admin",
  "/zh/sign-in",
] as const;

/** Last substantive edit of the evergreen pages (legal, FAQ, pricing); used as `dateModified`. */
export const CONTENT_UPDATED = "2026-10-21";

/* ---------- path rules shared by the proxy, requireUser and tests ---------- */

/** The locale a request path is written in: `/zh` and `/zh/...` are Chinese, everything else English. */
export function localeOfPath(pathname: string): Locale {
  return pathname === "/zh" || pathname.startsWith("/zh/") ? "zh" : "en";
}

/** The path without its locale prefix: `/zh/app/scout` → `/app/scout`, `/zh` → `/`. */
export function stripLocale(pathname: string): string {
  if (pathname === "/zh" || pathname === "/en") return "/";
  if (pathname.startsWith("/zh/") || pathname.startsWith("/en/")) return pathname.slice(3);
  return pathname;
}

/** `/app/scout` written for a locale: English has no prefix, Chinese gets `/zh`. */
export function withLocale(locale: Locale, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (locale === "en") return p;
  return p === "/" ? "/zh" : `/zh${p}`;
}

/** The signed-in area (`/app/**`, `/checkout/**`), in either locale. */
export function isPersonalPagePath(pathname: string): boolean {
  return /^\/(?:app|checkout)(?:\/|$)/.test(stripLocale(pathname));
}

/**
 * Pages of the signed-in area that also work signed out: the onboarding wizard `/app/start`
 * (contracts §8 — a visitor's uploads live in an anonymous draft named by the `os_anon` cookie
 * until they sign in and claim it). The proxy lets them through without a session.
 */
export function isAnonymousStartPath(pathname: string): boolean {
  return /^\/app\/start\/?$/.test(stripLocale(pathname));
}

/** The admin area: pages in either locale and `/api/admin/**`. */
export function isAdminPath(pathname: string): boolean {
  return /^\/admin(?:\/|$)/.test(stripLocale(pathname)) || /^\/api\/admin(?:\/|$)/.test(pathname);
}

/** The sign-in flow (Clerk's path routing lives below it), in either locale. */
export function isSignInPath(pathname: string): boolean {
  return /^\/sign-in(?:\/|$)/.test(stripLocale(pathname));
}

/**
 * APIs that act for the signed-in user. The proxy answers 401 JSON without a session; every
 * handler re-checks with `requireUserApi()` and scopes its queries by user id.
 */
export const PERSONAL_API_PREFIXES = [
  "/api/me",
  "/api/profile",
  "/api/uploads",
  "/api/goals",
  "/api/documents",
  "/api/opportunities",
  "/api/matches",
  "/api/applications",
  "/api/integrations",
  "/api/checkout",
  "/api/stripe/portal",
  "/api/settings",
  "/api/notifications",
] as const;

/**
 * Paths under a personal prefix that authenticate themselves and must work signed out: the
 * one-click unsubscribe link in product email (RFC 8058; HMAC token in the URL).
 * `/api/drafts/**` (the anonymous start) is deliberately not a personal prefix at all.
 */
export const PUBLIC_API_EXCEPTIONS = ["/api/notifications/unsubscribe"] as const;

const underPrefix = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

export function isPersonalApiPath(pathname: string): boolean {
  if (PUBLIC_API_EXCEPTIONS.some((p) => underPrefix(pathname, p))) return false;
  return PERSONAL_API_PREFIXES.some((p) => underPrefix(pathname, p));
}

/** Request header the proxy sets on personal pages: the original path + query, for return URLs. */
export const RETURN_PATH_HEADER = "x-onward-path";

/** The localized sign-in URL (path + query) that returns to `back` afterwards. */
export function signInPath(locale: Locale, back?: string | null): string {
  const base = withLocale(locale, "/sign-in");
  if (!back || !isSafeReturnPath(back)) return base;
  return `${base}?redirect_url=${encodeURIComponent(back)}`;
}

/** Only same-site absolute paths may be used as a return target (no `//evil`, no schemes). */
export function isSafeReturnPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !/[\r\n]/.test(p);
}

/* ---------- reply drop-boxes: in+<token>@onwardscout.com ---------- */

/** Tokens are 16 characters of the lowercase id alphabet (see users.inbound_token). */
export const INBOUND_TOKEN_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;

/** The address a user forwards replies to; mail there is attached to their message threads. */
export function inboundAddress(token: string): string {
  return `in+${token}@${SITE.domain}`;
}

/**
 * The drop-box token in a recipient address, or null when the address is not a drop-box of this
 * domain. Case-insensitive (mail systems may change the case of the local part).
 */
export function inboundTokenFrom(address: string | null | undefined, domain: string = SITE.domain): string | null {
  if (!address) return null;
  const bare = (/<([^>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf("@");
  if (at < 0 || bare.slice(at + 1) !== domain.toLowerCase()) return null;
  const local = bare.slice(0, at);
  if (!local.startsWith("in+")) return null;
  const token = local.slice(3);
  return INBOUND_TOKEN_PATTERN.test(token) ? token : null;
}
