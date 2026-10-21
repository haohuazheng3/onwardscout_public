import { describe, expect, it } from "vitest";
import { OUTREACH_LIMITS, checkFollowUpPolicy, checkOutreachPolicy, isOptOut, isPlainEmail } from "@/lib/channels/outreach-policy";

const NOW = new Date("2026-10-21T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000);
const base = { to: "partner@fund.example", contact: null, newContactsLastDay: 0, newContactsLastWeek: 0, isMinor: false, now: NOW };

describe("first emails (new conversations)", () => {
  it("allows a personal email to someone new", () => {
    expect(checkOutreachPolicy(base)).toEqual({ ok: true });
  });

  it("caps new conversations at 20 per 24 hours (retry tomorrow)", () => {
    expect(OUTREACH_LIMITS.newContactsPerDay).toBe(20);
    expect(checkOutreachPolicy({ ...base, newContactsLastDay: 19 }).ok).toBe(true);
    const r = checkOutreachPolicy({ ...base, newContactsLastDay: 20 });
    expect(r).toMatchObject({ ok: false, code: "daily_limit", retryable: true });
    if (!r.ok) expect(r.retryAt?.getTime()).toBe(NOW.getTime() + 24 * 3600_000);
  });

  it("caps new conversations per week", () => {
    expect(checkOutreachPolicy({ ...base, newContactsLastDay: 3, newContactsLastWeek: OUTREACH_LIMITS.newContactsPerWeek })).toMatchObject({ ok: false, code: "weekly_limit", retryable: true });
  });

  it("never writes to the same person again within 30 days", () => {
    const r = checkOutreachPolicy({ ...base, contact: { doNotContact: false, lastContactedAt: days(29) } });
    expect(r).toMatchObject({ ok: false, code: "recently_contacted", retryable: false });
    if (!r.ok) {
      expect(r.message).toMatch(/30 days/);
      expect(r.retryAt?.toISOString().slice(0, 10)).toBe("2026-10-22");
    }
    expect(checkOutreachPolicy({ ...base, contact: { doNotContact: false, lastContactedAt: days(31) } }).ok).toBe(true);
  });

  it("respects do-not-contact and minors before anything else", () => {
    expect(checkOutreachPolicy({ ...base, contact: { doNotContact: true, lastContactedAt: null } })).toMatchObject({ ok: false, code: "do_not_contact", retryable: false });
    expect(checkOutreachPolicy({ ...base, isMinor: true, newContactsLastDay: 99 })).toMatchObject({ ok: false, code: "minor", retryable: false });
  });

  it("refuses anything that isn't one plain address", () => {
    expect(checkOutreachPolicy({ ...base, to: "a@example.com, b@example.com" })).toMatchObject({ ok: false, code: "invalid_email" });
    expect(checkOutreachPolicy({ ...base, to: "not-an-email" })).toMatchObject({ ok: false, code: "invalid_email" });
    expect(isPlainEmail("li.wei+apply@example.co.uk")).toBe(true);
  });
});

describe("follow-ups in the same thread", () => {
  const f = { attempt: 1, replied: false, doNotContact: false, lastSentAt: days(5), now: NOW };
  it("allows a polite follow-up after a few days", () => {
    expect(checkFollowUpPolicy(f)).toEqual({ ok: true });
  });
  it("stops once they replied, opted out, or after the last allowed follow-up", () => {
    expect(checkFollowUpPolicy({ ...f, replied: true })).toMatchObject({ ok: false, retryable: false });
    expect(checkFollowUpPolicy({ ...f, doNotContact: true })).toMatchObject({ ok: false, retryable: false });
    expect(checkFollowUpPolicy({ ...f, attempt: OUTREACH_LIMITS.maxFollowUps + 1 })).toMatchObject({ ok: false, retryable: false });
    expect(checkFollowUpPolicy({ ...f, lastSentAt: null })).toMatchObject({ ok: false, retryable: false });
  });
  it("waits at least the minimum gap", () => {
    const r = checkFollowUpPolicy({ ...f, lastSentAt: days(1) });
    expect(r).toMatchObject({ ok: false, retryable: true });
    if (!r.ok) expect(r.retryAt?.getTime()).toBe(days(1).getTime() + OUTREACH_LIMITS.followUpMinDays * 24 * 3600_000);
  });
});

describe("opt-outs", () => {
  it("recognises requests to stop, in English and Chinese", () => {
    for (const t of ["Please remove me from your list.", "Unsubscribe", "Don't contact me again.", "please stop emailing me", "请不要再联系我", "退订"]) expect(isOptOut(t)).toBe(true);
  });
  it("does not mistake a polite no for an opt-out", () => {
    for (const t of ["Thanks, but we're not investing in this stage right now.", "Let's talk next week.", "Can you send the deck?"]) expect(isOptOut(t)).toBe(false);
  });
});
