import "server-only";
import { type AlarmEmail, type AlarmState, downFor, parseAlarmState, stepAlarm } from "./alarm";
import { putObject, readObject } from "./files";
import { notifyOwner } from "./notify";

/**
 * A server-side alarm (today: the hourly job drain, which is also the database probe) with the
 * rule of src/lib/alarm.ts: DOWN after 2 consecutive failed runs, one reminder per 24 h, one
 * RECOVERED email. Its memory lives in R2 (`ops/alarms/<name>.json`, through the files worker),
 * not in Postgres: the database being down is the most likely reason the drain fails.
 * Never throws. When the memory itself is unreadable a failure is still emailed (fail open).
 */
export async function reportAlarm(input: { name: string; title: string; ok: boolean; detail: string; now?: Date }): Promise<AlarmEmail | null> {
  const now = input.now ?? new Date();
  const key = `ops/alarms/${input.name}.json`;
  let prev: AlarmState;
  try {
    const bytes = await readObject(key);
    prev = parseAlarmState(bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null);
  } catch (err) {
    console.error(`[alarm:${input.name}] state unreadable`, err);
    if (!input.ok) await notifyOwner({ subject: `DOWN: ${input.title}`, text: `${input.detail}\n\n(The alarm's memory in R2 is unreachable too, so this may repeat on every failed run.)` });
    return input.ok ? null : "down";
  }

  const { state, email } = stepAlarm(prev, input.ok, now);
  let next = state;
  if (email) {
    const sent = await notifyOwner(message(input.title, email, prev, state, input.detail, now));
    // Not told: keep the streak, forget the alert, so the next run tries again.
    if (!sent && email !== "recovered") next = { ...state, alertedAt: prev.alertedAt };
  }
  if (JSON.stringify(next) !== JSON.stringify(prev)) {
    await putObject(key, new TextEncoder().encode(JSON.stringify(next)), "application/json").catch((err: unknown) => console.error(`[alarm:${input.name}] state not saved`, err));
  }
  return email;
}

function message(title: string, email: AlarmEmail, prev: AlarmState, state: AlarmState, detail: string, now: Date): { subject: string; text: string } {
  if (email === "recovered") return { subject: `RECOVERED: ${title}`, text: `It works again after about ${downFor(prev.since, now)}.\n\n${detail}` };
  const policy = "You get one reminder a day while it keeps failing and one email when it recovers.";
  const subject = email === "down" ? `DOWN: ${title}` : `Still DOWN: ${title} (${downFor(state.since, now)})`;
  return { subject, text: `${state.fails} runs in a row have failed, the first at ${state.since}.\n\n${detail}\n\n${policy}` };
}
