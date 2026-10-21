import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_ENV } from "@/lib/env";
import { isOrgKey, paymentsEnabled, priceIdFor, STRIPE_API_VERSION, stripeMode, stripePermissionProblem } from "@/lib/stripe";

// Fake keys are assembled at runtime so the repository never contains key-shaped literals.
const key = (...parts: string[]) => parts.join("_");

afterEach(() => vi.unstubAllEnvs());

describe("Stripe keys", () => {
  it("reads the mode from the key prefix; organization keys count as live", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeMode()).toBe("missing");
    for (const k of [key("sk", "live", "x"), key("rk", "live", "x"), key("sk", "org", "x")]) {
      vi.stubEnv("STRIPE_SECRET_KEY", k);
      expect(stripeMode()).toBe("live");
    }
    for (const k of [key("sk", "test", "x"), key("rk", "test", "x")]) {
      vi.stubEnv("STRIPE_SECRET_KEY", k);
      expect(stripeMode()).toBe("test");
    }
  });

  it("recognises an organization key, which needs STRIPE_CONTEXT (always required here)", () => {
    expect(isOrgKey(key("sk", "org", "live", "x"))).toBe(true);
    expect(isOrgKey(key("sk", "live", "x"))).toBe(false);
    expect(REQUIRED_ENV).toContain("STRIPE_CONTEXT");
    expect(REQUIRED_ENV).toContain("STRIPE_WEBHOOK_SECRET");
    for (const name of ["STRIPE_PRICE_PRO", "STRIPE_PRICE_PACK_10", "STRIPE_PRICE_PACK_40"]) expect(REQUIRED_ENV).toContain(name);
  });

  it("pins the API version the SDK and the webhook endpoint speak", () => {
    expect(STRIPE_API_VERSION).toBe("2026-09-30.endive");
  });

  it("reads each offer's price id from its own variable", () => {
    vi.stubEnv("STRIPE_PRICE_PACK_40", key("price", "abc"));
    expect(priceIdFor("pack40")).toBe(key("price", "abc"));
    vi.stubEnv("STRIPE_PRICE_PACK_40", "");
    expect(priceIdFor("pack40")).toBeUndefined();
  });
});

describe("paymentsEnabled", () => {
  it("refuses when Stripe is not configured", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(paymentsEnabled("pro")).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("refuses an offer whose price id is missing", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", key("sk", "test", "x"));
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    expect(paymentsEnabled("pro")).toMatchObject({ ok: false, code: "price_missing" });
    vi.stubEnv("STRIPE_PRICE_PRO", key("price", "123"));
    expect(paymentsEnabled("pro").ok).toBe(true);
  });

  it("takes live money only on the production deployment unless explicitly allowed", () => {
    // Tests run outside Vercel production, like preview and local deployments.
    vi.stubEnv("STRIPE_SECRET_KEY", key("sk", "org", "x"));
    vi.stubEnv("STRIPE_PRICE_PACK_10", key("price", "123"));
    vi.stubEnv("ALLOW_LIVE_CHECKOUT_NONPROD", "");
    expect(paymentsEnabled("pack10")).toMatchObject({ ok: false, code: "nonprod" });
    vi.stubEnv("ALLOW_LIVE_CHECKOUT_NONPROD", "1");
    expect(paymentsEnabled("pack10").ok).toBe(true);
    // test keys are always fine off production
    vi.stubEnv("ALLOW_LIVE_CHECKOUT_NONPROD", "");
    vi.stubEnv("STRIPE_SECRET_KEY", key("sk", "test", "x"));
    expect(paymentsEnabled("pack10").ok).toBe(true);
  });
});

// What stripe-node raises for an HTTP 403 (the shape Stripe answers with an organization key).
const DENIED = `Permission denied. The provided key '${key("sk", "org", "live")}...Jp07' does not have the required permissions for this endpoint on account 'acct_123'. Enabling Invoices Read ('invoice_read') permissions on this key would allow this request to continue.`;

function stripeError(over: Record<string, unknown>): Error {
  const e = new Error(typeof over.message === "string" ? over.message : "x");
  return Object.assign(e, over);
}

describe("stripePermissionProblem", () => {
  it("names the missing permission from Stripe's message", () => {
    expect(stripePermissionProblem(stripeError({ type: "StripePermissionError", statusCode: 403, message: DENIED }))).toBe("invoice_read (Invoices Read)");
  });

  it("recognises the SDK type, the status and the wording on their own", () => {
    expect(stripePermissionProblem(stripeError({ type: "StripePermissionError", message: "nope" }))).toBe("nope");
    expect(stripePermissionProblem(stripeError({ statusCode: 403, message: "" }))).toBe("permission denied");
    expect(stripePermissionProblem(stripeError({ code: "permission_denied", message: "Permission denied." }))).toBe("Permission denied.");
    expect(stripePermissionProblem(stripeError({ message: DENIED }))).toBe("invoice_read (Invoices Read)");
  });

  it("leaves every other error a real failure", () => {
    expect(stripePermissionProblem(stripeError({ type: "StripeInvalidRequestError", statusCode: 400, message: "No such invoice: 'in_1'" }))).toBeNull();
    expect(stripePermissionProblem(stripeError({ type: "StripeAuthenticationError", statusCode: 401, message: "Invalid API Key provided" }))).toBeNull();
    expect(stripePermissionProblem(new TypeError("fetch failed"))).toBeNull();
    expect(stripePermissionProblem("denied")).toBeNull();
    expect(stripePermissionProblem(null)).toBeNull();
  });
});
