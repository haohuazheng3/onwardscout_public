/*
 * Outreach rules (build contract honesty rule 4): personal emails only, never bulk. Pure, so
 * the limits are pinned by tests and the same function guards every send.
 *
 *  - at most 20 new conversations per person per rolling 24 hours, and 60 per rolling 7 days;
 *  - never write to the same contact again within 30 days (a follow-up in the same thread is
 *    not a new contact, see `checkFollowUpPolicy`);
 *  - a contact who asked not to be contacted is never written to again, by anyone (the global
 *    list in outreach-blocks.ts);
 *  - minors (identity S1) get no outreach channel at all.
 */

export const OUTREACH_LIMITS = {
  newContactsPerDay: 20,
  newContactsPerWeek: 60,
  sameContactDays: 30,
  /** Follow-ups per thread after the first email. */
  maxFollowUps: 2,
  /** Minimum days between two emails in the same thread. */
  followUpMinDays: 4,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PolicyCode = "invalid_email" | "do_not_contact" | "minor" | "recently_contacted" | "daily_limit" | "weekly_limit";

export type PolicyResult = { ok: true } | { ok: false; code: PolicyCode; message: string; retryable: boolean; retryAt?: Date };

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

export function isPlainEmail(v: string): boolean {
  return v.length <= 254 && EMAIL.test(v.trim());
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface OutreachCheckInput {
  to: string;
  contact: { doNotContact: boolean; lastContactedAt: Date | null } | null;
  /** First emails of new conversations sent in the last 24 hours / 7 days. */
  newContactsLastDay: number;
  newContactsLastWeek: number;
  isMinor: boolean;
  /** The address is on the global opt-out list (another user's recipient asked us to stop). */
  blocked?: boolean;
  now: Date;
}

/** Whether a first email to `to` may be sent now. */
export function checkOutreachPolicy(input: OutreachCheckInput): PolicyResult {
  const { now } = input;
  if (!isPlainEmail(input.to)) {
    return { ok: false, code: "invalid_email", message: `“${input.to.slice(0, 80)}” is not an email address we can write to.`, retryable: false };
  }
  if (input.isMinor) {
    return { ok: false, code: "minor", message: "Email outreach isn't available for high-school students. Use the prepared text with a parent or teacher instead.", retryable: false };
  }
  if (input.contact?.doNotContact || input.blocked) {
    return { ok: false, code: "do_not_contact", message: "This person asked not to be contacted, so we won't write to them.", retryable: false };
  }
  const last = input.contact?.lastContactedAt ?? null;
  if (last && now.getTime() - last.getTime() < OUTREACH_LIMITS.sameContactDays * DAY_MS) {
    const next = new Date(last.getTime() + OUTREACH_LIMITS.sameContactDays * DAY_MS);
    return {
      ok: false,
      code: "recently_contacted",
      message: `You wrote to ${input.to} on ${day(last)}. We wait 30 days before writing to the same person again (from ${day(next)}).`,
      retryable: false,
      retryAt: next,
    };
  }
  if (input.newContactsLastDay >= OUTREACH_LIMITS.newContactsPerDay) {
    return {
      ok: false,
      code: "daily_limit",
      message: `You've started ${OUTREACH_LIMITS.newContactsPerDay} new conversations in the last 24 hours, the daily limit that keeps outreach personal. This email goes out tomorrow.`,
      retryable: true,
      retryAt: new Date(now.getTime() + DAY_MS),
    };
  }
  if (input.newContactsLastWeek >= OUTREACH_LIMITS.newContactsPerWeek) {
    return {
      ok: false,
      code: "weekly_limit",
      message: `You've started ${OUTREACH_LIMITS.newContactsPerWeek} new conversations this week, the weekly limit. This email goes out in a few days.`,
      retryable: true,
      retryAt: new Date(now.getTime() + 2 * DAY_MS),
    };
  }
  return { ok: true };
}

export interface FollowUpCheckInput {
  attempt: number;
  replied: boolean;
  /** The contact opted out, or the address is on the global opt-out list. */
  doNotContact: boolean;
  lastSentAt: Date | null;
  now: Date;
}

export type FollowUpResult = { ok: true } | { ok: false; message: string; retryable: boolean; retryAt?: Date };

/** Whether follow-up number `attempt` (1-based) may be sent in the existing thread. */
export function checkFollowUpPolicy(input: FollowUpCheckInput): FollowUpResult {
  if (input.replied) return { ok: false, message: "They already replied, so no follow-up is needed.", retryable: false };
  if (input.doNotContact) return { ok: false, message: "This person asked not to be contacted, so we won't follow up.", retryable: false };
  if (!input.lastSentAt) return { ok: false, message: "There is no sent email to follow up on yet.", retryable: false };
  if (input.attempt > OUTREACH_LIMITS.maxFollowUps) {
    return { ok: false, message: `We send at most ${OUTREACH_LIMITS.maxFollowUps} polite follow-ups per conversation.`, retryable: false };
  }
  const wait = OUTREACH_LIMITS.followUpMinDays * DAY_MS;
  if (input.now.getTime() - input.lastSentAt.getTime() < wait) {
    return { ok: false, message: `The last email went out on ${day(input.lastSentAt)}; a follow-up waits at least ${OUTREACH_LIMITS.followUpMinDays} days.`, retryable: true, retryAt: new Date(input.lastSentAt.getTime() + wait) };
  }
  return { ok: true };
}

/** "Please remove me", "unsubscribe", "don't contact me again" (and Chinese) → opt-out. */
export function isOptOut(text: string): boolean {
  return /\b(unsubscribe|remove me from|take me off|stop (emailing|contacting|writing)|do not (contact|email|write to) me|don'?t (contact|email|write to) me( again)?|please don'?t (reach out|contact)|not interested,? (please )?(stop|don'?t))\b|退订|不要再(联系|发)|请勿再|别再(联系|发)/i.test(
    text,
  );
}
