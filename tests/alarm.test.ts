import { describe, expect, it } from "vitest";
import { ALARM_REMIND_EVERY_MS, downFor, HEALTHY, parseAlarmState, stepAlarm, type AlarmState } from "@/lib/alarm";

/** Feeds probe results one by one and collects the emails the rule asks for. */
function run(results: Array<[ok: boolean, atMs: number]>, start: AlarmState | null = null) {
  let state = start;
  const emails: Array<string | null> = [];
  for (const [ok, at] of results) {
    const step = stepAlarm(state, ok, new Date(at));
    state = step.state;
    emails.push(step.email);
  }
  return { state, emails };
}

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-06T00:00:00Z");

describe("owner alarm rule (state change only, debounced)", () => {
  it("never emails while healthy", () => {
    expect(run([[true, T0], [true, T0 + H], [true, T0 + 2 * H]]).emails).toEqual([null, null, null]);
  });

  it("ignores a single failed probe (no DOWN, no RECOVERED)", () => {
    const r = run([[false, T0], [true, T0 + H]]);
    expect(r.emails).toEqual([null, null]);
    expect(r.state).toEqual(HEALTHY);
  });

  it("emails DOWN on the second consecutive failure, then stays silent", () => {
    const r = run([[false, T0], [false, T0 + 60_000], [false, T0 + 6 * H], [false, T0 + 12 * H], [false, T0 + 18 * H]]);
    expect(r.emails).toEqual([null, "down", null, null, null]);
    expect(r.state).toMatchObject({ fails: 5, since: new Date(T0).toISOString(), alertedAt: new Date(T0 + 60_000).toISOString() });
  });

  it("sends at most one reminder per 24 hours while it stays down", () => {
    const probes: Array<[boolean, number]> = [];
    for (let h = 0; h <= 50; h++) probes.push([false, T0 + h * H]);
    const { emails } = run(probes);
    expect(emails.filter((e) => e === "down")).toHaveLength(1);
    expect(emails.filter((e) => e === "reminder")).toHaveLength(2);
    expect(emails[1]).toBe("down");
    expect(emails[1 + ALARM_REMIND_EVERY_MS / H]).toBe("reminder");
  });

  it("emails RECOVERED once, only after a DOWN email", () => {
    const r = run([[false, T0], [false, T0 + H], [true, T0 + 2 * H], [true, T0 + 3 * H]]);
    expect(r.emails).toEqual([null, "down", "recovered", null]);
    expect(r.state).toEqual(HEALTHY);
  });

  it("treats missing or malformed stored state as healthy", () => {
    expect(parseAlarmState(undefined)).toEqual(HEALTHY);
    expect(parseAlarmState("nope")).toEqual(HEALTHY);
    expect(parseAlarmState({ fails: -3 })).toEqual(HEALTHY);
    expect(parseAlarmState({ fails: 2, since: "garbage", alertedAt: 5 })).toEqual({ fails: 2, since: null, alertedAt: null });
    // An old/odd state with a streak but no alert still pages on the next failure.
    expect(stepAlarm({ fails: 1, since: null, alertedAt: null }, false, new Date(T0)).email).toBe("down");
  });

  it("describes how long a streak lasted", () => {
    const now = new Date(T0);
    expect(downFor(null, now)).toBe("an unknown time");
    expect(downFor(new Date(T0 - 20_000).toISOString(), now)).toBe("under a minute");
    expect(downFor(new Date(T0 - 12 * 60_000).toISOString(), now)).toBe("12 min");
    expect(downFor(new Date(T0 - (3 * H + 5 * 60_000)).toISOString(), now)).toBe("3 h 5 min");
    expect(downFor(new Date(T0 - 26 * H).toISOString(), now)).toBe("1 d 2 h");
  });
});
