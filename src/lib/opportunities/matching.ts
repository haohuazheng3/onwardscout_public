import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { GoalConstraints, OpportunityTypeId } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications, matches, milestones, opportunities, type GoalRow } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { getIntelligence, readProfile, type GoalInput, type MatchScore, type OpportunityInput } from "@/lib/llm";
import { notify } from "@/lib/notifications";
import { activeGoals, getProfile } from "@/lib/profile";
import { getUserLocale } from "@/lib/user";
import { PRACTICE_OPPORTUNITY_SLUG, ensurePracticeOpportunity, practiceReasons } from "./practice";
import { anyOfQuery, geoConstraint, identityTargets, profileTerms } from "./prefilter";
import { hasAnyApplication, notClosed, ownerRefPrefix, visibleTo } from "./queries";
import {
  candidateTypes,
  effectiveChannel,
  feedbackSignals,
  goalPlanTypes,
  goalWeights,
  rankCandidates,
  repeatKey,
  varietyLimits,
  yourMinutes,
  type FeedbackRow,
  type GoalPlan,
  type RankInput,
} from "./ranking";

/*
 * refreshMatches(userId): the person's board, recomputed.
 *
 *   1. Prefilter in SQL (≤ 600): open, visible, the goals' types, identity overlap, place and
 *      remote compatibility, not already applied, not dismissed — ordered by text and field
 *      relevance to the profile. The person's own links are always included.
 *   2. Score in batches of 50 with getIntelligence().scoreMatches (the local engine in
 *      production until Claude is switched on; same output shape either way).
 *   3. Rank (ranking.ts): fit, value, win chance, playbook type priority, current milestone,
 *      deadline proximity, the person's time, and what "Not interested" taught us.
 *   4. Upsert the top 150 into `matches` (unique per user + opportunity) keeping feedback;
 *      drop stale picks without feedback, unrank stale ones with feedback.
 *   5. Pin the practice run (rank 0) for people with no application yet.
 *
 * Long runs (Claude scoring hundreds of candidates) checkpoint between batches and continue
 * in the next job invocation.
 */

export const MAX_CANDIDATES = 600;
export const SCORE_BATCH = 50;
const UPSERT_CHUNK = 50;
/** Yield to the next invocation when less than this is left before the job's deadline. */
const YIELD_MS = 45_000;

const o = opportunities;
const m = matches;

/** Compact score kept in the job state between invocations. */
interface CompactScore {
  o: string;
  g: string | null;
  f: number;
  w: number;
  e: number;
  v: number;
  ok: boolean;
  r: string[];
  gp: string[];
  b: string[];
}

export interface RefreshState {
  candidateIds?: string[];
  scores?: CompactScore[];
}

export interface RefreshSummary {
  candidates: number;
  scored: number;
  kept: number;
  added: number;
  removed: number;
  practice: boolean;
  tookMs: number;
}

export type RefreshOutcome = { status: "done"; summary: RefreshSummary } | { status: "continue"; state: RefreshState };

export interface RefreshOptions {
  now?: Date;
  /** Resume from a checkpoint (job state). */
  state?: RefreshState;
  /** Time left in this invocation; when it runs low the refresh returns "continue". */
  timeLeftMs?: () => number;
  /** Persist progress between batches (job checkpoint). */
  checkpoint?: (state: RefreshState) => Promise<void>;
  /** Send a "new matches" notification when picks were added (scheduled refreshes). */
  notify?: boolean;
}

const candidateColumns = {
  id: o.id,
  type: o.type,
  name: o.name,
  orgName: o.orgName,
  url: o.url,
  summary: o.summary,
  description: sql<string | null>`left(${o.description}, 4000)`.as("description_head"),
  tags: o.tags,
  industries: o.industries,
  functions: o.functions,
  languages: o.languages,
  geo: o.geo,
  eligibility: o.eligibility,
  deadline: o.deadline,
  rolling: o.rolling,
  benefits: o.benefits,
  cost: o.cost,
  requiredMaterials: o.requiredMaterials,
  estAcceptanceRate: o.estAcceptanceRate,
  estEffortMinutes: o.estEffortMinutes,
  qualityScore: o.qualityScore,
  applyChannel: sql<string | null>`${o.apply}->>'channel'`.as("apply_channel"),
  requiresAccount: sql<boolean | null>`(${o.apply}->>'requiresAccount')::boolean`.as("requires_account"),
  requiresPayment: sql<boolean | null>`(${o.apply}->>'requiresPayment')::boolean`.as("requires_payment"),
  captchaLikely: sql<boolean | null>`(${o.apply}->>'captchaLikely')::boolean`.as("captcha_likely"),
  sourceRef: o.sourceRef,
};

type Candidate = Awaited<ReturnType<typeof loadCandidatesByIds>>[number];

const textArray = (values: string[]): SQL =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

/** jsonb array column contains any of `values` (non-arrays count as "no rule"). */
function jsonArrayAllowsAny(expr: SQL, values: string[]): SQL {
  return sql`(case when jsonb_typeof(${expr}) = 'array' and jsonb_array_length(${expr}) > 0 then exists (select 1 from jsonb_array_elements_text(${expr}) as x(v) where x.v = any(${textArray(values)})) else true end)`;
}

interface PrefilterInput {
  userId: string;
  types: OpportunityTypeId[] | null;
  limit: number;
  targets: string[];
  remoteOnly: boolean;
  countries: string[] | null;
  terms: string[];
  functions: string[];
  industries: string[];
}

async function loadCandidates(p: PrefilterInput) {
  const mine = sql`starts_with(coalesce(${o.sourceRef}, ''), ${ownerRefPrefix(p.userId)})`;
  const rules: SQL[] = [
    sql`not exists (select 1 from ${applications} where ${applications.userId} = ${p.userId} and ${applications.opportunityId} = ${o.id} and ${applications.practice} = false)`,
    sql`not exists (select 1 from ${m} where ${m.userId} = ${p.userId} and ${m.opportunityId} = ${o.id} and ${m.feedback} = 'not_interested')`,
  ];
  if (p.types?.length) rules.push(inArray(o.type, p.types));
  if (p.targets.length) rules.push(jsonArrayAllowsAny(sql`${o.eligibility}->'identities'`, p.targets));
  if (p.remoteOnly) rules.push(sql`coalesce(${o.geo}->>'remote', '') not in ('onsite', 'hybrid')`);
  if (p.countries?.length) {
    rules.push(sql`(${o.geo}->>'remote' = 'remote' or ${o.geo}->>'worldwide' = 'true' or ${jsonArrayAllowsAny(sql`${o.geo}->'countries'`, p.countries)})`);
  }

  const query = anyOfQuery(p.terms);
  const relevance: SQL[] = [sql`0`];
  if (query) relevance.push(sql`ts_rank(${o.search}, websearch_to_tsquery('simple', ${query})) * 10`);
  if (p.functions.length) relevance.push(sql`(case when ${o.functions} && ${textArray(p.functions)} then 2 else 0 end)`);
  if (p.industries.length) {
    const tops = [...new Set(p.industries.map((i) => i.split(".")[0]))];
    relevance.push(
      sql`(case when exists (select 1 from unnest(${o.industries}) as i(code) where split_part(i.code, '.', 1) = any(${textArray(tops)})) then 2 else 0 end)`,
    );
  }

  return db
    .select(candidateColumns)
    .from(o)
    .where(and(visibleTo(p.userId), notClosed, sql`${o.type} <> 'practice'`, sql`(${mine} or (${and(...rules)}))`))
    .orderBy(
      sql`${mine} desc`,
      sql`(${sql.join(relevance, sql` + `)}) desc`,
      sql`${o.qualityScore} desc nulls last`,
      sql`${o.verifiedAt} desc nulls last`,
      sql`${o.deadline} asc nulls last`,
      asc(o.id),
    )
    .limit(p.limit);
}

/**
 * Candidates for every goal: one query per goal (its own types, an equal share of the 600
 * slots) so a second goal is never crowded out by a first goal with tens of thousands of
 * postings; merged without repeats. One query when there is at most one goal.
 */
async function loadCandidatesForGoals(base: Omit<PrefilterInput, "types" | "limit">, plans: GoalPlan[]) {
  if (plans.length <= 1) return loadCandidates({ ...base, types: candidateTypes(plans), limit: MAX_CANDIDATES });
  const share = Math.ceil(MAX_CANDIDATES / plans.length);
  const lists = await Promise.all(plans.map((p) => loadCandidates({ ...base, types: p.types.length ? p.types.filter((t) => t !== "practice") : null, limit: share })));
  const seen = new Set<string>();
  const out: (typeof lists)[number] = [];
  for (const list of lists) {
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

async function loadCandidatesByIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select(candidateColumns)
    .from(o)
    .where(and(inArray(o.id, ids), visibleTo(userId), notClosed));
}

function toInput(c: Candidate): OpportunityInput {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    orgName: c.orgName,
    url: c.url,
    summary: c.summary,
    description: c.description,
    tags: c.tags,
    industries: c.industries,
    functions: c.functions,
    languages: c.languages,
    geo: c.geo,
    eligibility: c.eligibility,
    deadline: c.deadline,
    rolling: c.rolling,
    benefits: c.benefits,
    cost: c.cost,
    requiredMaterials: c.requiredMaterials,
    estAcceptanceRate: c.estAcceptanceRate,
    estEffortMinutes: c.estEffortMinutes,
    qualityScore: c.qualityScore,
    apply: { channel: c.applyChannel ?? undefined, requiresAccount: c.requiresAccount ?? false, requiresPayment: c.requiresPayment ?? false },
  };
}

function compact(s: MatchScore): CompactScore {
  return { o: s.opportunityId, g: s.goalId, f: s.fit, w: s.winProbability, e: s.effort, v: s.value, ok: s.eligible, r: s.reasons.slice(0, 5), gp: s.gaps.slice(0, 5), b: s.blockers.slice(0, 3) };
}

function goalInput(g: GoalRow, types: OpportunityTypeId[]): GoalInput {
  return {
    id: g.id,
    family: g.family,
    sub: g.sub,
    label: g.label,
    successDefinition: g.successDefinition,
    constraints: (g.constraints ?? null) as GoalInput["constraints"],
    opportunityTypes: types.length ? types : undefined,
  };
}

async function openMilestoneMetrics(userId: string): Promise<Map<string, GoalPlan["milestoneMetric"]>> {
  const rows = await db
    .select({ goalId: milestones.goalId, metric: milestones.metric })
    .from(milestones)
    .where(and(eq(milestones.userId, userId), eq(milestones.status, "open")))
    .orderBy(asc(milestones.position));
  const out = new Map<string, GoalPlan["milestoneMetric"]>();
  for (const r of rows) if (!out.has(r.goalId)) out.set(r.goalId, r.metric);
  return out;
}

async function loadFeedback(userId: string): Promise<FeedbackRow[]> {
  const rows = await db
    .select({ type: o.type, geo: o.geo, industries: o.industries, feedback: m.feedback, reason: m.feedbackReason })
    .from(m)
    .innerJoin(o, eq(o.id, m.opportunityId))
    .where(and(eq(m.userId, userId), eq(m.feedback, "not_interested")))
    .limit(500);
  return rows.map((r) => ({ type: r.type, countries: r.geo?.countries ?? [], industries: r.industries ?? [], feedback: r.feedback, reason: r.reason }));
}

/** Recomputes the person's Scout board. See the module comment. */
export async function refreshMatches(userId: string, opts: RefreshOptions = {}): Promise<RefreshOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const [profileRow, goals, locale, metrics, signalsRows, applied] = await Promise.all([
    getProfile(userId),
    activeGoals(userId),
    getUserLocale(userId),
    openMilestoneMetrics(userId),
    loadFeedback(userId),
    hasAnyApplication(userId),
  ]);
  const profile = readProfile(profileRow ?? {});
  const plans: GoalPlan[] = goals.map((g) => ({
    goalId: g.id,
    family: g.family,
    types: goalPlanTypes({ family: g.family, sub: g.sub, constraints: g.constraints as Partial<GoalConstraints> }),
    milestoneMetric: metrics.get(g.id) ?? null,
  }));

  /* 1. candidates (fresh, or the checkpointed list) */
  let candidates: Candidate[];
  if (opts.state?.candidateIds?.length) {
    candidates = await loadCandidatesByIds(userId, opts.state.candidateIds);
  } else {
    const geo = geoConstraint(goals.map((g) => ({ constraints: g.constraints as Partial<GoalConstraints> })));
    candidates = await loadCandidatesForGoals(
      {
        userId,
        targets: identityTargets(profile),
        remoteOnly: geo.remoteOnly,
        countries: geo.countries,
        terms: profileTerms(profile),
        functions: profile.functions,
        industries: profile.industries,
      },
      plans,
    );
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));

  /* 2. score in batches */
  const scores = new Map<string, CompactScore>((opts.state?.scores ?? []).filter((s) => byId.has(s.o)).map((s) => [s.o, s]));
  const todo = candidates.filter((c) => !scores.has(c.id));
  const ai = getIntelligence({ userId });
  const goalInputs = goals.map((g, i) => goalInput(g, plans[i].types));
  for (let i = 0; i < todo.length; i += SCORE_BATCH) {
    if (i > 0 && opts.timeLeftMs && opts.timeLeftMs() < YIELD_MS) {
      const state: RefreshState = { candidateIds: candidates.map((c) => c.id), scores: [...scores.values()] };
      await opts.checkpoint?.(state);
      return { status: "continue", state };
    }
    const batch = todo.slice(i, i + SCORE_BATCH);
    const result = await ai.scoreMatches({ profile, goals: goalInputs, opportunities: batch.map(toInput), language: locale, now });
    for (const s of result) if (byId.has(s.opportunityId)) scores.set(s.opportunityId, compact(s));
  }

  /* 3. rank */
  const prefix = ownerRefPrefix(userId);
  type Ranked = RankInput & { reasons: string[]; gaps: string[]; minutes: number };
  const inputs: Ranked[] = [];
  for (const c of candidates) {
    const s = scores.get(c.id);
    if (!s) continue;
    const channel = effectiveChannel(c.type, c.applyChannel);
    const pinned = Boolean(c.sourceRef?.startsWith(prefix));
    const gaps = pinned && !s.ok ? [...s.b, ...s.gp] : s.gp;
    inputs.push({
      opportunityId: c.id,
      type: c.type,
      channel,
      deadline: c.deadline,
      rolling: c.rolling,
      countries: c.geo?.countries ?? [],
      industries: c.industries ?? [],
      remoteOrWorldwide: c.geo?.remote === "remote" || Boolean(c.geo?.worldwide),
      pinned,
      dedupeKey: repeatKey(c.orgName, c.name),
      goalId: s.g,
      fit: s.f,
      winProbability: s.w,
      effort: s.e,
      value: s.v,
      eligible: s.ok,
      reasons: s.r,
      gaps: [...new Set(gaps)].slice(0, 5),
      minutes: yourMinutes({ channel, requiresAccount: c.requiresAccount ?? false, captchaLikely: c.captchaLikely ?? false, requiresPayment: c.requiresPayment ?? false, gaps: s.gp.length }),
    });
  }
  const goalShapes = goals.map((g) => ({ id: g.id, family: g.family, constraints: g.constraints as Partial<GoalConstraints> }));
  const ranked = rankCandidates(inputs, { now, plans, signals: feedbackSignals(signalsRows) }, { ...varietyLimits(goalShapes), goalWeights: goalWeights(goalShapes) });

  /* 4. upsert */
  const before = await db.select({ opportunityId: m.opportunityId }).from(m).where(and(eq(m.userId, userId), isNotNull(m.rank)));
  const hadRank = new Set(before.map((r) => r.opportunityId));
  const rows = ranked.map((c) => ({
    id: newId("mat"),
    userId,
    goalId: c.goalId,
    opportunityId: c.opportunityId,
    fit: Math.max(0, Math.min(100, Math.round(c.fit))),
    winProbability: c.winProbability,
    effort: c.minutes,
    value: c.value === null ? null : Math.round(c.value),
    reasons: c.reasons,
    gaps: c.gaps,
    rank: c.rank,
  }));

  let practice = false;
  if (!applied) {
    const p = await ensurePracticeOpportunity();
    practice = true;
    rows.unshift({
      id: newId("mat"),
      userId,
      goalId: null,
      opportunityId: p.id,
      fit: 0,
      winProbability: 1,
      effort: 2,
      value: 5,
      reasons: practiceReasons(locale),
      gaps: [],
      rank: 0,
    });
  }

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await db
      .insert(m)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [m.userId, m.opportunityId],
        set: {
          goalId: sql`excluded.goal_id`,
          fit: sql`excluded.fit`,
          winProbability: sql`excluded.win_probability`,
          effort: sql`excluded.effort`,
          value: sql`excluded.value`,
          reasons: sql`excluded.reasons`,
          gaps: sql`excluded.gaps`,
          rank: sql`excluded.rank`,
          updatedAt: sql`now()`,
        },
      });
  }

  /* stale picks: dropped when untouched, unranked when the person said something about them */
  const keep = rows.map((r) => r.opportunityId);
  const notKept = keep.length ? notInArray(m.opportunityId, keep) : undefined;
  const removed = await db
    .delete(m)
    .where(and(eq(m.userId, userId), isNull(m.feedback), notKept))
    .returning({ id: m.id });
  await db
    .update(m)
    .set({ rank: null, updatedAt: sql`now()` })
    .where(and(eq(m.userId, userId), isNotNull(m.feedback), isNotNull(m.rank), notKept));

  const added = ranked.filter((c) => !hadRank.has(c.opportunityId)).length;
  const summary: RefreshSummary = {
    candidates: candidates.length,
    scored: scores.size,
    kept: ranked.length,
    added,
    removed: removed.length,
    practice,
    tookMs: Date.now() - started,
  };

  if (opts.notify && added > 0) {
    try {
      await notify({
        userId,
        kind: "new_matches",
        title: locale === "zh" ? `为你找到 ${added} 个新机会` : added === 1 ? "Your scout found 1 new opportunity" : `Your scout found ${added} new opportunities`,
        body: locale === "zh" ? "打开机会面板，看看为什么适合你。" : "Open the Scout board to see why each one fits.",
        href: "/app/scout",
      });
    } catch (err) {
      await captureError(err, { route: "opportunities/refreshMatches (notify)", severity: "warn", context: { userId } });
    }
  }
  return { status: "done", summary };
}

/**
 * Scores one opportunity for one person right away (a link they just added) and pins it to the
 * top of their board. Feedback from before is cleared: adding it again means they want it.
 */
export async function scoreAndPin(userId: string, opportunityId: string): Promise<void> {
  const [profileRow, goals, locale, rows] = await Promise.all([getProfile(userId), activeGoals(userId), getUserLocale(userId), loadCandidatesByIds(userId, [opportunityId])]);
  const c = rows[0];
  if (!c) return;
  const profile = readProfile(profileRow ?? {});
  const goalInputs = goals.map((g) => goalInput(g, goalPlanTypes({ family: g.family, sub: g.sub, constraints: g.constraints as Partial<GoalConstraints> })));
  const [s] = await getIntelligence({ userId }).scoreMatches({ profile, goals: goalInputs, opportunities: [toInput(c)], language: locale });
  const channel = effectiveChannel(c.type, c.applyChannel);
  const gaps = s ? [...new Set([...(s.eligible ? [] : s.blockers), ...s.gaps])].slice(0, 5) : [];
  const values = {
    id: newId("mat"),
    userId,
    goalId: s?.goalId ?? null,
    opportunityId,
    fit: s ? Math.max(0, Math.min(100, Math.round(s.fit))) : 0,
    winProbability: s?.winProbability ?? null,
    effort: yourMinutes({ channel, requiresAccount: c.requiresAccount ?? false, captchaLikely: c.captchaLikely ?? false, requiresPayment: c.requiresPayment ?? false, gaps: s?.gaps.length ?? 0 }),
    value: s ? Math.round(s.value) : null,
    reasons: s?.reasons.slice(0, 5) ?? [],
    gaps,
    rank: 0,
  };
  await db
    .insert(m)
    .values(values)
    .onConflictDoUpdate({
      target: [m.userId, m.opportunityId],
      set: { goalId: values.goalId, fit: values.fit, winProbability: values.winProbability, effort: values.effort, value: values.value, reasons: values.reasons, gaps: values.gaps, rank: 0, feedback: null, feedbackReason: null, updatedAt: sql`now()` },
    });
}

export { PRACTICE_OPPORTUNITY_SLUG };
