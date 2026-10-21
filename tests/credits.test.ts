import { describe, expect, it } from "vitest";
import { PACKS, PLANS, TRIAL } from "@/content/plans";
import {
  adjustSourceKey,
  computeBalance,
  EXPIRING_SOON_DAYS,
  expiringSoon,
  isCreditHolder,
  isUsable,
  latestRound,
  lotExpiryFor,
  lotStatus,
  onlyTrial,
  orderForDebit,
  parseRoundKey,
  planReservation,
  remainingFromEvents,
  reservedFromEvents,
  roundKey,
  sumAvailable,
  trialExpiry,
  trialSourceKey,
} from "@/lib/credits";
import type { CreditEventKind, LotKind } from "@/lib/core/types";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-21T12:00:00Z");
const lot = (id: string, remaining: number, expiresInDays: number | null, opts: { createdDaysAgo?: number; status?: string; kind?: LotKind } = {}) => ({
  id,
  kind: opts.kind ?? ("pack" as LotKind),
  remaining,
  total: Math.max(remaining, 1),
  expiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY),
  createdAt: new Date(now.getTime() - (opts.createdDaysAgo ?? 0) * DAY),
  status: opts.status ?? "active",
});
const ev = (applicationId: string | null, kind: CreditEventKind, amount: number) => ({ applicationId, kind, amount });

describe("lot selection (FIFO by expiry)", () => {
  it("ignores expired, empty and revoked lots", () => {
    const lots = [lot("expired", 5, -1), lot("empty", 0, 10), lot("revoked", 5, 10, { status: "revoked" }), lot("ok", 3, 10)];
    expect(lots.filter((l) => isUsable(l, now)).map((l) => l.id)).toEqual(["ok"]);
    expect(sumAvailable(lots, now)).toBe(3);
  });

  it("treats a lot expiring exactly now as gone", () => {
    expect(isUsable({ remaining: 2, expiresAt: new Date(now), status: "active" }, now)).toBe(false);
  });

  it("takes from the earliest-expiring lot first, never-expiring lots last", () => {
    const lots = [lot("forever", 10, null), lot("pack", 10, 170), lot("trial", 3, 20, { kind: "trial" }), lot("pro", 60, 45, { kind: "subscription" })];
    expect(orderForDebit(lots, now).map((l) => l.id)).toEqual(["trial", "pro", "pack", "forever"]);
  });

  it("breaks expiry ties by age", () => {
    const lots = [lot("newer", 1, 30, { createdDaysAgo: 1 }), lot("older", 1, 30, { createdDaysAgo: 10 })];
    expect(orderForDebit(lots, now).map((l) => l.id)).toEqual(["older", "newer"]);
  });

  it("splits a reservation across lots and refuses when short", () => {
    const lots = [lot("a", 1, 5), lot("b", 2, 20), lot("c", 5, null)];
    expect(planReservation(lots, 1, now)).toEqual([{ lotId: "a", take: 1 }]);
    expect(planReservation(lots, 4, now)).toEqual([
      { lotId: "a", take: 1 },
      { lotId: "b", take: 2 },
      { lotId: "c", take: 1 },
    ]);
    expect(planReservation(lots, 8, now)).toEqual([
      { lotId: "a", take: 1 },
      { lotId: "b", take: 2 },
      { lotId: "c", take: 5 },
    ]);
    expect(planReservation(lots, 9, now)).toBeNull();
  });

  it("refuses amounts that are not positive whole numbers", () => {
    const lots = [lot("a", 5, 5)];
    expect(planReservation(lots, 0, now)).toBeNull();
    expect(planReservation(lots, -1, now)).toBeNull();
    expect(planReservation(lots, 1.5, now)).toBeNull();
    expect(planReservation(lots, Number.NaN, now)).toBeNull();
  });

  it("one submitted application costs exactly one credit from the trial first", () => {
    const lots = [lot("pack", 10, 180), lot("trial", TRIAL.credits, TRIAL.expiryDays, { kind: "trial" })];
    expect(planReservation(lots, 1, now)).toEqual([{ lotId: "trial", take: 1 }]);
  });
});

describe("ledger arithmetic", () => {
  it("rebuilds remaining from reserve/release only; debits move nothing", () => {
    expect(remainingFromEvents(10, [])).toBe(10);
    expect(remainingFromEvents(10, [{ kind: "reserve", amount: 3 }])).toBe(7);
    expect(remainingFromEvents(10, [{ kind: "reserve", amount: 3 }, { kind: "debit", amount: 3 }])).toBe(7);
    expect(remainingFromEvents(10, [{ kind: "reserve", amount: 3 }, { kind: "release", amount: 3 }])).toBe(10);
    expect(remainingFromEvents(10, [{ kind: "grant", amount: 10 }, { kind: "revoke", amount: 10 }])).toBe(10);
  });

  it("never goes below zero or above the total", () => {
    expect(remainingFromEvents(2, [{ kind: "reserve", amount: 5 }])).toBe(0);
    expect(remainingFromEvents(2, [{ kind: "release", amount: 5 }])).toBe(2);
  });

  it("counts held credits as reserves minus debits and releases", () => {
    expect(reservedFromEvents([])).toBe(0);
    expect(reservedFromEvents([{ kind: "grant", amount: 10 }, { kind: "reserve", amount: 2 }])).toBe(2);
    expect(reservedFromEvents([{ kind: "reserve", amount: 2 }, { kind: "debit", amount: 1 }])).toBe(1);
    expect(reservedFromEvents([{ kind: "reserve", amount: 1 }, { kind: "release", amount: 1 }, { kind: "revoke", amount: 4 }])).toBe(0);
    expect(reservedFromEvents([{ kind: "release", amount: 3 }])).toBe(0);
  });
});

describe("reservation rounds (an ended application can be reopened)", () => {
  it("keys round 1 by the application id and later rounds by #r<n>", () => {
    expect(roundKey("app_x", 1)).toBe("app_x");
    expect(roundKey("app_x", 0)).toBe("app_x");
    expect(roundKey("app_x", 2)).toBe("app_x#r2");
    expect(parseRoundKey("app_x")).toEqual({ applicationId: "app_x", round: 1 });
    expect(parseRoundKey("app_x#r3")).toEqual({ applicationId: "app_x", round: 3 });
    expect(parseRoundKey(roundKey("app_k3v9q2m8x1d4f6h7", 12))).toEqual({ applicationId: "app_k3v9q2m8x1d4f6h7", round: 12 });
  });

  it("reads where the latest round stands", () => {
    expect(latestRound([])).toEqual({ round: 0, key: null, state: "none", reserved: 0 });
    expect(latestRound([ev(null, "grant", 3)])).toEqual({ round: 0, key: null, state: "none", reserved: 0 });
    expect(latestRound([ev("app_x", "reserve", 1)])).toEqual({ round: 1, key: "app_x", state: "held", reserved: 1 });
    expect(latestRound([ev("app_x", "reserve", 1), ev("app_x", "debit", 1)]).state).toBe("debited");
    expect(latestRound([ev("app_x", "reserve", 1), ev("app_x", "release", 1)]).state).toBe("released");
  });

  it("a reopened application holds again under the next round, independent of the released one", () => {
    const events = [ev("app_x", "reserve", 1), ev("app_x", "release", 1), ev("app_x#r2", "reserve", 1)];
    expect(latestRound(events)).toEqual({ round: 2, key: "app_x#r2", state: "held", reserved: 1 });
    expect(latestRound([...events, ev("app_x#r2", "debit", 1)]).state).toBe("debited");
  });

  it("splits across lots within a round are summed", () => {
    expect(latestRound([ev("app_x", "reserve", 1), ev("app_x", "reserve", 2)]).reserved).toBe(3);
  });
});

describe("balance", () => {
  it("announces the next credits to expire within the window", () => {
    const lots = [lot("pack", 10, 170), lot("trial", 2, 5, { kind: "trial" }), lot("other", 1, 5, { kind: "adjust" })];
    expect(expiringSoon(lots, now)).toEqual({ amount: 3, at: new Date(now.getTime() + 5 * DAY) });
    expect(expiringSoon([lot("pack", 10, 170)], now)).toBeNull();
    expect(expiringSoon([lot("pack", 10, EXPIRING_SOON_DAYS)], now)).toEqual({ amount: 10, at: new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY) });
    expect(expiringSoon([lot("used", 0, 3), lot("gone", 4, -1)], now)).toBeNull();
    expect(expiringSoon([lot("forever", 4, null)], now)).toBeNull();
  });

  it("knows when every usable credit is a trial credit", () => {
    expect(onlyTrial([lot("t", 3, 50, { kind: "trial" })], now)).toBe(true);
    expect(onlyTrial([lot("t", 3, 50, { kind: "trial" }), lot("p", 10, 170)], now)).toBe(false);
    expect(onlyTrial([lot("t", 3, 50, { kind: "trial" }), lot("p", 0, 170)], now)).toBe(true);
    expect(onlyTrial([], now)).toBe(false);
  });

  it("computes the shell's balance from lots and ledger", () => {
    const lots = [lot("trial", 2, 10, { kind: "trial" }), lot("pack", 10, 170)];
    const events = [
      { kind: "grant" as const, amount: 3 },
      { kind: "reserve" as const, amount: 1 },
    ];
    expect(computeBalance(lots, events, now)).toEqual({
      available: 12,
      reserved: 1,
      expiringSoon: { amount: 2, at: new Date(now.getTime() + 10 * DAY) },
      trialOnly: false,
    });
  });
});

describe("lot expiry", () => {
  const periodEnd = new Date("2026-11-21T00:00:00Z");
  it("Pro credits stay usable for the rollover days after the billing period", () => {
    expect(lotExpiryFor("pro", { periodEnd }).getTime()).toBe(periodEnd.getTime() + PLANS.pro.rolloverDays * DAY);
    expect(PLANS.pro.rolloverDays).toBe(30);
  });
  it("packs last 180 days from purchase", () => {
    expect(lotExpiryFor("pack10", { purchasedAt: now }).getTime()).toBe(now.getTime() + 180 * DAY);
    expect(lotExpiryFor("pack40", { purchasedAt: now }).getTime()).toBe(now.getTime() + PACKS.pack40.rolloverDays * DAY);
  });
  it("a plan without a period end is a programming error", () => {
    expect(() => lotExpiryFor("pro", {})).toThrow();
  });
  it("the trial lasts 60 days and is keyed per user", () => {
    expect(trialExpiry(now).getTime()).toBe(now.getTime() + 60 * DAY);
    expect(TRIAL.credits).toBe(3);
    expect(trialSourceKey("user_abc")).toBe("trial:user_abc");
    expect(adjustSourceKey("user_abc", "goodwill-1")).toBe("adjust:user_abc:goodwill-1");
  });
});

describe("lot status and holders", () => {
  it("reads a lot as active, used up, expired or revoked", () => {
    expect(lotStatus(lot("a", 2, 10), now)).toBe("active");
    expect(lotStatus(lot("a", 0, 10), now)).toBe("usedUp");
    expect(lotStatus(lot("a", 2, -1), now)).toBe("expired");
    expect(lotStatus(lot("a", 0, -1), now)).toBe("expired");
    expect(lotStatus(lot("a", 2, 10, { status: "revoked" }), now)).toBe("revoked");
    expect(lotStatus(lot("a", 2, null), now)).toBe("active");
  });
  it("never lets an anonymous draft hold credits", () => {
    expect(isCreditHolder("user_2abc")).toBe(true);
    expect(isCreditHolder("anon_k3v9q2m8x1d4f6h7")).toBe(false);
    expect(isCreditHolder("")).toBe(false);
  });
});
