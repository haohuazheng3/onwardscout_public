import { localizePath } from "@/i18n/paths";
import { signInPath } from "@/lib/site";
import { isSku, type Locale, type Sku } from "@/content/plans";

/*
 * Pure rules of the checkout flow shared by the client components (CheckoutButton, ResumePurchase,
 * PortalButton). No React, no browser globals: unit-tested in tests/billing.test.ts.
 */

/** Where the buy button lives; decides where Stripe's back link and the sign-in round trip return. */
export type CheckoutFrom = "pricing" | "billing";

/** One purchase attempt (nonce + the Stripe page it produced) is reused for this long. */
export const ATTEMPT_MS = 20 * 60 * 1000;

/** Message keys (billing.checkout.errors.*) the client can show for a failed checkout start. */
export const CHECKOUT_ERROR_KEYS = ["not_configured", "price_missing", "nonprod", "has_plan", "stale", "invalid", "rate_limited", "failed", "network"] as const;
export type CheckoutErrorKey = (typeof CHECKOUT_ERROR_KEYS)[number];

/** Message keys (billing.portal.errors.*) for a failed portal opening. */
export const PORTAL_ERROR_KEYS = ["not_configured", "no_customer", "rate_limited", "failed", "network"] as const;
export type PortalErrorKey = (typeof PORTAL_ERROR_KEYS)[number];

/** The page a purchase returns to after sign-in, carrying `?buy=<sku>` so it can resume. */
export function resumeReturnPath(locale: Locale, sku: Sku, from: CheckoutFrom = "pricing"): string {
  return `${localizePath(from === "billing" ? "/app/billing" : "/pricing", locale)}?buy=${sku}`;
}

/** The localized sign-in URL for a guest who pressed a buy button: `/sign-in?redirect_url=/pricing?buy=<sku>`. */
export function signInHrefFor(locale: Locale, sku: Sku, from: CheckoutFrom = "pricing"): string {
  return signInPath(locale, resumeReturnPath(locale, sku, from));
}

/** Only Stripe's own hosted checkout is a valid redirect target for a buy button. */
export function isStripeCheckoutUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("https://checkout.stripe.com/");
}

/** Only Stripe's own hosted billing portal is a valid redirect target for the manage button. */
export function isStripePortalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "billing.stripe.com" || u.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

/** True when something stamped at `at` (ms) is still inside the attempt window. */
export function withinAttempt(at: unknown, now: number = Date.now(), windowMs: number = ATTEMPT_MS): boolean {
  return typeof at === "number" && Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < windowMs;
}

/** The sku a `?buy=` query asks to resume, or null. */
export function buyParam(search: string): Sku | null {
  try {
    const v = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("buy");
    return isSku(v) ? v : null;
  } catch {
    return null;
  }
}

/** Which message explains a failed POST /api/checkout. 401 is not an error: it means "sign in first". */
export function checkoutErrorKey(status: number, code: unknown): CheckoutErrorKey {
  if (status === 429) return "rate_limited";
  if (typeof code === "string" && (CHECKOUT_ERROR_KEYS as readonly string[]).includes(code)) return code as CheckoutErrorKey;
  if (status === 503) return "not_configured";
  if (status === 400) return "invalid";
  return "failed";
}

/** Which message explains a failed POST /api/stripe/portal. */
export function portalErrorKey(status: number, code: unknown): PortalErrorKey {
  if (status === 429) return "rate_limited";
  if (typeof code === "string" && (PORTAL_ERROR_KEYS as readonly string[]).includes(code)) return code as PortalErrorKey;
  if (status === 503) return "not_configured";
  if (status === 409) return "no_customer";
  return "failed";
}

/** The page a buy button sits on, from the current path (prefix included). */
export function fromForPath(pathname: string): CheckoutFrom {
  return /^(?:\/zh)?\/app\/billing(?:\/|$)/.test(pathname) ? "billing" : "pricing";
}
