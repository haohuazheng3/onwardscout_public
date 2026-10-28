import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { functionLabel, isFunctionId } from "@/lib/core/functions";
import { subGoalAppliesTo, getSubGoal } from "@/lib/core/goals";
import { localize } from "@/lib/core/labels";
import { emptyProfile, type Profile } from "@/lib/core/types";
import { db } from "@/lib/db";
import { opportunities } from "@/lib/db/schema";
import { actualProvider, getIntelligence } from "@/lib/llm";
import type { DirectionCandidate, ProviderName } from "@/lib/llm/types";
import { refreshMatchesSoon } from "@/lib/opportunities";
import { USER_REF_PREFIX } from "@/lib/opportunities/queries";
import { patchProfile } from "./actions";
import { saveGoals, type GoalInput } from "./goals";
import { snapHorizon, successOptions } from "./success-params";
import { OTHER_GOAL, QUICK_GOALS, type QuickGoal } from "./quick-goals";
import { activeGoals as listActiveGoals, getProfile, profileOf } from "./store";

/*
 * The end of onboarding: after the person has answered who they are, Onward Scout works out where
 * they should go and sets it up — no question about what they're "going for". Every candidate
 * direction carries how many opportunities are open for it now; the intelligence layer (Claude
 * when enabled, the deterministic engine otherwise) picks up to three with reasons; those become
 * the person's goals (the reason is kept and shown on the dashboard) and matching starts at once,
 * signed in or not.
 */

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
  };
}

export async function recommendDirections(ownerId: string | null, locale: "en" | "zh"): Promise<DirectionsResult> {
  const row = ownerId ? await getProfile(ownerId) : null;
  const profile = row ? profileOf(row) : emptyProfile();
  const field = profile.functions[0] ?? null;
  const c = await counts(field);
  const goals = [...QUICK_GOALS, OTHER_GOAL];
  const candidates = goals.map((g) => candidateOf(g, profile, c, field, locale));
  const ai = getIntelligence({ userId: ownerId });
  const plan = await ai.recommendDirections({ profile, candidates, language: locale });

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
  return { summary: plan.summary, recommended, more, provider: actualProvider(ai) };
}

export interface FinishResult {
  summary: string;
  goals: { id: string; family: string; sub: string | null }[];
  provider: ProviderName;
}

/**
 * Answers done → directions set: the profile is confirmed (when the person answered who they are),
 * the recommended directions become goals with default success definition, horizon and intensity
 * (a goal the person already runs keeps theirs), each with its reason, and matching starts.
 */
export async function finishOnboarding(ownerId: string, locale: "en" | "zh", opts: { confirm: boolean }): Promise<FinishResult> {
  if (opts.confirm) await patchProfile(ownerId, { op: "confirm" }, locale);
  const plan = await recommendDirections(ownerId, locale);
  const row = await getProfile(ownerId);
  const profile = row ? profileOf(row) : emptyProfile();
  const running = await listActiveGoals(ownerId);
  const inputs: GoalInput[] = plan.recommended.map((d) => {
    const existing = running.find((g) => g.family === d.family && g.sub === d.sub);
    const sub = d.sub as GoalInput["sub"];
    const first = successOptions(sub, profile, 6, locale)[0];
    const horizon = existing?.horizonMonths ?? snapHorizon(first?.horizonMonths ?? 6);
    const success = existing?.successDefinition || successOptions(sub, profile, horizon, locale)[0]?.text?.trim() || d.label;
    return { family: d.family as GoalInput["family"], sub, successDefinition: success, templateId: null, horizonMonths: horizon, intensity: existing?.constraints.intensity ?? "steady", rationale: d.reason };
  });
  // Goals are listed newest first (listGoals): saving the strongest direction last puts it at the top of the dashboard.
  const saved = inputs.length ? await saveGoals(ownerId, [...inputs].reverse(), locale) : { goals: [] };
  await refreshMatchesSoon(ownerId);
  return { summary: plan.summary, goals: saved.goals.map((g) => ({ id: g.id, family: g.family, sub: g.sub })), provider: plan.provider };
}
