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
  PLANS,
  SKUS,
  TRIAL,
  validityDays,
} from "@/content/plans";

describe("catalog", () => {
  it("sells exactly Pro, a 10-credit pack and a 40-credit pack", () => {
    expect([...SKUS]).toEqual(["pro", "pack10", "pack40"]);
    expect([...PLAN_SKUS]).toEqual(["pro"]);
    expect([...PACK_SKUS]).toEqual(["pack10", "pack40"]);
    expect(Object.keys(OFFERS)).toEqual([...SKUS]);
  });

  it("keeps the published prices, credits and validity", () => {
    expect([PLANS.pro.priceUsd, PLANS.pro.credits, PLANS.pro.interval, PLANS.pro.rolloverDays]).toEqual([29, 60, "month", 30]);
    expect([PACKS.pack10.priceUsd, PACKS.pack10.credits, PACKS.pack10.interval, PACKS.pack10.rolloverDays]).toEqual([9, 10, null, 180]);
    expect([PACKS.pack40.priceUsd, PACKS.pack40.credits, PACKS.pack40.interval, PACKS.pack40.rolloverDays]).toEqual([29, 40, null, 180]);
    expect(TRIAL).toEqual({ credits: 3, expiryDays: 60 });
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
  it("charges one credit per submission or new outreach contact; follow-ups and practice are free", () => {
    expect(CREDIT_COST).toEqual({ submitApplication: 1, outreachNewContact: 1, followUp: 0, practice: 0 });
  });
  it("explains the same rules in both languages, with the real trial numbers", () => {
    expect(CREDIT_RULES.lines.zh.length).toBe(CREDIT_RULES.lines.en.length);
    expect(CREDIT_RULES.lines.en.some((l) => l.includes(`${TRIAL.credits} free credits`) && l.includes(`${TRIAL.expiryDays} days`))).toBe(true);
    expect(CREDIT_RULES.lines.zh.some((l) => l.includes(String(TRIAL.credits)) && l.includes(String(TRIAL.expiryDays)))).toBe(true);
  });
});
