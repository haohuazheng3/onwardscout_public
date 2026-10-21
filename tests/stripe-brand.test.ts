import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_BRAND,
  checkoutMetadata,
  fitStatementSuffix,
  STATEMENT_DESCRIPTOR_MAX,
  STATEMENT_PREFIX_MAX,
  statementSuffix,
  stripeEnvTag,
  stripeLocale,
} from "@/lib/stripe";

afterEach(() => vi.unstubAllEnvs());

/*
 * Everything a buyer reads before paying says Onward Scout, and the card statement fits Stripe's
 * 22 characters once the account's own prefix is in front of it.
 */
describe("Checkout brand whitelist", () => {
  it("shows the brand name as text with a small icon, never a logo image", () => {
    expect(CHECKOUT_BRAND.site).toBe("onwardscout");
    expect(CHECKOUT_BRAND.displayName).toBe("Onward Scout");
    expect(CHECKOUT_BRAND.iconUrl).toMatch(/^https?:\/\/[^/]+\/brand\/logo-512\.png$/);
    expect(CHECKOUT_BRAND).not.toHaveProperty("logoUrl");
    expect(CHECKOUT_BRAND).not.toHaveProperty("logo");
  });

  it("uses the blaze accent on the pay button and names the brand under it", () => {
    expect(CHECKOUT_BRAND.buttonColor).toBe("#E4572E");
    expect(CHECKOUT_BRAND.submitNote).toBe("Credits land in your Onward Scout account the moment payment completes.");
    expect(CHECKOUT_BRAND.submitNote.length).toBeLessThanOrEqual(1200); // Stripe's custom_text limit
  });

  it("stamps every session, subscription and payment intent with site, env, user and sku", () => {
    const meta = checkoutMetadata("user_abc", "pack40");
    expect(meta).toEqual({ site: "onwardscout", env: stripeEnvTag(), userId: "user_abc", sku: "pack40" });
    for (const v of Object.values(meta)) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeLessThanOrEqual(500); // Stripe metadata values
    }
  });

  it("opens Stripe's pages in the reader's language", () => {
    expect(stripeLocale("zh")).toBe("zh");
    expect(stripeLocale("en")).toBe("en");
  });
});

describe("card statement descriptor", () => {
  it("is Latin, upper case and free of the characters Stripe rejects", () => {
    const suffix = CHECKOUT_BRAND.statementSuffix;
    expect(suffix).toBe("ONWARDSCOUT");
    expect(suffix).toMatch(/^[A-Z0-9 ]+$/);
    expect(suffix).not.toMatch(/[<>\\'"*]/);
  });

  it("keeps the whole name when the prefix leaves room", () => {
    expect(fitStatementSuffix("ONWARDSCOUT", "ONWARD")).toBe("ONWARDSCOUT");
    expect(fitStatementSuffix("ONWARDSCOUT", "ONWARDSCT")).toBe("ONWARDSCOUT");
  });

  it("trims the suffix so prefix + '* ' + suffix never exceeds 22 characters", () => {
    for (const prefix of ["AB", "ONWARD", "ONWARDSCT", "ONWARDSCOU", "LONGPREFIX"]) {
      const suffix = fitStatementSuffix(CHECKOUT_BRAND.statementSuffix, prefix);
      expect(prefix.length + 2 + suffix.length).toBeLessThanOrEqual(STATEMENT_DESCRIPTOR_MAX);
      expect(CHECKOUT_BRAND.statementSuffix.startsWith(suffix)).toBe(true);
    }
    expect(fitStatementSuffix("ONWARDSCOUT", "LONGPREFIX")).toBe("ONWARD");
    expect(fitStatementSuffix("ONWARDSCOUT")).toBe("ONWARD");
    expect(fitStatementSuffix("ONWARDSCOUT", "FTL")).toBe("ONWARDSCOUT");
  });

  it("assumes the longest prefix Stripe allows when the account's prefix is unknown", () => {
    expect(STATEMENT_PREFIX_MAX).toBe(10);
    // 10 characters of room: the full name does not fit, so the readable short form is used.
    expect(fitStatementSuffix("ONWARDSCOUT").length).toBeLessThanOrEqual(STATEMENT_DESCRIPTOR_MAX - STATEMENT_PREFIX_MAX - 2);
    expect(fitStatementSuffix("ONWARDSCOUT", "  ")).toBe("ONWARD");
  });

  it("strips characters Stripe refuses and upper-cases the rest", () => {
    expect(fitStatementSuffix(`on*ward<scout>"`, "AB")).toBe("ONWARDSCOUT");
    expect(fitStatementSuffix("onward scout", "AB")).toBe("ONWARD SCOUT");
  });

  it("reads the account prefix from STRIPE_STATEMENT_PREFIX", () => {
    vi.stubEnv("STRIPE_STATEMENT_PREFIX", "");
    expect(statementSuffix()).toBe("ONWARD");
    vi.stubEnv("STRIPE_STATEMENT_PREFIX", "ONWARD");
    expect(statementSuffix()).toBe("ONWARDSCOUT");
  });
});
