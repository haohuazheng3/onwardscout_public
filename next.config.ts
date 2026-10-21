import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isDev = process.env.NODE_ENV !== "production";
const indexable = process.env.VERCEL_ENV === "production" && process.env.SITE_INDEXABLE === "1";

/* ------------------------------------------------------------------ locale routing */

/*
 * i18n without middleware: every page lives under src/app/[locale]/…; English
 * URLs carry no prefix (/pricing), Chinese URLs are /zh/pricing. The prefix-less → /en mapping is
 * a beforeFiles rewrite, so marketing pages stay static and never pass through the proxy.
 *
 * Paths that are NOT locale pages are excluded from the rewrite: the locale prefixes themselves,
 * /api, Next's own /_next and Vercel's /_vercel, the sandbox form, root-level route handlers
 * (/og/… images) and file-based metadata routes (/opengraph-image, /twitter-image, /icon,
 * /apple-icon, with or without a hash suffix). Anything with a dot (/sitemap.xml, /robots.txt,
 * /llms.txt, /brand/logo.png, /.well-known/…) is a file and never rewritten.
 */
export const LOCALE_REWRITE_SOURCE =
  "/:path((?!(?:en|zh|api|_next|_vercel|sandbox|og)(?:/|$)|(?:opengraph-image|twitter-image|icon|apple-icon)(?:[/-]|$))[^.]*)";

export const LOCALE_REWRITES = [
  { source: "/", destination: "/en" },
  { source: LOCALE_REWRITE_SOURCE, destination: "/en/:path" },
];

export const LOCALE_REDIRECTS = [
  // /en is never a public URL: English lives at the root.
  { source: "/en", destination: "/", permanent: true },
  { source: "/en/:path*", destination: "/:path*", permanent: true },
  // Sign-in and sign-up are one flow.
  { source: "/sign-up", destination: "/sign-in", permanent: false },
  { source: "/sign-up/:path*", destination: "/sign-in", permanent: false },
  { source: "/zh/sign-up", destination: "/zh/sign-in", permanent: false },
  { source: "/zh/sign-up/:path*", destination: "/zh/sign-in", permanent: false },
  { source: "/login", destination: "/sign-in", permanent: false },
  { source: "/zh/login", destination: "/zh/sign-in", permanent: false },
  { source: "/dashboard", destination: "/app", permanent: false },
  { source: "/zh/dashboard", destination: "/zh/app", permanent: false },
];

/* ------------------------------------------------------------------ security headers */

const CLERK = ["https://clerk.onwardscout.com", "https://*.clerk.accounts.dev", "https://*.clerk.com", "https://img.clerk.com"];
const CLERK_WS = ["wss://clerk.onwardscout.com", "wss://*.clerk.accounts.dev"];
// Clerk development instances report SDK telemetry; blocking it only adds console noise.
const CLERK_TELEMETRY = ["https://clerk-telemetry.com"];
const STRIPE = ["https://js.stripe.com", "https://checkout.stripe.com", "https://api.stripe.com", "https://m.stripe.network"];
// FlowGlance loads from flowglance.com and posts to collect.flowglance.com (a blocked collector silently loses all analytics).
const FLOWGLANCE = ["https://flowglance.com", "https://*.flowglance.com"];
// Clerk's bot protection (Cloudflare Turnstile) on the sign-in form.
const TURNSTILE = ["https://challenges.cloudflare.com"];
// Private files worker: document previews (img/frame), downloads, browser uploads (connect).
const FILES = ["https://files.onwardscout.com"];
// Gmail connect (CH4): the OAuth consent page is reached by a form post + redirect.
const GOOGLE_OAUTH = ["https://accounts.google.com"];

// Pages are statically generated (no per-request nonce), so Next's inline bootstrap needs 'unsafe-inline'.
export const CSP = [
  ["default-src", "'self'"],
  ["script-src", "'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...CLERK, ...STRIPE, ...FLOWGLANCE, ...TURNSTILE],
  ["style-src", "'self'", "'unsafe-inline'"],
  ["img-src", "'self'", "data:", "blob:", ...CLERK.slice(3), ...FILES, ...STRIPE, ...FLOWGLANCE],
  ["font-src", "'self'", "data:"],
  ["connect-src", "'self'", ...CLERK, ...CLERK_WS, ...CLERK_TELEMETRY, ...STRIPE, ...FLOWGLANCE, ...TURNSTILE, ...FILES, ...(isDev ? ["ws:", "http://localhost:*"] : [])],
  ["frame-src", "'self'", ...STRIPE.slice(0, 2), ...TURNSTILE, ...CLERK.slice(0, 3), ...FILES],
  ["worker-src", "'self'", "blob:"],
  ["media-src", "'self'", "blob:", ...FILES],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'", "https://checkout.stripe.com", ...CLERK.slice(0, 2), ...GOOGLE_OAUTH],
  ["frame-ancestors", "'none'"],
  ...(isDev ? [] : [["upgrade-insecure-requests"]]),
]
  .map((d) => d.join(" "))
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self "https://js.stripe.com")' },
  // Until launch every environment says noindex at the header level as well as in <meta>.
  ...(indexable ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
];

/** Programmatic SEO pages are ISR (revalidate = 3600): let the CDN serve them for an hour, stale for a day. */
const ISR_CACHE = [{ key: "Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" }];

/* ------------------------------------------------------------------ config */

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Most visitors arrive once from search: ship the (small, atomic) CSS inside the HTML
  // instead of a render-blocking stylesheet request.
  experimental: { inlineCss: true },
  // `next dev` would otherwise write an agent-instructions markdown file into the project root.
  agentRules: false,
  // The browser agent (CH3) runs headless Chromium inside a function, and PDF ingest loads
  // pdf.js's worker and the native canvas binding at runtime: keep all of them out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core", "pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "files.onwardscout.com" },
    ],
  },
  // Files read from disk at runtime (message catalogs, blog MDX, seed data) must ship with the
  // functions. Keys are picomatch globs over the route ("/[locale]/pricing"), so brackets are escaped.
  outputFileTracingIncludes: {
    "/**": ["./messages/**/*.json"],
    "/\\[locale\\]/**": ["./content/**/*"],
    "/api/**": ["./content/**/*"],
    "/sitemap.xml": ["./content/**/*"],
    "/llms.txt": ["./content/**/*"],
    "/og/**": ["./content/**/*"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/brand/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
      { source: "/opportunities/:path*", headers: ISR_CACHE },
      { source: "/careers/:path*", headers: ISR_CACHE },
      { source: "/organizations/:path*", headers: ISR_CACHE },
      { source: "/guides/:path*", headers: ISR_CACHE },
    ];
  },
  async redirects() {
    return LOCALE_REDIRECTS;
  },
  async rewrites() {
    return { beforeFiles: LOCALE_REWRITES, afterFiles: [], fallback: [] };
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
