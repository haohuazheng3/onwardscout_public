import "server-only";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { functionLabel, isFunctionId } from "@/lib/core/functions";
import { subGoalAppliesTo, getSubGoal } from "@/lib/core/goals";
import { localize } from "@/lib/core/labels";
import { emptyProfile, type Profile } from "@/lib/core/types";
import { db } from "@/lib/db";
import { events, opportunities } from "@/lib/db/schema";
import { actualProvider, getIntelligence } from "@/lib/llm";
import { DirectionPlan, type DirectionCandidate, type LifePath, type ProviderName } from "@/lib/llm/types";
import { recordEvent } from "@/lib/notifications";
import { refreshMatchesSoon } from "@/lib/opportunities";
import { USER_REF_PREFIX } from "@/lib/opportunities/queries";
import { patchProfile } from "./actions";
import { saveGoals, updateGoal, type GoalInput } from "./goals";
import { snapHorizon, successOptions } from "./success-params";
import { OTHER_GOAL, QUICK_GOALS, type QuickGoal } from "./quick-goals";
import { activeGoals as listActiveGoals, getProfile, profileOf } from "./store";

/*
 * The end of onboarding: after the person has answered who they are, Onward Scout plans their
 * next chapter — no question about what they're "going for". Every candidate direction carries
 * how many opportunities are open for it now; the intelligence layer (Claude when enabled, the
 * deterministic engine otherwise) picks the life path (work, startup, research, study, create)
 * and up to three directions of it, with a roadmap, strengths and gaps. The directions become
 * the person's goals (each keeps its reason), the plan is kept as a `plan.created` event for the
 * dashboard, and matching starts at once, signed in or not. Choosing another path on the
 * dashboard plans again for that path and pauses the directions the old plan had set.
 */

/** Event kind that stores a plan (the newest one is the person's current plan). */
export const PLAN_EVENT = "plan.created";

/** Opportunity types whose count follows the person's field (job postings carry functions). */
const FIELD_TYPES = new Set(["job", "remote_job", "internship"]);

export interface Direction {
  id: string;
  family: string;
  sub: string;
  label: string;
  hint: string;
  open: number;
  /** Why this direction, in the person's language (only for recommended ones). */
  reason: string | null;
  strength: number;
}

export interface DirectionsResult {
  plan: DirectionPlan;
  summary: string;
  recommended: Direction[];
  /** The other directions with something open, the person's audience first: theirs to add. */
  more: Direction[];
  /** The engine that made the recommendation ("anthropic" = written with Claude). */
  provider: ProviderName;
}

/** Live counts per opportunity type: everything open now, and the same in one field. */
async function loadCounts(field: string | null): Promise<{ all: Record<string, number>; inField: Record<string, number> }> {
  const o = opportunities;
  const live = and(eq(o.status, "active"), sql`not starts_with(coalesce(${o.sourceRef}, ''), ${USER_REF_PREFIX})`, or(isNull(o.deadline), gt(o.deadline, sql`now()`)));
  const rows = await db.select({ type: o.type, n: sql<number>`count(*)::int` }).from(o).where(live).groupBy(o.type);
  const all = Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
  if (!field) return { all, inField: {} };
  const fieldRows = await db
    .select({ type: o.type, n: sql<number>`count(*)::int` })
    .from(o)
    .where(and(live, sql`${o.type} in ('job', 'remote_job', 'internship')`, sql`${o.functions} @> array[${field}]::text[]`))
    .groupBy(o.type);
  return { all, inField: Object.fromEntries(fieldRows.map((r) => [r.type, Number(r.n)])) };
}

/** Counts change when the sources run; they are cached for a day and dropped with the "opportunities" tag. */
async function counts(field: string | null) {
  const { unstable_cache } = await import("next/cache");
  return unstable_cache(() => loadCounts(field), ["direction-counts-v1", field ?? "all"], { revalidate: 86400, tags: ["opportunities"] })();
}

function candidateOf(g: QuickGoal, profile: Profile, c: { all: Record<string, number>; inField: Record<string, number> }, field: string | null, locale: "en" | "zh"): DirectionCandidate {
  const paths = [...g.paths];
  const types = g.id === OTHER_GOAL.id ? Object.keys(c.all) : getSubGoal(g.sub).opportunityTypes;
  const all = types.reduce((n, t) => n + (c.all[t] ?? 0), 0);
  const fieldTypes = types.filter((t) => FIELD_TYPES.has(t));
  const inField = fieldTypes.reduce((n, t) => n + (c.inField[t] ?? 0), 0);
  // A job direction is counted in the person's field when that field has postings; otherwise across all fields.
  const useField = Boolean(field) && fieldTypes.length > 0 && inField > 0;
  const open = useField ? inField + types.filter((t) => !FIELD_TYPES.has(t)).reduce((n, t) => n + (c.all[t] ?? 0), 0) : all;
  return {
    id: g.id,
    family: g.family,
    sub: g.sub,
    label: localize(g.label, locale),
    opportunityTypes: types,
    open,
    forThem: g.id === OTHER_GOAL.id || subGoalAppliesTo(g.sub, profile.roles.map((r) => r.code)),
    field: useField && field && isFunctionId(field) ? functionLabel(field, locale) : null,
    paths,
  };
}

/** Every direction with what is open for this person now (the dashboard's "open for you" chart). */
export async function directionCandidates(profile: Profile, locale: "en" | "zh"): Promise<DirectionCandidate[]> {
  const field = profile.functions[0] ?? null;
  const c = await counts(field);
  return [...QUICK_GOALS, OTHER_GOAL].map((g) => candidateOf(g, profile, c, field, locale));
}

export async function recommendDirections(ownerId: string | null, locale: "en" | "zh", preferredPath: LifePath | null = null): Promise<DirectionsResult> {
  const row = ownerId ? await getProfile(ownerId) : null;
  const profile = row ? profileOf(row) : emptyProfile();
  const goals = [...QUICK_GOALS, OTHER_GOAL];
  const candidates = await directionCandidates(profile, locale);
  const ai = getIntelligence({ userId: ownerId });
  const plan = await ai.recommendDirections({ profile, candidates, language: locale, preferredPath });

  const byId = new Map(goals.map((g) => [g.id, g]));
  const toDirection = (cand: DirectionCandidate, reason: string | null, strength: number): Direction => {
    const g = byId.get(cand.id)!;
    return { id: cand.id, family: cand.family, sub: cand.sub, label: cand.label, hint: localize(g.hint, locale), open: cand.open, reason, strength };
  };
  const recommended = plan.directions.flatMap((d) => {
    const cand = candidates.find((x) => x.id === d.id);
    return cand ? [toDirection(cand, d.reason, d.strength)] : [];
  });
  const chosen = new Set(recommended.map((d) => d.id));
  const more = candidates
    .filter((x) => !chosen.has(x.id) && x.id !== OTHER_GOAL.id && x.open > 0)
    .sort((a, b) => Number(b.forThem) - Number(a.forThem) || b.open - a.open)
    .map((x) => toDirection(x, null, 0));
  const other = candidates.find((x) => x.id === OTHER_GOAL.id);
  if (other && !chosen.has(other.id)) more.push(toDirection(other, null, 0));
  return { plan, summary: plan.summary, recommended, more, provider: actualProvider(ai) };
}

export interface FinishResult {
  summary: string;
  path: LifePath;
  goals: { id: string; family: string; sub: string | null }[];
  provider: ProviderName;
}

/**
 * Answers done (or another path chosen) → the plan: the profile is confirmed (when the person
 * answered who they are), the plan's directions become goals with default success definition and
 * intensity over the plan's horizon (a goal the person already runs keeps its settings), goals an
 * earlier plan set that this one dropped are paused, the plan is stored, and matching starts.
 */
export async function finishOnboarding(ownerId: string, locale: "en" | "zh", opts: { confirm: boolean; path?: LifePath | null }): Promise<FinishResult> {
  if (opts.confirm) await patchProfile(ownerId, { op: "confirm" }, locale);
  const result = await recommendDirections(ownerId, locale, opts.path ?? null);
  const row = await getProfile(ownerId);
  const profile = row ? profileOf(row) : emptyProfile();
  const running = await listActiveGoals(ownerId);
  const horizon = snapHorizon(result.plan.horizonMonths);
  const inputs: GoalInput[] = result.recommended.map((d) => {
    const existing = running.find((g) => g.family === d.family && g.sub === d.sub);
    const sub = d.sub as GoalInput["sub"];
    const months = existing?.horizonMonths ?? horizon;
    const success = existing?.successDefinition || successOptions(sub, profile, months, locale)[0]?.text?.trim() || d.label;
    return { family: d.family as GoalInput["family"], sub, successDefinition: success, templateId: null, horizonMonths: months, intensity: existing?.constraints.intensity ?? "steady", rationale: d.reason };
  });
  // Goals are listed newest first (listGoals): saving the strongest direction last puts it at the top of the dashboard.
  const saved = inputs.length ? await saveGoals(ownerId, [...inputs].reverse(), locale) : { goals: [] };
  // Directions an earlier plan set (they carry its reason) and this one dropped: paused, not deleted.
  const kept = new Set(result.recommended.map((d) => d.sub));
  for (const g of running) {
    if (g.constraints.rationale && !kept.has(g.sub ?? "")) await updateGoal(ownerId, { id: g.id, status: "paused" });
  }
  await recordEvent({ userId: ownerId, kind: PLAN_EVENT, data: { plan: result.plan, provider: result.provider, preferredPath: opts.path ?? null } });
  await refreshMatchesSoon(ownerId);
  return { summary: result.plan.summary, path: result.plan.path, goals: saved.goals.map((g) => ({ id: g.id, family: g.family, sub: g.sub })), provider: result.provider };
}

export interface StoredPlan {
  plan: DirectionPlan;
  provider: ProviderName;
  createdAt: Date;
}

/** The person's current plan (the newest stored one), or null when none was made or it no longer parses. */
export async function latestPlan(ownerId: string): Promise<StoredPlan | null> {
  const rows = await db
    .select({ data: events.data, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.userId, ownerId), eq(events.kind, PLAN_EVENT)))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const data = row.data as { plan?: unknown; provider?: unknown };
  const plan = DirectionPlan.safeParse(data.plan);
  if (!plan.success) return null;
  const provider = data.provider === "anthropic" || data.provider === "mock" ? data.provider : "local";
  return { plan: plan.data, provider, createdAt: row.createdAt };
}
