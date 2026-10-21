import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AUTHORIZATION_FIXED_SCOPES,
  OPPORTUNITY_TYPES,
  autoSubmitScope,
  type AuthorizationScope,
  type OpportunityGroup,
  type OpportunityTypeId,
} from "@/lib/core";
import { PLANS, isPlanSku } from "@/content/plans";
import { db } from "@/lib/db";
import { appState, authorizations, subscriptions } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/*
 * Standing authorizations and notification preferences (Settings, P6).
 *
 * Authorizations live in the `authorizations` table, one active row per (user, scope):
 *  - `auto_submit:<opportunityType>` — submit a fully prepared application of that type
 *    without waiting for the person's tap. OFF by default; Settings grants a whole group of
 *    types at once (work, startups, funding…). Consumers: P3a's application engine calls
 *    `canAutoSubmit(userId, type)` right before it would ask for the confirming tap.
 *  - `auto_followup` — send the scheduled follow-up email without asking. OFF by default.
 *    Consumer: the `application.followup` handler (`autoFollowUpAllowed`).
 *  - `weekly_digest` — the Monday brief. ON by default: a user who never touched the switch
 *    has no row at all; switching it off leaves a revoked row (a tombstone), so "never
 *    decided" and "turned off" stay distinguishable.
 *
 * Email preferences are not authorizations (nothing is done on the person's behalf), so they
 * live in `app_state` under `prefs:<userId>` (deleted with the account, included in the export).
 */

/* ------------------------------------------------------------------ groups */

/** Groups the person can authorise for auto-submit (the practice group is never auto-submitted). */
export const AUTO_SUBMIT_GROUPS = [
  "work",
  "venture",
  "funding",
  "academic",
  "education",
  "creative",
  "visibility",
  "community",
  "mobility",
] as const satisfies readonly OpportunityGroup[];
export type AutoSubmitGroup = (typeof AUTO_SUBMIT_GROUPS)[number];

export function isAutoSubmitGroup(v: unknown): v is AutoSubmitGroup {
  return typeof v === "string" && (AUTO_SUBMIT_GROUPS as readonly string[]).includes(v);
}

/** Every opportunity type of a group, in catalog order. */
export function typesInGroup(group: OpportunityGroup): OpportunityTypeId[] {
  return OPPORTUNITY_TYPES.filter((t) => t.group === group).map((t) => t.id);
}

/** The `auto_submit:*` scopes a group switch grants or revokes. */
export function scopesForGroup(group: AutoSubmitGroup): AuthorizationScope[] {
  return typesInGroup(group).map((t) => autoSubmitScope(t));
}

export type StandingScope = (typeof AUTHORIZATION_FIXED_SCOPES)[number];

export function isStandingScope(v: unknown): v is StandingScope {
  return typeof v === "string" && (AUTHORIZATION_FIXED_SCOPES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ pure state */

export interface AuthorizationRowLite {
  scope: string;
  revokedAt: Date | string | null;
}

export interface AuthorizationState {
  /** A group is on when every type in it is authorised. */
  autoSubmit: Record<AutoSubmitGroup, boolean>;
  /** Every type with an active auto-submit grant (a group may be partially granted by older data). */
  autoSubmitTypes: OpportunityTypeId[];
  autoFollowup: boolean;
  weeklyDigest: boolean;
}

/** Defaults for a person who has never opened Settings. */
export const DEFAULT_AUTHORIZATION_STATE: AuthorizationState = {
  autoSubmit: Object.fromEntries(AUTO_SUBMIT_GROUPS.map((g) => [g, false])) as Record<AutoSubmitGroup, boolean>,
  autoSubmitTypes: [],
  autoFollowup: false,
  weeklyDigest: true,
};

/** Derives the settings view from every authorization row of one user (active and revoked). */
export function deriveAuthorizationState(rows: readonly AuthorizationRowLite[]): AuthorizationState {
  const active = new Set(rows.filter((r) => !r.revokedAt).map((r) => r.scope));
  const everDigest = rows.some((r) => r.scope === "weekly_digest");
  const autoSubmitTypes = OPPORTUNITY_TYPES.filter((t) => active.has(autoSubmitScope(t.id))).map((t) => t.id);
  const autoSubmit = Object.fromEntries(
    AUTO_SUBMIT_GROUPS.map((g) => {
      const scopes = scopesForGroup(g);
      return [g, scopes.length > 0 && scopes.every((s) => active.has(s))];
    }),
  ) as Record<AutoSubmitGroup, boolean>;
  return {
    autoSubmit,
    autoSubmitTypes,
    autoFollowup: active.has("auto_followup"),
    // On by default: off only once the person switched it off (a revoked row and no active one).
    weeklyDigest: active.has("weekly_digest") || !everDigest,
  };
}

/* ------------------------------------------------------------------ email preferences (pure) */

export interface NotificationPrefs {
  /** "Needs you", submitted, replies, progress, billing… by email (when product email is configured). */
  emailUpdates: boolean;
  /** The weekly brief by email (Pro perk, when product email is configured). */
  emailDigest: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { emailUpdates: true, emailDigest: true };
export const PREF_KEYS = ["emailUpdates", "emailDigest"] as const satisfies readonly (keyof NotificationPrefs)[];
export type PrefKey = (typeof PREF_KEYS)[number];

export function isPrefKey(v: unknown): v is PrefKey {
  return typeof v === "string" && (PREF_KEYS as readonly string[]).includes(v);
}

/** Tolerant parse of the stored jsonb: unknown keys dropped, missing ones default. */
export function parsePrefs(value: unknown): NotificationPrefs {
  const o = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    emailUpdates: typeof o.emailUpdates === "boolean" ? o.emailUpdates : DEFAULT_PREFS.emailUpdates,
    emailDigest: typeof o.emailDigest === "boolean" ? o.emailDigest : DEFAULT_PREFS.emailDigest,
  };
}

export function prefsKey(userId: string): string {
  return `prefs:${userId}`;
}

/* ------------------------------------------------------------------ plan perks (read-only) */

export interface Perks {
  autoFollowUps: boolean;
  weeklyDigest: boolean;
  priority: boolean;
}

export const NO_PERKS: Perks = { autoFollowUps: false, weeklyDigest: false, priority: false };

/** Stripe statuses under which the plan's perks apply. */
export const ENTITLED_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/** Perks of the best plan among a user's subscriptions (pure; packs carry no perks). */
export function perksFromSubscriptions(rows: readonly { sku: string; status: string }[]): Perks {
  const out: Perks = { ...NO_PERKS };
  for (const r of rows) {
    if (!(ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(r.status) || !isPlanSku(r.sku)) continue;
    const p = PLANS[r.sku].perks;
    out.autoFollowUps ||= p.autoFollowUps;
    out.weeklyDigest ||= p.weeklyDigest;
    out.priority ||= p.priority;
  }
  return out;
}

/* ------------------------------------------------------------------ database */

async function rowsFor(userId: string): Promise<AuthorizationRowLite[]> {
  return db.select({ scope: authorizations.scope, revokedAt: authorizations.revokedAt }).from(authorizations).where(eq(authorizations.userId, userId));
}

export async function getAuthorizationState(userId: string): Promise<AuthorizationState> {
  return deriveAuthorizationState(await rowsFor(userId));
}

/** Active scopes of a user (raw: `weekly_digest` here means an explicit grant, see `weeklyDigestEnabled`). */
export async function activeScopes(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ scope: authorizations.scope })
    .from(authorizations)
    .where(and(eq(authorizations.userId, userId), isNull(authorizations.revokedAt)));
  return new Set(rows.map((r) => r.scope));
}

export async function hasAuthorization(userId: string, scope: AuthorizationScope): Promise<boolean> {
  const rows = await db
    .select({ id: authorizations.id })
    .from(authorizations)
    .where(and(eq(authorizations.userId, userId), eq(authorizations.scope, scope), isNull(authorizations.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * True when the person authorised submitting applications of this type without their tap.
 * The practice type is never auto-submitted (the practice run exists to show the tap).
 */
export async function canAutoSubmit(userId: string, type: OpportunityTypeId): Promise<boolean> {
  if (type === "practice") return false;
  return hasAuthorization(userId, autoSubmitScope(type));
}

/**
 * True when follow-up emails may go out without asking: the person switched automatic
 * follow-ups on AND their plan includes them (Pro, see `PLANS.pro.perks`). Otherwise the
 * follow-up is still prepared (follow-ups are free) and waits for the person's tap.
 */
export async function autoFollowUpAllowed(userId: string): Promise<boolean> {
  const [granted, perks] = await Promise.all([hasAuthorization(userId, "auto_followup"), planPerks(userId)]);
  return granted && perks.autoFollowUps;
}

/** The weekly brief switch (on unless the person switched it off). */
export async function weeklyDigestEnabled(userId: string): Promise<boolean> {
  return (await getAuthorizationState(userId)).weeklyDigest;
}

async function grant(userId: string, scopes: readonly AuthorizationScope[]): Promise<void> {
  if (!scopes.length) return;
  // The partial unique index (user_id, scope) WHERE revoked_at IS NULL makes this idempotent.
  await db
    .insert(authorizations)
    .values(scopes.map((scope) => ({ id: newId("aut"), userId, scope })))
    .onConflictDoNothing();
}

async function revoke(userId: string, scopes: readonly AuthorizationScope[]): Promise<number> {
  if (!scopes.length) return 0;
  const rows = await db
    .update(authorizations)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(authorizations.userId, userId), inArray(authorizations.scope, [...scopes]), isNull(authorizations.revokedAt)))
    .returning({ id: authorizations.id });
  return rows.length;
}

/** Switches auto-submit on or off for every type of a group. Returns the new state. */
export async function setAutoSubmitGroup(userId: string, group: AutoSubmitGroup, enabled: boolean): Promise<AuthorizationState> {
  const scopes = scopesForGroup(group);
  if (enabled) await grant(userId, scopes);
  else await revoke(userId, scopes);
  return getAuthorizationState(userId);
}

/** Switches `auto_followup` or `weekly_digest`. Returns the new state. */
export async function setStandingScope(userId: string, scope: StandingScope, enabled: boolean): Promise<AuthorizationState> {
  if (enabled) {
    await grant(userId, [scope]);
  } else {
    const revoked = await revoke(userId, [scope]);
    if (revoked === 0 && scope === "weekly_digest") {
      // Default-on scope without any row yet: record the opt-out as a revoked row.
      await db.insert(authorizations).values({ id: newId("aut"), userId, scope, revokedAt: sql`now()` });
    }
  }
  return getAuthorizationState(userId);
}

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await db.select({ value: appState.value }).from(appState).where(eq(appState.key, prefsKey(userId))).limit(1);
  return parsePrefs(rows[0]?.value);
}

export async function setNotificationPref(userId: string, key: PrefKey, enabled: boolean): Promise<NotificationPrefs> {
  const patch = JSON.stringify({ [key]: enabled });
  const rows = await db
    .insert(appState)
    .values({ key: prefsKey(userId), value: { ...DEFAULT_PREFS, [key]: enabled } })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value: sql`coalesce(${appState.value}, '{}'::jsonb) || ${patch}::jsonb`, updatedAt: sql`now()` },
    })
    .returning({ value: appState.value });
  return parsePrefs(rows[0]?.value);
}

/** Perks of the user's current plan (Pro → weekly brief by email, automatic follow-ups). */
export async function planPerks(userId: string): Promise<Perks> {
  const rows = await db.select({ sku: subscriptions.sku, status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.userId, userId));
  return perksFromSubscriptions(rows);
}
