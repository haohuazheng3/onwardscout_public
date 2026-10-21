import { clerkClient, clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import {
  isAdminPath,
  isAnonymousStartPath,
  isPersonalApiPath,
  isPersonalPagePath,
  isSignInPath,
  localeOfPath,
  RETURN_PATH_HEADER,
  signInPath,
} from "@/lib/site";

/*
 * Runs only on the signed-in area and the APIs (see `config.matcher`); marketing, SEO and blog
 * pages never pass through here and are served straight from the CDN cache (cost rule: no
 * site-wide middleware). Paths are seen BEFORE next.config's locale rewrites, so English is
 * `/app/...` and Chinese `/zh/app/...`.
 *
 *  - /app and /checkout (both locales) require a session: pages → localized /sign-in with a
 *    return URL, and `Cache-Control: private, no-store`;
 *  - /admin (both locales) and /api/admin require a verified email from ADMIN_EMAILS and are a
 *    real 404 for everyone else;
 *  - /app/start (both locales) is the exception: the onboarding wizard works signed out (an
 *    anonymous draft, contracts §8), so it passes with Clerk attached but no session required;
 *    its APIs live under /api/drafts/**, which is not a personal prefix;
 *  - the personal APIs (PERSONAL_API_PREFIXES in src/lib/site.ts) answer 401 JSON without a session;
 *  - every other API (health, errors, geo, contact, webhooks, cron, inbox…) passes through, with
 *    Clerk attached so handlers may still call auth();
 *  - a visitor whose language switcher set NEXT_LOCALE=zh is sent from /app… to /zh/app….
 */

const NO_STORE = "private, no-store";

/** Positive and negative verdicts from a successful Clerk lookup, keyed by user and by the current allow-list. */
const adminCache = new Map<string, { ok: boolean; at: number }>();
const ADMIN_CACHE_MS = 5 * 60 * 1000;

async function isAdminUser(userId: string): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return false;
  const key = `${userId}|${allowed.join(",")}`;
  const hit = adminCache.get(key);
  if (hit && Date.now() - hit.at < ADMIN_CACHE_MS) return hit.ok;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const ok = u.emailAddresses.some((e) => e.verification?.status === "verified" && allowed.includes(e.emailAddress.toLowerCase()));
    if (adminCache.size > 500) adminCache.clear();
    adminCache.set(key, { ok, at: Date.now() });
    return ok;
  } catch (e) {
    // A transient Clerk failure refuses this request only; it is never remembered as "not an admin".
    console.error("[proxy] admin lookup failed", e);
    return false;
  }
}

function isApi(req: NextRequest): boolean {
  return req.nextUrl.pathname.startsWith("/api/");
}

function needsSession(pathname: string): boolean {
  if (isAnonymousStartPath(pathname)) return false;
  return isPersonalPagePath(pathname) || isAdminPath(pathname) || isPersonalApiPath(pathname);
}

/**
 * Rewrite to a path no route serves, already in its locale segment (/en/… or /zh/…, so it never
 * depends on the next.config locale rewrite): the [locale] catch-all renders the localized 404
 * page with a real 404 status.
 */
function notFoundPage(req: NextRequest): NextResponse {
  const res = NextResponse.rewrite(new URL(`/${localeOfPath(req.nextUrl.pathname)}/__not-found`, req.url));
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

function notFoundJson(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function returnPath(req: NextRequest): string {
  return `${req.nextUrl.pathname}${req.nextUrl.search}`;
}

function toSignIn(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL(signInPath(localeOfPath(req.nextUrl.pathname), returnPath(req)), req.url));
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

/** Let a page through with the return path available to server components (requireUser). */
function passPage(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(RETURN_PATH_HEADER, returnPath(req));
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

/** /app… with the Chinese UI chosen → the same page under /zh (before any auth work). */
function localeRedirect(req: NextRequest): NextResponse | null {
  const { pathname, search } = req.nextUrl;
  if (req.cookies.get("NEXT_LOCALE")?.value !== "zh") return null;
  if (!/^\/app(?:\/|$)/.test(pathname)) return null;
  return NextResponse.redirect(new URL(`/zh${pathname}${search}`, req.url), 307);
}

function unavailable(req: NextRequest, retryAfter: number, message: string): NextResponse {
  const { pathname } = req.nextUrl;
  // The admin area's existence is never revealed, not even by a 503.
  if (isAdminPath(pathname)) return isApi(req) ? notFoundJson() : notFoundPage(req);
  if (isApi(req)) {
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } });
  }
  return new NextResponse(message, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}

const withClerk = clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  try {
    if (!needsSession(pathname)) {
      // The signed-out start: a personal page all the same (never cached, return path known).
      if (isAnonymousStartPath(pathname)) return passPage(req);
      // Sign-in pages and public APIs: Clerk is attached; sign-in pages are never cached.
      if (isSignInPath(pathname)) {
        const res = NextResponse.next();
        res.headers.set("Cache-Control", NO_STORE);
        return res;
      }
      return NextResponse.next();
    }
    const { userId } = await auth();
    if (!userId) {
      if (isAdminPath(pathname)) return isApi(req) ? notFoundJson() : notFoundPage(req);
      if (isApi(req)) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
      return toSignIn(req);
    }
    if (isAdminPath(pathname) && !(await isAdminUser(userId))) {
      return isApi(req) ? notFoundJson() : notFoundPage(req);
    }
    if (isApi(req)) return NextResponse.next();
    return passPage(req);
  } catch (err) {
    // Auth could not be established: never let the request through.
    console.error("[proxy] failed", err);
    return unavailable(req, 30, "Sign-in is temporarily unavailable. Please try again in a moment.");
  }
});

/**
 * Degraded mode: without CLERK_SECRET_KEY everything public keeps working (health, webhooks,
 * contact, sandbox…) and the signed-in area answers a clear 503 instead of crashing.
 */
export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  const redirect = localeRedirect(req);
  if (redirect) return redirect;
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { pathname } = req.nextUrl;
    // The whole (app) area renders inside ClerkProvider, the signed-out start included.
    if (needsSession(pathname) || isSignInPath(pathname) || isAnonymousStartPath(pathname)) {
      return unavailable(req, 300, "Sign-in is being set up. Please try again in a few minutes.");
    }
    return NextResponse.next();
  }
  return withClerk(req, ev);
}

export const config = {
  matcher: [
    "/app/:path*",
    "/checkout/:path*",
    "/admin/:path*",
    "/sign-in/:path*",
    "/zh/app/:path*",
    "/zh/checkout/:path*",
    "/zh/admin/:path*",
    "/zh/sign-in/:path*",
    "/api/:path*",
  ],
};
