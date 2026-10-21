import { describe, expect, it } from "vitest";
import { OPPORTUNITY_GROUPS, OPPORTUNITY_TYPES } from "@/lib/core";
import {
  AUTO_SUBMIT_GROUPS,
  DEFAULT_AUTHORIZATION_STATE,
  DEFAULT_PREFS,
  deriveAuthorizationState,
  isAutoSubmitGroup,
  isPrefKey,
  isStandingScope,
  parsePrefs,
  perksFromSubscriptions,
  prefsKey,
  scopesForGroup,
  typesInGroup,
} from "@/lib/authorizations";

/*
 * Settings rules (P6, pure): which authorizations a person has granted, the default-on weekly
 * brief with its opt-out tombstone, email preferences parsing and plan perks.
 */

const revokedAt = new Date("2026-10-01T00:00:00Z");

describe("auto-submit groups", () => {
  it("cover every opportunity group except practice", () => {
    expect([...AUTO_SUBMIT_GROUPS].sort()).toEqual(OPPORTUNITY_GROUPS.filter((g) => g !== "system").sort());
    expect(isAutoSubmitGroup("system")).toBe(false);
    expect(isAutoSubmitGroup("work")).toBe(true);
  });
  it("map a group to the auto_submit scope of each of its types", () => {
    for (const g of AUTO_SUBMIT_GROUPS) {
      const scopes = scopesForGroup(g);
      expect(scopes.length).toBe(typesInGroup(g).length);
      expect(scopes.length).toBeGreaterThan(0);
      for (const s of scopes) expect(s.startsWith("auto_submit:")).toBe(true);
    }
    const all = AUTO_SUBMIT_GROUPS.flatMap((g) => scopesForGroup(g));
    expect(new Set(all).size).toBe(OPPORTUNITY_TYPES.length - 1); // every type but practice, once
    expect(all).not.toContain("auto_submit:practice");
  });
});

describe("deriveAuthorizationState", () => {
  it("is all off by default, except the weekly brief", () => {
    expect(deriveAuthorizationState([])).toEqual(DEFAULT_AUTHORIZATION_STATE);
    expect(DEFAULT_AUTHORIZATION_STATE.weeklyDigest).toBe(true);
    expect(Object.values(DEFAULT_AUTHORIZATION_STATE.autoSubmit).every((v) => v === false)).toBe(true);
    expect(DEFAULT_AUTHORIZATION_STATE.autoFollowup).toBe(false);
  });

  it("turns a group on only when every type in it is granted", () => {
    const funding = scopesForGroup("funding").map((scope) => ({ scope, revokedAt: null }));
    const s = deriveAuthorizationState(funding);
    expect(s.autoSubmit.funding).toBe(true);
    expect(s.autoSubmit.work).toBe(false);
    expect(s.autoSubmitTypes).toEqual(typesInGroup("funding"));

    const partial = deriveAuthorizationState(funding.slice(1));
    expect(partial.autoSubmit.funding).toBe(false);
    expect(partial.autoSubmitTypes.length).toBe(funding.length - 1);
  });

  it("ignores revoked grants", () => {
    const rows = scopesForGroup("creative").map((scope) => ({ scope, revokedAt }));
    rows.push({ scope: "auto_followup", revokedAt });
    const s = deriveAuthorizationState(rows);
    expect(s.autoSubmit.creative).toBe(false);
    expect(s.autoFollowup).toBe(false);
  });

  it("keeps the weekly brief on until a revoked row records the opt-out", () => {
    expect(deriveAuthorizationState([{ scope: "weekly_digest", revokedAt }]).weeklyDigest).toBe(false);
    expect(deriveAuthorizationState([{ scope: "weekly_digest", revokedAt }, { scope: "weekly_digest", revokedAt: null }]).weeklyDigest).toBe(true);
    expect(deriveAuthorizationState([{ scope: "auto_followup", revokedAt: null }]).weeklyDigest).toBe(true);
  });

  it("reads auto follow-ups", () => {
    expect(deriveAuthorizationState([{ scope: "auto_followup", revokedAt: null }]).autoFollowup).toBe(true);
  });
});

describe("notification preferences", () => {
  it("default to email on (it only goes out when product email is configured)", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("garbage")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs([])).toEqual(DEFAULT_PREFS);
  });
  it("keep known booleans and drop everything else", () => {
    expect(parsePrefs({ emailUpdates: false, emailDigest: "no", extra: 1 })).toEqual({ emailUpdates: false, emailDigest: true });
  });
  it("validate keys and scopes", () => {
    expect(isPrefKey("emailDigest")).toBe(true);
    expect(isPrefKey("sms")).toBe(false);
    expect(isStandingScope("weekly_digest")).toBe(true);
    expect(isStandingScope("auto_submit:job")).toBe(false);
    expect(prefsKey("user_1")).toBe("prefs:user_1");
  });
});

describe("perksFromSubscriptions", () => {
  it("grants Pro perks for an entitled Pro subscription", () => {
    expect(perksFromSubscriptions([{ sku: "pro", status: "active" }])).toEqual({ autoFollowUps: true, weeklyDigest: true, priority: true });
    expect(perksFromSubscriptions([{ sku: "pro", status: "past_due" }]).weeklyDigest).toBe(true);
  });
  it("grants nothing for canceled plans, packs or unknown skus", () => {
    const none = { autoFollowUps: false, weeklyDigest: false, priority: false };
    expect(perksFromSubscriptions([])).toEqual(none);
    expect(perksFromSubscriptions([{ sku: "pro", status: "canceled" }])).toEqual(none);
    expect(perksFromSubscriptions([{ sku: "pack10", status: "active" }])).toEqual(none);
    expect(perksFromSubscriptions([{ sku: "enterprise", status: "active" }])).toEqual(none);
  });
});
