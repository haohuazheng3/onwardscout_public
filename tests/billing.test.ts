import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { ENTITLED_STATUSES, isEntitledStatus, pickActiveSubscription, planStatus } from "@/lib/account";
import {
  benignGrantReason,
  checkoutRef,
  emptyReport,
  GRANTING_BILLING_REASONS,
  invoicePeriod,
  invoiceSku,
  isCheckoutSessionId,
  isOurs,
  needsAttention,
  noteSkipped,
  packLotKey,
  priceMap,
  runReconcileStep,
  skuForPriceId,
  subscriptionLotKey,
  subscriptionPeriod,
  subscriptionSku,
  validateInvoice,
  validateSession,
} from "@/lib/billing";
import type { SubscriptionRow } from "@/lib/db/schema";
import {
  ATTEMPT_MS,
  buyParam,
  checkoutErrorKey,
  fromForPath,
  isStripeCheckoutUrl,
  isStripePortalUrl,
  portalErrorKey,
  resumeReturnPath,
  signInHrefFor,
  withinAttempt,
} from "@/components/billing/checkout-flow";
import { OFFERS, PACKS, PLANS } from "@/content/plans";

/* ------------------------------------------------------------------ fixtures */

const SITE = "onwardscout";
const baseSession = {
  id: "cs_test_1",
  mode: "subscription",
  status: "complete",
  payment_status: "paid",
  client_reference_id: "user_abc",
  metadata: { site: SITE, env: "production", userId: "user_abc", sku: "pro" },
} as unknown as Stripe.Checkout.Session;

const session = (patch: Record<string, unknown>) => ({ ...baseSession, ...patch }) as unknown as Stripe.Checkout.Session;
const withMeta = (meta: Record<string, string | undefined>) => session({ metadata: { ...baseSession.metadata, ...meta } });
const packSession = (meta: Record<string, string | undefined> = {}) =>
  session({ mode: "payment", metadata: { ...baseSession.metadata, sku: "pack10", ...meta } });

// Fake price ids are assembled at runtime so the repository never contains id-shaped literals.
const PRICE = Object.fromEntries(Object.keys(OFFERS).map((sku) => [sku, ["price", sku, "x"].join("_")])) as Record<string, string>;
const fakeEnv = (name: string) => {
  const sku = Object.values(OFFERS).find((o) => o.priceEnv === name)?.sku;
  return sku ? PRICE[sku] : undefined;
};
const map = priceMap(fakeEnv);

const line = (start: number, end: number, opts: { proration?: boolean; price?: string; subscription?: boolean } = {}) =>
  ({
    period: { start, end },
    parent:
      opts.subscription === false
        ? { type: "invoice_item_details", subscription_item_details: null }
        : { type: "subscription_item_details", subscription_item_details: { proration: opts.proration ?? false } },
    subscription: opts.subscription === false ? null : "sub_1",
    pricing: opts.price ? { type: "price_details", price_details: { price: opts.price, product: "prod_1" } } : null,
  }) as unknown as Stripe.InvoiceLineItem;

const invoice = (patch: Record<string, unknown> = {}) =>
  ({
    id: "in_1",
    status: "paid",
    billing_reason: "subscription_cycle",
    period_start: 1_000,
    period_end: 1_000,
    metadata: {},
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { site: SITE, env: "production", userId: "user_abc", sku: "pro" } } },
    lines: { data: [line(2_000, 4_000, { price: PRICE.pro })] },
    ...patch,
  }) as unknown as Stripe.Invoice;

/* ------------------------------------------------------------------ validateSession */

describe("validateSession", () => {
  it("accepts a paid Pro checkout for this site and names the buyer and sku", () => {
    expect(validateSession(baseSession, "production")).toEqual({ ok: true, userId: "user_abc", sku: "pro", kind: "subscription" });
  });
  it("accepts paid pack checkouts in payment mode", () => {
    expect(validateSession(packSession(), "production")).toEqual({ ok: true, userId: "user_abc", sku: "pack10", kind: "pack" });
    expect(validateSession(packSession({ sku: "pack40" }), "production")).toEqual({ ok: true, userId: "user_abc", sku: "pack40", kind: "pack" });
  });
  it("accepts a 100%-off checkout (no payment required)", () => {
    expect(validateSession(session({ payment_status: "no_payment_required" }), "production").ok).toBe(true);
  });
  it("ignores sessions from other sites and other environments", () => {
    expect(validateSession(withMeta({ site: "windowmuse" }), "production")).toEqual({ ok: false, reason: "other-site" });
    expect(validateSession(baseSession, "preview")).toEqual({ ok: false, reason: "other-env" });
    expect(validateSession(withMeta({ env: undefined }), "production").ok).toBe(true); // missing env tag = production
    expect(validateSession(withMeta({ env: undefined }), "preview")).toEqual({ ok: false, reason: "other-env" });
  });
  it("refuses open, expired and unpaid sessions", () => {
    expect(validateSession(session({ status: "open" }), "production")).toEqual({ ok: false, reason: "status-open" });
    expect(validateSession(session({ status: "expired" }), "production")).toEqual({ ok: false, reason: "status-expired" });
    expect(validateSession(session({ payment_status: "unpaid" }), "production")).toEqual({ ok: false, reason: "payment-unpaid" });
  });
  it("refuses setup-mode sessions and offers in the wrong mode", () => {
    expect(validateSession(session({ mode: "setup" }), "production")).toEqual({ ok: false, reason: "mode-setup" });
    expect(validateSession(session({ mode: "payment" }), "production")).toEqual({ ok: false, reason: "plan-not-subscription-mode" });
    expect(validateSession(withMeta({ sku: "pack40" }), "production")).toEqual({ ok: false, reason: "pack-not-payment-mode" });
  });
  it("requires a buyer and a known sku, and refuses a user id that disagrees with the metadata", () => {
    expect(validateSession(session({ client_reference_id: null, metadata: { site: SITE, env: "production", sku: "pro" } }), "production")).toEqual({ ok: false, reason: "no-user" });
    expect(validateSession(session({ client_reference_id: null }), "production").ok).toBe(true); // metadata.userId alone is enough
    expect(validateSession(withMeta({ sku: "pack50" }), "production")).toEqual({ ok: false, reason: "unknown-sku" });
    expect(validateSession(withMeta({ sku: "trial" }), "production")).toEqual({ ok: false, reason: "unknown-sku" });
    expect(validateSession(withMeta({ userId: "user_other" }), "production")).toEqual({ ok: false, reason: "user-mismatch" });
  });
});

/* ------------------------------------------------------------------ lot keys */

describe("credit lot source keys", () => {
  it("keys a pack by its Checkout Session id", () => {
    expect(packLotKey("cs_test_1")).toBe("cs_test_1");
  });
  it("keys a Pro period by subscriptionId:periodStart, so one invoice always yields one key", () => {
    expect(subscriptionLotKey("sub_1", 1_700_000_000)).toBe("sub_1:1700000000");
    const period = invoicePeriod(invoice());
    expect(subscriptionLotKey("sub_1", period.start)).toBe("sub_1:2000");
  });
  it("reads the period from the regular subscription line, skipping prorations and one-off items", () => {
    const inv = invoice({ lines: { data: [line(1_500, 1_900, { proration: true }), line(2_000, 4_000), line(9_000, 9_900, { subscription: false })] } });
    expect(invoicePeriod(inv)).toEqual({ start: 2_000, end: 4_000 });
  });
  it("uses a proration line only when there is no regular line, and the invoice period as a last resort", () => {
    expect(invoicePeriod(invoice({ lines: { data: [line(1_500, 1_900, { proration: true })] } }))).toEqual({ start: 1_500, end: 1_900 });
    expect(invoicePeriod(invoice({ lines: { data: [] }, period_start: 50, period_end: 60 }))).toEqual({ start: 50, end: 60 });
  });
  it("keys the first period from the subscription the same way the invoice does (success page and webhook agree)", () => {
    const sub = { items: { data: [{ current_period_start: 2_000, current_period_end: 4_000 }] } } as unknown as Stripe.Subscription;
    expect(subscriptionPeriod(sub)).toEqual({ start: 2_000, end: 4_000 });
    expect(subscriptionLotKey("sub_1", subscriptionPeriod(sub)!.start)).toBe(subscriptionLotKey("sub_1", invoicePeriod(invoice()).start));
    expect(subscriptionPeriod({ items: { data: [] } } as unknown as Stripe.Subscription)).toBeNull();
  });
});

/* ------------------------------------------------------------------ plan ↔ price mapping */

describe("plan ↔ price mapping", () => {
  it("maps every configured STRIPE_PRICE_* id back to its sku", () => {
    for (const offer of [...Object.values(PLANS), ...Object.values(PACKS)]) {
      expect(skuForPriceId(PRICE[offer.sku], map)).toBe(offer.sku);
    }
    expect(skuForPriceId(["price", "unknown"].join("_"), map)).toBeNull();
    expect(skuForPriceId(null, map)).toBeNull();
  });
  it("leaves unset price variables out of the map", () => {
    const partial = priceMap((name) => (name === "STRIPE_PRICE_PRO" ? PRICE.pro : undefined));
    expect(Object.keys(partial)).toEqual([PRICE.pro]);
  });
  it("reads an invoice's plan from the line price, falling back to the snapshotted metadata", () => {
    expect(invoiceSku(invoice(), map)).toBe("pro");
    expect(invoiceSku(invoice({ lines: { data: [line(2_000, 4_000)] } }), map)).toBe("pro"); // metadata.sku
    // a pack price on a subscription line is nonsense and never becomes a plan
    const odd = invoice({
      lines: { data: [line(2_000, 4_000, { price: PRICE.pack10 })] },
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: {} } },
    });
    expect(invoiceSku(odd, map)).toBeNull();
  });
  it("reads a subscription's plan from its item price, falling back to its metadata", () => {
    const sub = (price: string | null, sku?: string) =>
      ({ items: { data: price ? [{ price: { id: price } }] : [] }, metadata: sku ? { sku } : {} }) as unknown as Stripe.Subscription;
    expect(subscriptionSku(sub(PRICE.pro), map)).toBe("pro");
    expect(subscriptionSku(sub(null, "pro"), map)).toBe("pro");
    expect(subscriptionSku(sub(null, "pack40"), map)).toBeNull();
    expect(subscriptionSku(sub(null), map)).toBeNull();
  });
});

/* ------------------------------------------------------------------ validateInvoice */

describe("validateInvoice", () => {
  it("accepts a paid Onward Scout subscription invoice and extracts everything a grant needs", () => {
    expect(validateInvoice(invoice(), "production", map)).toEqual({
      ok: true,
      subscriptionId: "sub_1",
      userId: "user_abc",
      sku: "pro",
      period: { start: 2_000, end: 4_000 },
      billingReason: "subscription_cycle",
    });
  });
  it("ignores one-off invoices, other sites, other environments and unpaid invoices", () => {
    expect(validateInvoice(invoice({ parent: null }), "production", map)).toEqual({ ok: false, reason: "not-subscription" });
    expect(
      validateInvoice(invoice({ parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { site: "other" } } } }), "production", map),
    ).toEqual({ ok: false, reason: "other-site" });
    expect(validateInvoice(invoice(), "preview", map)).toEqual({ ok: false, reason: "other-env" });
    expect(validateInvoice(invoice({ status: "open" }), "production", map)).toEqual({ ok: false, reason: "status-open" });
  });
  it("grants only for invoices that pay for a period: creation and renewal, never a proration", () => {
    expect(GRANTING_BILLING_REASONS).toEqual(["subscription_create", "subscription_cycle"]);
    expect(validateInvoice(invoice({ billing_reason: "subscription_create" }), "production", map).ok).toBe(true);
    for (const reason of ["subscription_update", "subscription_threshold", "manual", "upcoming", "automatic_pending_invoice_item_invoice", "quote_accept"]) {
      expect(validateInvoice(invoice({ billing_reason: reason }), "production", map)).toEqual({ ok: false, reason: `billing-${reason}` });
    }
    expect(validateInvoice(invoice({ billing_reason: null }), "production", map)).toEqual({ ok: false, reason: "billing-unknown" });
  });
  it("accepts an expanded subscription object in the parent", () => {
    const inv = invoice({
      parent: { type: "subscription_details", subscription_details: { subscription: { id: "sub_9" }, metadata: { site: SITE, env: "production", userId: "user_abc", sku: "pro" } } },
    });
    const r = validateInvoice(inv, "production", map);
    expect(r.ok && r.subscriptionId).toBe("sub_9");
  });
});

/* ------------------------------------------------------------------ small pure guards */

describe("ownership and references", () => {
  it("recognises our objects by site and environment", () => {
    expect(isOurs({ site: SITE, env: "production" }, "production")).toBe(true);
    expect(isOurs({ site: SITE }, "production")).toBe(true);
    expect(isOurs({ site: SITE }, "preview")).toBe(false);
    expect(isOurs({ site: "windowmuse", env: "production" }, "production")).toBe(false);
    expect(isOurs(null, "production")).toBe(false);
  });
  it("accepts only Stripe-shaped Checkout Session ids on the success page", () => {
    const id = ["cs", "test", "a1B2c3D4e5F6g7H8"].join("_");
    expect(isCheckoutSessionId(id)).toBe(true);
    expect(isCheckoutSessionId(["cs", "live", "a1B2c3D4e5F6g7H8"].join("_"))).toBe(true);
    for (const bad of ["", "cs_test_", "cs_test_short", "pi_123456789012", `${id}<script>`, "cs_other_a1B2c3D4e5F6g7H8", 42, null]) {
      expect(isCheckoutSessionId(bad)).toBe(false);
    }
  });
  it("gives support a short, stable reference for a session", () => {
    const id = ["cs", "test", "a1B2c3D4e5F6g7H8"].join("_");
    expect(checkoutRef(id)).toBe("E5F6G7H8");
    expect(checkoutRef(id)).toBe(checkoutRef(id));
  });
});

/* ------------------------------------------------------------------ benign refusals and reconcile */

describe("benignGrantReason", () => {
  it("treats other sites/envs, closed orders, pending payments and non-period invoices as nothing to do", () => {
    for (const r of ["other-site", "other-env", "order-refunded", "order-disputed", "payment-unpaid", "billing-subscription_update", "billing-unknown"]) {
      expect(benignGrantReason(r)).toBe(true);
    }
  });
  it("sees through the prefixes the checkout grant adds", () => {
    expect(benignGrantReason("invoice-billing-subscription_update")).toBe(true);
    expect(benignGrantReason("subscription-other-site")).toBe(true);
    expect(benignGrantReason("invoice-subscription-other-env")).toBe(true);
  });
  it("keeps real problems visible", () => {
    for (const r of ["no-user", "unknown-sku", "user-mismatch", "invoice-status-open", "invoice-unknown-plan", "subscription-no-user", "unknown-user", "no-invoice"]) {
      expect(benignGrantReason(r)).toBe(false);
    }
  });
});

describe("reconcile report", () => {
  it("starts empty and needs no attention", () => {
    const r = emptyReport(7, new Date("2026-10-21T03:17:00Z"));
    expect(r.ranAt).toBe("2026-10-21T03:17:00.000Z");
    expect(needsAttention(r)).toBe(false);
  });
  it("flags repairs, failures and missed refunds, but not skipped steps", () => {
    const r = emptyReport(7);
    noteSkipped(r, "invoices", "invoice_read (Invoices Read)");
    noteSkipped(r, "invoices", "invoice_read (Invoices Read)");
    expect(r.skipped).toEqual([{ step: "invoices", reason: "invoice_read (Invoices Read)" }]);
    expect(needsAttention(r)).toBe(false);
    r.refundsApplied.push("ord_1");
    expect(needsAttention(r)).toBe(true);
  });
  it("skips a step Stripe refuses for a missing permission and keeps real failures fatal", async () => {
    const r = emptyReport(7);
    const denied = Object.assign(new Error("Permission denied. Enabling Invoices Read ('invoice_read') permissions on this key would allow this request to continue."), {
      type: "StripePermissionError",
      statusCode: 403,
    });
    await runReconcileStep(r, "invoices", async () => {
      throw denied;
    });
    expect(r.skipped).toEqual([{ step: "invoices", reason: "invoice_read (Invoices Read)" }]);
    await expect(
      runReconcileStep(r, "sessions", async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
  });
});

/* ------------------------------------------------------------------ plan state (account) */

const subRow = (patch: Partial<SubscriptionRow>): SubscriptionRow => ({
  id: "sub_row",
  userId: "user_abc",
  stripeSubscriptionId: "sub_1",
  sku: "pro",
  status: "active",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ...patch,
});

describe("plan state", () => {
  it("keeps perks while Stripe retries a failed renewal", () => {
    expect([...ENTITLED_STATUSES]).toEqual(["active", "trialing", "past_due"]);
    expect(isEntitledStatus("past_due")).toBe(true);
    expect(isEntitledStatus("canceled")).toBe(false);
  });
  it("reads the subscription as active, cancel scheduled, past due, ended or none", () => {
    expect(planStatus(null)).toBe("none");
    expect(planStatus(subRow({}))).toBe("active");
    expect(planStatus(subRow({ cancelAtPeriodEnd: true }))).toBe("cancelScheduled");
    expect(planStatus(subRow({ status: "past_due" }))).toBe("pastDue");
    expect(planStatus(subRow({ status: "canceled" }))).toBe("ended");
    expect(planStatus(subRow({ status: "incomplete" }))).toBe("none");
    expect(planStatus(subRow({ sku: "pack10" }))).toBe("none");
  });
  it("picks the newest entitled Pro subscription", () => {
    const older = subRow({ id: "a", updatedAt: new Date("2026-09-01T00:00:00Z") });
    const newer = subRow({ id: "b", updatedAt: new Date("2026-10-01T00:00:00Z") });
    const dead = subRow({ id: "c", status: "canceled", updatedAt: new Date("2026-10-10T00:00:00Z") });
    expect(pickActiveSubscription([older, dead, newer])?.id).toBe("b");
    expect(pickActiveSubscription([dead])).toBeNull();
  });
});

/* ------------------------------------------------------------------ checkout flow (client rules) */

describe("checkout flow", () => {
  it("sends a guest to the localized sign-in that comes back to the offer", () => {
    expect(resumeReturnPath("en", "pro")).toBe("/pricing?buy=pro");
    expect(resumeReturnPath("zh", "pack10")).toBe("/zh/pricing?buy=pack10");
    expect(resumeReturnPath("zh", "pack40", "billing")).toBe("/zh/app/billing?buy=pack40");
    expect(signInHrefFor("en", "pro")).toBe(`/sign-in?redirect_url=${encodeURIComponent("/pricing?buy=pro")}`);
    expect(signInHrefFor("zh", "pack40")).toBe(`/zh/sign-in?redirect_url=${encodeURIComponent("/zh/pricing?buy=pack40")}`);
  });
  it("reads ?buy= only for real skus", () => {
    expect(buyParam("?buy=pro")).toBe("pro");
    expect(buyParam("buy=pack40&x=1")).toBe("pack40");
    expect(buyParam("?buy=enterprise")).toBeNull();
    expect(buyParam("")).toBeNull();
  });
  it("redirects only to Stripe's own pages", () => {
    expect(isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_x")).toBe(true);
    expect(isStripeCheckoutUrl("https://evil.example/checkout.stripe.com/")).toBe(false);
    expect(isStripeCheckoutUrl("http://checkout.stripe.com/c/pay")).toBe(false);
    expect(isStripeCheckoutUrl(undefined)).toBe(false);
    expect(isStripePortalUrl("https://billing.stripe.com/p/session/x")).toBe(true);
    expect(isStripePortalUrl("https://billing.stripe.com.evil.example/p")).toBe(false);
    expect(isStripePortalUrl("javascript:alert(1)")).toBe(false);
  });
  it("reuses one attempt for 20 minutes", () => {
    const t0 = 1_000_000;
    expect(ATTEMPT_MS).toBe(20 * 60 * 1000);
    expect(withinAttempt(t0, t0 + 1)).toBe(true);
    expect(withinAttempt(t0, t0 + ATTEMPT_MS)).toBe(false);
    expect(withinAttempt(t0 + 5, t0)).toBe(false); // from the future: clock skew, not reusable
    expect(withinAttempt("123", t0)).toBe(false);
  });
  it("maps every failure to a message the person can act on", () => {
    expect(checkoutErrorKey(429, undefined)).toBe("rate_limited");
    expect(checkoutErrorKey(409, "has_plan")).toBe("has_plan");
    expect(checkoutErrorKey(409, "stale")).toBe("stale");
    expect(checkoutErrorKey(503, "nonprod")).toBe("nonprod");
    expect(checkoutErrorKey(503, undefined)).toBe("not_configured");
    expect(checkoutErrorKey(400, undefined)).toBe("invalid");
    expect(checkoutErrorKey(500, "something-new")).toBe("failed");
    expect(portalErrorKey(409, undefined)).toBe("no_customer");
    expect(portalErrorKey(503, "not_configured")).toBe("not_configured");
    expect(portalErrorKey(500, undefined)).toBe("failed");
  });
  it("knows which page a button sits on", () => {
    expect(fromForPath("/app/billing")).toBe("billing");
    expect(fromForPath("/zh/app/billing")).toBe("billing");
    expect(fromForPath("/pricing")).toBe("pricing");
    expect(fromForPath("/zh/pricing")).toBe("pricing");
    expect(fromForPath("/app/billing-history")).toBe("pricing");
  });
});
