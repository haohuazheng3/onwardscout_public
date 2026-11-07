/**
 * One alerting rule for every owner alarm (the GitHub Actions health probe, the hourly job
 * drain): email on a change of state, never on every failed probe.
 *
 *  - DOWN after 2 consecutive failed probes (one blip never pages anyone);
 *  - silence while it stays down, except one reminder per 24 hours;
 *  - one RECOVERED email on the first good probe after a DOWN email.
 *
 * Pure and dependency-free on purpose: `scripts/ops/health-alarm.mjs` imports this file
 * directly with Node's type stripping (only erasable TypeScript syntax here).
 */

export const ALARM_FAILS_TO_ALERT = 2;
export const ALARM_REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

export interface AlarmState {
  /** Consecutive failed probes; 0 while healthy. */
  fails: number;
  /** First failure of the current streak (ISO), null while healthy. */
  since: string | null;
  /** Last DOWN or reminder email of the current streak (ISO); null = nobody was told yet. */
  alertedAt: string | null;
}

export type AlarmEmail = "down" | "reminder" | "recovered";

export const HEALTHY: AlarmState = { fails: 0, since: null, alertedAt: null };

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

/** Whatever was stored (missing, older shape, garbage) as a valid state; unknown → healthy. */
export function parseAlarmState(raw: unknown): AlarmState {
  if (!raw || typeof raw !== "object") return { ...HEALTHY };
  const o = raw as Record<string, unknown>;
  const fails = typeof o.fails === "number" && Number.isInteger(o.fails) && o.fails > 0 ? o.fails : 0;
  if (fails === 0) return { ...HEALTHY };
  return { fails, since: isoOrNull(o.since), alertedAt: isoOrNull(o.alertedAt) };
}

/** Folds one probe result into the state and says which email (if any) is due now. */
export function stepAlarm(prev: AlarmState | null | undefined, ok: boolean, now: Date): { state: AlarmState; email: AlarmEmail | null } {
  const p = parseAlarmState(prev);
  if (ok) return { state: { ...HEALTHY }, email: p.alertedAt ? "recovered" : null };
  const fails = p.fails + 1;
  const since = p.since ?? now.toISOString();
  if (!p.alertedAt) {
    if (fails >= ALARM_FAILS_TO_ALERT) return { state: { fails, since, alertedAt: now.toISOString() }, email: "down" };
    return { state: { fails, since, alertedAt: null }, email: null };
  }
  if (now.getTime() - Date.parse(p.alertedAt) >= ALARM_REMIND_EVERY_MS) return { state: { fails, since, alertedAt: now.toISOString() }, email: "reminder" };
  return { state: { fails, since, alertedAt: p.alertedAt }, email: null };
}

/** "3 h 5 min", "12 min", "under a minute": how long a streak has lasted. */
export function downFor(since: string | null, now: Date): string {
  if (!since) return "an unknown time";
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60000));
  if (min < 1) return "under a minute";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  const d = Math.floor(h / 24);
  if (d === 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${d} d ${h % 24} h`;
}
