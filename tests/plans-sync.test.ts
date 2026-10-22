import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { OFFERS, PACKS, PLANS, SKUS } from "@/content/plans";
import { CHECKOUT_BRAND, STATEMENT_DESCRIPTOR_MAX as APP_MAX } from "@/lib/stripe";

// scripts/ops/ stays in the private repository; the public mirror skips this lock test.
const MIRROR = new URL("../scripts/ops/stripe-offers.mjs", import.meta.url);
const hasMirror = fs.existsSync(MIRROR);
const { descriptorFits, STATEMENT_DESCRIPTOR_MAX, STATEMENT_SUFFIX, STRIPE_OFFERS, stripeProductCopy, WEBHOOK_EVENTS } = hasMirror
  ? await import("../scripts/ops/stripe-offers.mjs")
  : ({} as typeof import("../scripts/ops/stripe-offers.mjs"));

/*
 * scripts/ops/stripe-bootstrap.mjs runs as plain Node and cannot import plans.ts, so it carries a
 * mirror of the catalog in stripe-offers.mjs. This test is the lock between the two: a price,
 * credit count, name, validity or interval changed in one place and not the other fails the suite.
 */
describe.skipIf(!hasMirror)("Stripe catalog mirror", () => {
  it("lists exactly the skus in plans.ts, in the same order", () => {
    expect(STRIPE_OFFERS.map((o) => o.sku)).toEqual([...SKUS]);
  });

  it("agrees with plans.ts on price, credits, interval, validity, English name and env variable", () => {
    for (const mirror of STRIPE_OFFERS) {
      const offer = OFFERS[mirror.sku as keyof typeof OFFERS];
      expect(offer, `plans.ts has no offer ${mirror.sku}`).toBeDefined();
      expect(mirror).toEqual({
        sku: offer.sku,
        name: offer.name.en,
        priceUsd: offer.priceUsd,
        credits: offer.credits,
        interval: offer.interval,
        rolloverDays: offer.rolloverDays,
        priceEnv: offer.priceEnv,
      });
    }
  });

  it("has one monthly plan and two one-time packs", () => {
    expect(STRIPE_OFFERS.filter((o) => o.interval === "month").map((o) => o.sku)).toEqual(Object.keys(PLANS));
    expect(STRIPE_OFFERS.filter((o) => o.interval === null).map((o) => o.sku)).toEqual(Object.keys(PACKS));
  });

  it("names every Stripe product after the brand and states the credits, validity and what a credit buys", () => {
    for (const mirror of STRIPE_OFFERS) {
      const copy = stripeProductCopy(mirror);
      expect(copy.name.startsWith("Onward Scout ")).toBe(true);
      expect(copy.description).toContain(`${mirror.credits} credits`);
      expect(copy.description).toContain(mirror.interval === "month" ? "every month" : `valid ${mirror.rolloverDays} days`);
      expect(copy.description).toContain("one application submitted for you");
      expect(copy.description.length).toBeLessThanOrEqual(300);
    }
  });

  it("subscribes the webhook to the ten events the route handles", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "invoice.paid",
      "invoice.payment_failed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ]);
  });

  it("checks the same statement suffix and limit as the app", () => {
    expect(STATEMENT_SUFFIX).toBe(CHECKOUT_BRAND.statementSuffix);
    expect(STATEMENT_DESCRIPTOR_MAX).toBe(APP_MAX);
    expect(descriptorFits("ONWARD")).toBe(true); // "ONWARD* ONWARDSCOUT" = 19
    expect(descriptorFits("ONWARDSCT")).toBe(true); // 9 + 2 + 11 = 22
    expect(descriptorFits("ONWARDSCOU")).toBe(false); // 10 + 2 + 11 = 23
    expect(descriptorFits("")).toBe(false);
    expect(descriptorFits(null)).toBe(false);
  });
});
