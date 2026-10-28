/**
 * Re-plans after the first plan (owner decision 2026-10-28): a visitor without an account gets
 * one; an account adds two more — the reason to sign up (the draft, its plans and their count
 * move into the account). Changing the answers on /app/start and switching path on the dashboard
 * both use one. Clearing cookies starts a new draft, which is capped per IP per day (anon.ts).
 */
export const REPLANS = { visitor: 1, accountBonus: 2 } as const;

/** Re-plans left for someone who has made `plans` plans (the first plan is always free). */
export function replansLeft(plans: number, signedIn: boolean): number {
  const allowed = REPLANS.visitor + (signedIn ? REPLANS.accountBonus : 0);
  return Math.max(0, allowed - Math.max(0, plans - 1));
}
