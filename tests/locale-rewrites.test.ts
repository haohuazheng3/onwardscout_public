import { describe, expect, it, vi } from "vitest";
// Next's own route machinery: the regex it compiles for Vercel's routing table, the matcher its
// server uses, and the destination compiler. Testing through them proves what production does.
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { checkCustomRoutes } from "next/dist/lib/load-custom-routes";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { LOCALE_REDIRECTS, LOCALE_REWRITE_SOURCE, LOCALE_REWRITES } from "../next.config";
import {
  inboundAddress,
  inboundTokenFrom,
  isAdminPath,
  isAnonymousStartPath,
  isPersonalApiPath,
  isPersonalPagePath,
  isSafeReturnPath,
  isSignInPath,
  localeOfPath,
  PRIVATE_PATHS,
  signInPath,
  stripLocale,
  withLocale,
} from "@/lib/site";

type Rule = { source: string; destination: string; permanent?: boolean };

function apply(rules: Rule[], path: string): string | null {
  for (const rule of rules) {
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(path);
    if (params === false) continue;
    return prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params, query: {} }).newUrl;
  }
  return null;
}

/** What Vercel's routing table does with the regex Next compiles into routes-manifest.json. */
function vercelMatches(rule: Rule, type: "rewrite" | "redirect", path: string): boolean {
  const built = type === "rewrite" ? buildCustomRoute("rewrite", rule) : buildCustomRoute("redirect", { ...rule, permanent: rule.permanent ?? false }, ["/_next"]);
  return new RegExp(built.regex).test(path);
}

describe("next.config locale rules are valid Next.js routes", () => {
  it("pass Next's own validation", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`invalid custom routes (exit ${code})`);
    }) as never);
    try {
      expect(() => checkCustomRoutes(LOCALE_REWRITES, "rewrite")).not.toThrow();
      expect(() => checkCustomRoutes(LOCALE_REDIRECTS, "redirect")).not.toThrow();
    } finally {
      exit.mockRestore();
    }
  });

  it("keep the documented source pattern (no dot, not en/zh/api/_next/sandbox)", () => {
    expect(LOCALE_REWRITE_SOURCE.startsWith("/:path((?!")).toBe(true);
    expect(LOCALE_REWRITE_SOURCE.endsWith("[^.]*)")).toBe(true);
  });
});

describe("beforeFiles rewrite: unprefixed English → /en", () => {
  const cases: [string, string | null][] = [
    ["/", "/en"],
    ["/pricing", "/en/pricing"],
    ["/how-it-works", "/en/how-it-works"],
    ["/app", "/en/app"],
    ["/app/scout", "/en/app/scout"],
    ["/app/scout/opp_k3v9q2m8x1d4f6h7", "/en/app/scout/opp_k3v9q2m8x1d4f6h7"],
    ["/opportunities/grants/some-grant", "/en/opportunities/grants/some-grant"],
    ["/sign-in", "/en/sign-in"],
    ["/sign-in/factor-one", "/en/sign-in/factor-one"],
    ["/admin/errors", "/en/admin/errors"],
    ["/__not-found", "/en/__not-found"],
    ["/english-teachers", "/en/english-teachers"], // starts with "en" but is not the /en segment
    ["/zhongwen-guide", "/en/zhongwen-guide"],
    ["/icons-guide", "/en/icons-guide"],
    ["/apis", "/en/apis"],
    // not locale pages: left alone
    ["/zh", null],
    ["/zh/pricing", null],
    ["/en", null],
    ["/en/pricing", null],
    ["/api/health", null],
    ["/api", null],
    ["/_next/static/chunks/app.js", null],
    ["/_vercel/insights/script.js", null],
    ["/sandbox/form", null],
    ["/og/post/guides/how-to-apply", null],
    ["/opengraph-image", null],
    ["/opengraph-image-1a2b3c", null],
    ["/twitter-image", null],
    ["/icon", null],
    ["/apple-icon", null],
    ["/sitemap.xml", null],
    ["/robots.txt", null],
    ["/llms.txt", null],
    ["/indexnow.txt", null],
    ["/manifest.webmanifest", null],
    ["/favicon.ico", null],
    ["/brand/logo.png", null],
    ["/.well-known/security.txt", null],
  ];

  it.each(cases)("%s → %s (Next server)", (path, expected) => {
    expect(apply(LOCALE_REWRITES, path)).toBe(expected);
  });

  it.each(cases)("%s rewritten on Vercel: %s", (path, expected) => {
    const hit = LOCALE_REWRITES.find((r) => vercelMatches(r, "rewrite", path));
    expect(Boolean(hit)).toBe(expected !== null);
  });

  it("never produces a double prefix", () => {
    for (const [path] of cases) {
      const once = apply(LOCALE_REWRITES, path);
      if (once) expect(apply(LOCALE_REWRITES, once)).toBeNull();
    }
  });
});

describe("redirects", () => {
  const cases: [string, string | null, boolean | undefined][] = [
    ["/en", "/", true],
    ["/en/pricing", "/pricing", true],
    ["/en/app/scout", "/app/scout", true],
    ["/sign-up", "/sign-in", false],
    ["/sign-up/verify", "/sign-in", false],
    ["/zh/sign-up", "/zh/sign-in", false],
    ["/login", "/sign-in", false],
    ["/zh/login", "/zh/sign-in", false],
    ["/dashboard", "/app", false],
    ["/zh/dashboard", "/zh/app", false],
    ["/pricing", null, undefined],
    ["/zh/pricing", null, undefined],
    ["/english", null, undefined],
  ];

  it.each(cases)("%s → %s", (path, expected, permanent) => {
    expect(apply(LOCALE_REDIRECTS, path)).toBe(expected);
    expect(LOCALE_REDIRECTS.some((r) => vercelMatches(r, "redirect", path))).toBe(expected !== null);
    if (expected) expect(LOCALE_REDIRECTS.find((r) => getPathMatch(r.source, { strict: true })(path) !== false)?.permanent).toBe(permanent);
  });
});

describe("path rules shared with the proxy", () => {
  it("knows the locale of a path and strips/adds it", () => {
    expect(localeOfPath("/zh/app")).toBe("zh");
    expect(localeOfPath("/zh")).toBe("zh");
    expect(localeOfPath("/zhongwen")).toBe("en");
    expect(localeOfPath("/app")).toBe("en");
    expect(stripLocale("/zh/app/scout")).toBe("/app/scout");
    expect(stripLocale("/zh")).toBe("/");
    expect(stripLocale("/pricing")).toBe("/pricing");
    expect(withLocale("zh", "/")).toBe("/zh");
    expect(withLocale("zh", "/pricing")).toBe("/zh/pricing");
    expect(withLocale("en", "/pricing")).toBe("/pricing");
  });

  it("classifies personal pages, admin, sign-in and personal APIs", () => {
    for (const p of ["/app", "/app/scout", "/zh/app", "/zh/app/applications/app_x", "/checkout/success", "/zh/checkout/success"]) expect(isPersonalPagePath(p)).toBe(true);
    for (const p of ["/apple", "/apps", "/application-guide", "/api/applications", "/pricing", "/zh/pricing"]) expect(isPersonalPagePath(p)).toBe(false);
    for (const p of ["/admin", "/admin/errors", "/zh/admin", "/api/admin/users"]) expect(isAdminPath(p)).toBe(true);
    for (const p of ["/administrator", "/api/administer"]) expect(isAdminPath(p)).toBe(false);
    expect(isSignInPath("/sign-in")).toBe(true);
    expect(isSignInPath("/zh/sign-in/factor-one")).toBe(true);
    expect(isSignInPath("/sign-inside")).toBe(false);
    for (const p of ["/api/me", "/api/applications/app_1/submit", "/api/opportunities", "/api/opportunities/import", "/api/stripe/portal", "/api/settings", "/api/notifications"]) expect(isPersonalApiPath(p)).toBe(true);
    for (const p of ["/api/opportunity", "/api/stripe/webhook", "/api/health", "/api/meetings", "/api/cron/jobs", "/api/contact", "/api/drafts/status", "/api/drafts/claim", "/api/notifications/unsubscribe"]) expect(isPersonalApiPath(p)).toBe(false);
    for (const p of ["/app/start", "/zh/app/start", "/app/start/"]) expect(isAnonymousStartPath(p)).toBe(true);
    for (const p of ["/app", "/app/starts", "/app/start/x", "/zh/app/profile"]) expect(isAnonymousStartPath(p)).toBe(false);
  });

  it("builds localized sign-in URLs with safe return paths only", () => {
    expect(signInPath("en", "/app/scout?tab=new")).toBe("/sign-in?redirect_url=%2Fapp%2Fscout%3Ftab%3Dnew");
    expect(signInPath("zh", "/zh/app")).toBe("/zh/sign-in?redirect_url=%2Fzh%2Fapp");
    expect(signInPath("en", "//evil.example/x")).toBe("/sign-in");
    expect(signInPath("en", "https://evil.example")).toBe("/sign-in");
    expect(isSafeReturnPath("/\\evil")).toBe(false);
  });

  it("lists every private area in both locales", () => {
    for (const p of ["/app", "/checkout", "/admin", "/sign-in", "/api/", "/sandbox/", "/zh/app", "/zh/checkout", "/zh/admin", "/zh/sign-in"]) {
      expect(PRIVATE_PATHS).toContain(p);
    }
  });
});

describe("reply drop-box addresses", () => {
  it("round-trip a token and reject look-alikes", () => {
    const token = "k3v9q2m8x1d4f6h7";
    expect(inboundAddress(token)).toBe("in+k3v9q2m8x1d4f6h7@onwardscout.com");
    expect(inboundTokenFrom(inboundAddress(token))).toBe(token);
    expect(inboundTokenFrom("Someone <IN+K3V9Q2M8X1D4F6H7@OnwardScout.com>")).toBe(token);
    expect(inboundTokenFrom("in+k3v9q2m8x1d4f6h7@evil.example")).toBeNull();
    expect(inboundTokenFrom("test@onwardscout.com")).toBeNull();
    expect(inboundTokenFrom("in+short@onwardscout.com")).toBeNull();
    expect(inboundTokenFrom("in+k3v9q2m8x1d4f6hi@onwardscout.com")).toBeNull(); // "i" is not in the alphabet
    expect(inboundTokenFrom(null)).toBeNull();
  });
});
