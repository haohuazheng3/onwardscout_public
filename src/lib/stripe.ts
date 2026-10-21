import "server-only";
import Stripe from "stripe";
import { env, IS_PRODUCTION_DEPLOY, VERCEL_ENV } from "./env";
import { SITE } from "./site";
import { OFFERS, type Sku } from "@/content/plans";

/*
 * The Stripe client and the server-side whitelist of everything a buyer reads on Stripe's pages.
 * Payments run through the owner's organization key (`sk_org…` in STRIPE_SECRET_KEY): Stripe only
 * accepts it together with a `Stripe-Context` header naming the account (STRIPE_CONTEXT). The API
 * version is pinned so webhook payloads and SDK types always agree.
 */

/** The API version every request, webhook endpoint and type in this code base speaks. */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

let client: Stripe | null = null;

/** An organization API key works for every account in the organization; it needs `Stripe-Context`. */
export function isOrgKey(key: string): boolean {
  return key.startsWith("sk_org");
}

/** The account every request acts on (`acct_…`). Required with an organization key. */
export function stripeContext(): string | undefined {
  return env("STRIPE_CONTEXT");
}

export function stripe(): Stripe {
  if (!client) {
    const key = env("STRIPE_SECRET_KEY");
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    const context = stripeContext();
    if (isOrgKey(key) && !context) throw new Error("STRIPE_CONTEXT (acct_…) is required with an organization key");
    client = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
      maxNetworkRetries: 2,
      appInfo: { name: SITE.domain },
      ...(context ? { stripeContext: context } : {}),
    });
  }
  return client;
}

/** Test-mode keys carry `_test_` in their prefix; live and organization keys are treated as live. */
export function stripeMode(): "live" | "test" | "missing" {
  const key = env("STRIPE_SECRET_KEY") ?? "";
  if (!key) return "missing";
  return key.includes("_test_") ? "test" : "live";
}

/**
 * When Stripe refused a call because the key lacks a permission (HTTP 403, `StripePermissionError`;
 * with an organization key each account's permissions are granted separately), the short reason
 * to record, e.g. "invoice_read (Invoices Read)". Null for every other error, which stays a failure.
 */
export function stripePermissionProblem(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { type?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const denied =
    e.type === "StripePermissionError" ||
    e.statusCode === 403 ||
    e.code === "permission_denied" ||
    /does not have the required permissions|^Permission denied\b/i.test(message);
  if (!denied) return null;
  // "… Enabling Invoices Read ('invoice_read') permissions on this key would allow this request to continue."
  const m = /Enabling (.+?) \('([a-z0-9_]+)'\) permissions?/i.exec(message);
  if (m) return `${m[2]} (${m[1].trim()})`;
  return message.slice(0, 200) || "permission denied";
}

/** Tag written into every session's metadata; the webhook ignores objects from other environments. */
export function stripeEnvTag(): string {
  return VERCEL_ENV;
}

/** Stripe price id for an offer, from the environment variable the offer names. */
export function priceIdFor(sku: Sku): string | undefined {
  return env(OFFERS[sku].priceEnv);
}

export type PaymentsBlock = "not_configured" | "price_missing" | "nonprod";

/**
 * Live keys only take money on the production deployment. Preview and local deployments refuse
 * to open a live Checkout unless ALLOW_LIVE_CHECKOUT_NONPROD=1 (a supervised test).
 */
export function paymentsEnabled(sku?: Sku): { ok: true } | { ok: false; code: PaymentsBlock; reason: string } {
  const mode = stripeMode();
  if (mode === "missing") return { ok: false, code: "not_configured", reason: "Payments are not configured yet." };
  if (sku && !priceIdFor(sku)) return { ok: false, code: "price_missing", reason: `The ${OFFERS[sku].name.en} price is not configured yet.` };
  if (mode === "live" && !IS_PRODUCTION_DEPLOY && env("ALLOW_LIVE_CHECKOUT_NONPROD") !== "1") {
    return { ok: false, code: "nonprod", reason: `Checkout only opens on ${SITE.domain}.` };
  }
  return { ok: true };
}

/**
 * The brand on Stripe Checkout. A server-side whitelist: the browser never chooses which name,
 * colour or card-statement text appears on a payment page.
 */
export const CHECKOUT_BRAND = {
  /** `metadata.site` on every product, price, customer, session and subscription we create. */
  site: "onwardscout",
  /** Text at the top of Checkout (with the small icon below, never a logo image). */
  displayName: "Onward Scout",
  /** The blaze-orange accent of the site. */
  buttonColor: "#E4572E",
  /** Square brand mark next to the name (Stripe fetches it from our own domain). */
  iconUrl: `${SITE.url}/brand/logo-512.png`,
  /**
   * Our name on card statements after the account's fixed prefix: "<PREFIX>* ONWARDSCOUT".
   * Stripe allows 22 characters in total; `statementSuffix()` trims it to fit the prefix.
   */
  statementSuffix: "ONWARDSCOUT",
  /** Line under the pay button. */
  submitNote: "Credits land in your Onward Scout account the moment payment completes.",
} as const;

/** Stripe's limit for the full card statement descriptor ("<prefix>* <suffix>"). */
export const STATEMENT_DESCRIPTOR_MAX = 22;
/** Stripe's limit for an account's shortened descriptor (prefix); assumed when the real one is unknown. */
export const STATEMENT_PREFIX_MAX = 10;

/**
 * Pure: the suffix that fits after `prefix` ("<prefix>* <suffix>" ≤ 22 characters). Without a
 * known prefix the longest one Stripe allows (10) is assumed, so the descriptor always fits.
 * Characters Stripe rejects (< > \ ' " *) are removed; the result is upper-case Latin.
 */
export function fitStatementSuffix(suffix: string, prefix?: string | null): string {
  const clean = suffix
    .replace(/[<>\\'"*]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .toUpperCase();
  const prefixLength = prefix && prefix.trim() ? prefix.trim().length : STATEMENT_PREFIX_MAX;
  const room = Math.max(0, STATEMENT_DESCRIPTOR_MAX - prefixLength - 2);
  if (clean.length <= room) return clean;
  // A cut-off brand ("ONWARDSCOU") reads like a typo on a bank statement: fall back to the
  // brand's readable short form when it fits, and only truncate as a last resort.
  if (STATEMENT_SHORT_FORM.length <= room && clean.startsWith(STATEMENT_SHORT_FORM)) return STATEMENT_SHORT_FORM;
  return clean.slice(0, room).trim();
}

/** Readable short form of the brand for statements where the full name does not fit. */
export const STATEMENT_SHORT_FORM = "ONWARD";

/**
 * The suffix sent with one-time payments. STRIPE_STATEMENT_PREFIX (written by
 * scripts/ops/stripe-bootstrap.mjs when the account is readable) names the account's prefix;
 * without it the brand is trimmed to fit the longest possible prefix.
 */
export function statementSuffix(): string {
  return fitStatementSuffix(CHECKOUT_BRAND.statementSuffix, env("STRIPE_STATEMENT_PREFIX"));
}

/** Metadata stamped on sessions, subscriptions and payment intents so every webhook can attribute them. */
export function checkoutMetadata(userId: string, sku: Sku): Record<string, string> {
  return { site: CHECKOUT_BRAND.site, env: stripeEnvTag(), userId, sku };
}

/** Stripe-hosted page locale for the UI language ("zh" is Simplified Chinese on Stripe). */
export function stripeLocale(locale: "en" | "zh"): "en" | "zh" {
  return locale === "zh" ? "zh" : "en";
}
