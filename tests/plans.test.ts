import { describe, expect, it } from "vitest";
import {
  CREDIT_COST,
  CREDIT_RULES,
  formatPrice,
  isPlanSku,
  isSku,
  NO_PLAN_PERKS,
  OFFERS,
  offerName,
  PACK_SKUS,
  PACKS,
  perCreditUsd,
  PLAN_SKUS,
  PASS_SKUS,
  PASSES,
  PLANS,
  PUBLIC_SKUS,
  LEGACY_SKUS,
  SINGLE,
  SKUS,
  TRIAL,
  UNLOCK_PRICE,
  isPassSku,
  isPublicSku,
  isSingleSku,
  offerFeatures,
  scopeCovers,
  validityDays,
} from "@/content/plans";

describe("catalog", () => {
  it("sells one application and two season passes; Pro and the packs are legacy", () => {
    expect([...SKUS]).toEqual(["single", "season_returnship", "season_startup", "pro", "pack10", "pack40"]);
    expect([...PUBLIC_SKUS]).toEqual(["single", "season_returnship", "season_startup"]);
    expect([...LEGACY_SKUS]).toEqual(["pro", "pack10", "pack40"]);
    expect([...PLAN_SKUS]).toEqual(["pro"]);
    expect([...PACK_SKUS]).toEqual(["pack10", "pack40"]);
    expect([...PASS_SKUS]).toEqual(["season_returnship", "season_startup"]);
    expect(Object.keys(OFFERS)).toEqual([...SKUS]);
    expect(isPublicSku("single")).toBe(true);
    expect(isPublicSku("pack10")).toBe(false);
    expect(isSingleSku("single")).toBe(true);
    expect(isSingleSku("pro")).toBe(false);
  });

  it("unlocks one application for $19, paid once, no validity to track", () => {
    expect([SINGLE.priceUsd, SINGLE.credits, SINGLE.interval, SINGLE.rolloverDays, SINGLE.priceEnv]).toEqual([19, 1, null, 0, "STRIPE_PRICE_SINGLE"]);
    expect(UNLOCK_PRICE).toBe("$19");
    expect(SINGLE.features.en.some((l) => /Claude/.test(l))).toBe(true);
    expect(SINGLE.features.en.some((l) => /Word and PDF/.test(l))).toBe(true);
  });

  it("prices the season passes at $49 for 90 days, scoped to their programmes", () => {
    expect([PASSES.season_returnship.priceUsd, PASSES.season_returnship.credits, PASSES.season_returnship.interval, PASSES.season_returnship.rolloverDays]).toEqual([49, 60, null, 90]);
    expect([PASSES.season_startup.priceUsd, PASSES.season_startup.credits, PASSES.season_startup.interval, PASSES.season_startup.rolloverDays]).toEqual([49, 10, null, 90]);
    expect(PASSES.season_returnship.scope).toEqual(["returnship"]);
    expect([...(PASSES.season_startup.scope ?? [])].sort()).toEqual(["accelerator", "incubator", "pitch_event", "startup_competition"]);
    expect(isPassSku("season_startup")).toBe(true);
    expect(isPassSku("pack10")).toBe(false);
    expect(isPlanSku("season_returnship")).toBe(false);
  });

  it("never promises email reminders while product email is off", () => {
    const off = offerFeatures(PASSES.season_returnship, "en", { mailer: false });
    expect(off.some((l) => /by email/i.test(l))).toBe(false);
    expect(off).toContain("Deadline reminders in the app for the programmes you saved or started (email reminders coming soon)");
    expect(offerFeatures(PASSES.season_returnship, "en", { mailer: true })).toEqual([...PASSES.season_returnship.features.en]);
    expect(offerFeatures(PLANS.pro, "en", { mailer: false })).toEqual([...PLANS.pro.features.en]);
  });

  it("lets scoped credits pay only for their own programme types", () => {
    expect(scopeCovers([], "hackathon")).toBe(true);
    expect(scopeCovers(undefined, null)).toBe(true);
    expect(scopeCovers(["returnship"], "returnship")).toBe(true);
    expect(scopeCovers(["returnship"], "job")).toBe(false);
    expect(scopeCovers(["returnship"], null)).toBe(false);
    expect(scopeCovers(PASSES.season_startup.scope, "pitch_event")).toBe(true);
    expect(scopeCovers(PASSES.season_startup.scope, "returnship")).toBe(false);
  });

  it("keeps the published prices, credits and validity", () => {
    expect([PLANS.pro.priceUsd, PLANS.pro.credits, PLANS.pro.interval, PLANS.pro.rolloverDays]).toEqual([29, 60, "month", 30]);
    expect([PACKS.pack10.priceUsd, PACKS.pack10.credits, PACKS.pack10.interval, PACKS.pack10.rolloverDays]).toEqual([9, 10, null, 180]);
    expect([PACKS.pack40.priceUsd, PACKS.pack40.credits, PACKS.pack40.interval, PACKS.pack40.rolloverDays]).toEqual([29, 40, null, 180]);
    expect(TRIAL).toEqual({ credits: 0, expiryDays: 60 });
    expect(validityDays("pro")).toBe(30);
    expect(validityDays("pack40")).toBe(180);
  });

  it("names each offer's Stripe price variable", () => {
    expect(PLANS.pro.priceEnv).toBe("STRIPE_PRICE_PRO");
    expect(PACKS.pack10.priceEnv).toBe("STRIPE_PRICE_PACK_10");
    expect(PACKS.pack40.priceEnv).toBe("STRIPE_PRICE_PACK_40");
  });

  it("gives Pro its perks and packs none", () => {
    expect(PLANS.pro.perks).toEqual({ autoFollowUps: true, weeklyDigest: true });
    for (const p of Object.values(PACKS)) expect(p.perks).toEqual(NO_PLAN_PERKS);
  });

  it("has the same number of benefit lines in both languages", () => {
    for (const o of Object.values(OFFERS)) {
      expect(o.features.zh.length).toBe(o.features.en.length);
      expect(o.name.en.length).toBeGreaterThan(0);
      expect(o.name.zh.length).toBeGreaterThan(0);
      expect(o.blurb.zh.length).toBeGreaterThan(0);
    }
  });

  it("states the real credit count and validity in the copy", () => {
    expect(PLANS.pro.features.en[0]).toContain(`${PLANS.pro.credits} credits`);
    expect(PACKS.pack10.features.en[0]).toContain(`${PACKS.pack10.credits} credits, valid for ${PACKS.pack10.rolloverDays} days`);
    expect(PACKS.pack40.features.en[0]).toContain(`${PACKS.pack40.credits} credits, valid for ${PACKS.pack40.rolloverDays} days`);
  });

  it("recognises skus", () => {
    expect(isSku("pro")).toBe(true);
    expect(isSku("pack40")).toBe(true);
    expect(isSku("pack50")).toBe(false);
    expect(isSku(undefined)).toBe(false);
    expect(isPlanSku("pro")).toBe(true);
    expect(isPlanSku("pack10")).toBe(false);
  });

  it("localizes offer names", () => {
    expect(offerName("pro", "en")).toBe("Pro");
    expect(offerName("pack10", "en")).toBe("10 credits");
    expect(offerName("pack40", "zh")).toBe(PACKS.pack40.name.zh);
  });
});

describe("formatPrice", () => {
  it("prints whole dollars without cents", () => {
    expect(formatPrice(9)).toBe("$9");
    expect(formatPrice(29)).toBe("$29");
    expect(formatPrice(1500)).toBe("$1,500");
  });
  it("always shows two decimals for fractional amounts", () => {
    expect(formatPrice(0.9)).toBe("$0.90");
    expect(formatPrice(0.73)).toBe("$0.73");
  });
  it("renders the per-credit prices the pricing page compares", () => {
    expect(formatPrice(perCreditUsd(PACKS.pack10))).toBe("$0.90");
    expect(formatPrice(perCreditUsd(PACKS.pack40))).toBe("$0.73");
    expect(formatPrice(perCreditUsd(PLANS.pro))).toBe("$0.48");
    // the bigger pack and Pro are cheaper per credit, or the comparison would mislead
    expect(perCreditUsd(PACKS.pack40)).toBeLessThan(perCreditUsd(PACKS.pack10));
    expect(perCreditUsd(PLANS.pro)).toBeLessThan(perCreditUsd(PACKS.pack40));
  });
});

describe("credit rules", () => {
  it("charges one credit per unlock, submission or new outreach contact; follow-ups and practice are free", () => {
    expect(CREDIT_COST).toEqual({ unlockApplication: 1, submitApplication: 1, outreachNewContact: 1, followUp: 0, practice: 0 });
  });
  it("explains the same rules in both languages, with the real unlock price", () => {
    expect(CREDIT_RULES.lines.zh.length).toBe(CREDIT_RULES.lines.en.length);
    expect(CREDIT_RULES.lines.en.some((l) => l.includes(`Unlocking an application costs ${UNLOCK_PRICE} once`))).toBe(true);
    expect(CREDIT_RULES.lines.zh.some((l) => l.includes(UNLOCK_PRICE))).toBe(true);
  });
});
