/**
 * Ranking: the pure half of matching (plan §10.4 steps 4–5). The intelligence layer scores
 * each candidate (fit, win probability, effort, value, eligibility); this module combines that
 * with the goal's playbook — type priority, the current milestone, deadline proximity, value
 * and the person's own time — and with what the person told us through "Not interested",
 * then keeps the board varied (at most `typeCap` of one type in any window of picks).
 *
 * No I/O: everything here is tested in tests/matching-ranking.test.ts.
 */
import { getSubGoal, isGoalFamily, isSubGoalId } from "@/lib/core/goals";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core/opportunity-types";
import { getPlaybook, resolvePlaybook } from "@/lib/core/playbooks";
import type { ChannelId, GoalConstraints, GoalFamily, MatchFeedback, MilestoneMetric, OpportunityTypeId } from "@/lib/core/types";

/** What ranking knows about one goal. */
export interface GoalPlan {
  goalId: string;
  family: GoalFamily | string;
  /** Types the goal pursues, best first ([] = any type: custom goals). */
  types: OpportunityTypeId[];
  /** Metric of the goal's first open milestone (null when none is open). */
  milestoneMetric: MilestoneMetric | null;
}

/** One scored candidate, as ranking needs it. */
export interface RankInput {
  opportunityId: string;
  type: string;
  channel: ChannelId;
  deadline: Date | null;
  rolling: boolean;
  countries: string[];
  industries: string[];
  remoteOrWorldwide: boolean;
  /** Added by the person (or the practice run): always shown, rank 0. */
  pinned: boolean;
  /** Same key = the same opportunity posted more than once (org + name): only the best one is kept. */
  dedupeKey?: string | null;
  /** From the intelligence layer. */
  goalId: string | null;
  fit: number;
  winProbability: number | null;
  /** 0–100, higher = more of the person's time. */
  effort: number | null;
  value: number | null;
  eligible: boolean;
}

export interface FeedbackSignals {
  type: Record<string, number>;
  country: Record<string, number>;
  field: Record<string, number>;
}

export interface RankContext {
  now: Date;
  plans: GoalPlan[];
  signals: FeedbackSignals;
}

export type RankedCandidate<T extends RankInput = RankInput> = T & { score: number; rank: number };

const DAY_MS = 86_400_000;

/** Weights of the combined score (sum = 1). */
export const RANK_WEIGHTS = {
  fit: 0.34,
  value: 0.14,
  win: 0.1,
  playbook: 0.14,
  milestone: 0.08,
  deadline: 0.12,
  ease: 0.08,
} as const;

/** Board size kept per person, and the defaults when no goal says otherwise. */
export const MAX_MATCHES = 150;
export const DEFAULT_TYPE_CAP = 4;
export const DEFAULT_WINDOW = 10;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/* ------------------------------------------------------------------ goals → plans */

/**
 * The opportunity types a goal pursues, in priority order: the person's own type override
 * (constraints.opportunityTypes, kept in playbook order) wins; else the sub-goal's types
 * (playbook order first); else the family playbook. Custom goals (G12) return [] = any type.
 */
export function goalPlanTypes(goal: { family: string; sub?: string | null; constraints?: Partial<GoalConstraints> | null }): OpportunityTypeId[] {
  if (!isGoalFamily(goal.family)) return [];
  const family = goal.family as GoalFamily;
  const override = goal.constraints?.opportunityTypes ?? [];
  if (override.length) return resolvePlaybook(family, goal.constraints ?? null).opportunityTypes;
  const playbook = getPlaybook(family).opportunityTypes;
  if (goal.sub && isSubGoalId(goal.sub)) {
    const subTypes = getSubGoal(goal.sub).opportunityTypes;
    if (subTypes.length) return [...playbook.filter((t) => subTypes.includes(t)), ...subTypes.filter((t) => !playbook.includes(t))];
  }
  return [...playbook];
}

/** Candidate type filter for a set of goals: null = no restriction (no goals, or a custom goal). */
export function candidateTypes(plans: Pick<GoalPlan, "types">[]): OpportunityTypeId[] | null {
  if (!plans.length || plans.some((p) => p.types.length === 0)) return null;
  const out: OpportunityTypeId[] = [];
  for (const p of plans) for (const t of p.types) if (!out.includes(t) && t !== "practice") out.push(t);
  return out;
}

/** Variety limits from the first goal's playbook (the most generous cap across goals). */
export function varietyLimits(goals: { family: string; constraints?: Partial<GoalConstraints> | null }[]): { typeCap: number; window: number } {
  const resolved = goals.filter((g) => isGoalFamily(g.family)).map((g) => resolvePlaybook(g.family as GoalFamily, g.constraints ?? null));
  if (!resolved.length) return { typeCap: DEFAULT_TYPE_CAP, window: DEFAULT_WINDOW };
  const typeCap = Math.max(...resolved.map((r) => r.typeCap));
  const window = Math.max(8, Math.min(20, resolved[0].weeklyQuota));
  return { typeCap: Math.max(2, typeCap), window: Math.max(window, typeCap + 1) };
}

/** How much of the board each goal gets: its playbook's weekly quota at its intensity. */
export function goalWeights(goals: { id: string; family: string; constraints?: Partial<GoalConstraints> | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of goals) out[g.id] = isGoalFamily(g.family) ? resolvePlaybook(g.family as GoalFamily, g.constraints ?? null).weeklyQuota : 5;
  return out;
}

/** Repeat postings (the same role at the same organisation, often one per city) share one key. */
export function repeatKey(orgName: string | null | undefined, name: string): string {
  return `${(orgName ?? "").trim().toLowerCase()}|${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/* ------------------------------------------------------------------ parts */

/** 1 for the playbook's first type down to 0.2 for its last; 0.1 when the goal doesn't pursue it; 0.5 with no plan. */
export function playbookPriority(type: string, plan: Pick<GoalPlan, "types"> | null): number {
  if (!plan || plan.types.length === 0) return 0.5;
  const i = plan.types.indexOf(type as OpportunityTypeId);
  if (i < 0) return 0.1;
  if (plan.types.length === 1) return 1;
  return 1 - (i / (plan.types.length - 1)) * 0.8;
}

const MEETING_TYPES: ReadonlySet<string> = new Set(["event", "community", "mentorship", "pitch_event", "exhibition"]);

/**
 * How well a candidate serves the goal's current open milestone:
 * applications → the goal's own types; meetings → outreach and events; interviews/offers/replies →
 * the likelier wins; materials-type ("custom") milestones → neutral.
 */
export function milestoneAlignment(input: { type: string; channel: ChannelId; winProbability: number | null }, plan: Pick<GoalPlan, "types" | "milestoneMetric"> | null): number {
  if (!plan) return 0.5;
  const pursued = plan.types.length === 0 || plan.types.includes(input.type as OpportunityTypeId);
  if (!pursued) return 0.2;
  const metric: MilestoneMetric | null = plan.milestoneMetric;
  switch (metric) {
    case "applications":
      return 1;
    case "meetings":
      return input.channel === "CH4" || MEETING_TYPES.has(input.type) ? 1 : 0.5;
    case "interviews":
    case "offers":
    case "replies":
      return 0.5 + 0.5 * clamp01((input.winProbability ?? 0) / 0.3);
    default:
      return 0.5;
  }
}

/**
 * Deadline proximity: closing in 4–21 days is the sweet spot (urgent and still preparable),
 * 0–3 days slightly less (tight), then fading to 0.4 beyond 60 days; rolling 0.5, unknown 0.35.
 */
export function deadlineProximity(deadline: Date | null, rolling: boolean, now: Date): number {
  if (!deadline || Number.isNaN(deadline.getTime())) return rolling ? 0.5 : 0.35;
  const days = (deadline.getTime() - now.getTime()) / DAY_MS;
  if (days < 0) return 0;
  if (days <= 3) return 0.75;
  if (days <= 21) return 1;
  if (days <= 60) return 1 - ((days - 21) / 39) * 0.5;
  return 0.4;
}

/** Whole days until a deadline (ceil), null without one. Negative when passed. */
export function daysUntil(deadline: Date | string | null, now: Date): number | null {
  if (!deadline) return null;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
}

/* ------------------------------------------------------------------ feedback learning */

export interface FeedbackRow {
  type: string;
  countries: string[];
  industries: string[];
  feedback: MatchFeedback | null;
  reason: string | null;
}

export const EMPTY_SIGNALS: FeedbackSignals = { type: {}, country: {}, field: {} };

/**
 * What "Not interested" taught us: per type (any reason counts a little, "not this type" a lot),
 * per country ("wrong location") and per industry ("not my field"). Values are penalties 0–0.45.
 */
export function feedbackSignals(rows: FeedbackRow[]): FeedbackSignals {
  const typeAny: Record<string, number> = {};
  const typeExplicit: Record<string, number> = {};
  const country: Record<string, number> = {};
  const field: Record<string, number> = {};
  for (const r of rows) {
    if (r.feedback !== "not_interested") continue;
    typeAny[r.type] = (typeAny[r.type] ?? 0) + 1;
    if (r.reason === "not_this_type") typeExplicit[r.type] = (typeExplicit[r.type] ?? 0) + 1;
    if (r.reason === "wrong_location") for (const c of r.countries) country[c.toUpperCase()] = (country[c.toUpperCase()] ?? 0) + 1;
    if (r.reason === "not_my_field") for (const i of r.industries) field[i] = (field[i] ?? 0) + 1;
  }
  const out: FeedbackSignals = { type: {}, country: {}, field: {} };
  for (const t of new Set([...Object.keys(typeAny), ...Object.keys(typeExplicit)])) {
    out.type[t] = Math.min(0.45, 0.04 * (typeAny[t] ?? 0) + 0.15 * (typeExplicit[t] ?? 0));
  }
  for (const [c, n] of Object.entries(country)) out.country[c] = Math.min(0.4, 0.2 * n);
  for (const [i, n] of Object.entries(field)) out.field[i] = Math.min(0.4, 0.15 * n);
  return out;
}

/** Combined penalty (0–0.7) for one candidate. Remote/worldwide roles never get a location penalty. */
export function feedbackPenalty(input: Pick<RankInput, "type" | "countries" | "industries" | "remoteOrWorldwide">, signals: FeedbackSignals): number {
  const t = signals.type[input.type] ?? 0;
  const c = input.remoteOrWorldwide || !input.countries.length ? 0 : Math.min(...input.countries.map((x) => signals.country[x.toUpperCase()] ?? 0));
  const f = input.industries.length ? Math.max(...input.industries.map((x) => signals.field[x] ?? 0)) : 0;
  return Math.min(0.7, t + c + f);
}

/* ------------------------------------------------------------------ the person's minutes */

const CHANNEL_MINUTES: Record<ChannelId, number> = { CH1: 2, CH2: 2, CH3: 3, CH4: 2, CH5: 8, CH6: 8, CH7: 2 };

/**
 * Estimated minutes of the person's own time: reviewing and tapping for automated channels,
 * approving the email for outreach, pasting prepared fields for a handoff; plus a short handoff
 * when the site wants a login or shows a CAPTCHA, paying a fee, and each thing only they can bring.
 */
export function yourMinutes(input: { channel: ChannelId; requiresAccount?: boolean; captchaLikely?: boolean; requiresPayment?: boolean; gaps?: number }): number {
  let m = CHANNEL_MINUTES[input.channel] ?? 5;
  if (input.channel !== "CH4" && input.channel !== "CH5" && (input.requiresAccount || input.captchaLikely)) m += input.channel === "CH6" ? 4 : 3;
  if (input.requiresPayment) m += 2;
  m += Math.min(3, Math.max(0, input.gaps ?? 0)) * 3;
  return m;
}

/** The channel used for a type when the opportunity names none. */
export function effectiveChannel(type: string, applyChannel: string | null | undefined): ChannelId {
  if (applyChannel && /^CH[1-7]$/.test(applyChannel)) return applyChannel as ChannelId;
  return isOpportunityTypeId(type) ? getOpportunityType(type).defaultChannel : "CH6";
}

/* ------------------------------------------------------------------ combine */

/** The plan a candidate is judged against: the scorer's goal, else the plan that ranks its type best. */
export function planFor(input: Pick<RankInput, "type" | "goalId">, plans: GoalPlan[]): GoalPlan | null {
  if (!plans.length) return null;
  const own = input.goalId ? plans.find((p) => p.goalId === input.goalId) : undefined;
  if (own) return own;
  let best: GoalPlan | null = null;
  let bestScore = -1;
  for (const p of plans) {
    const s = playbookPriority(input.type, p);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

export interface CombinedScore {
  score: number;
  parts: { fit: number; value: number; win: number; playbook: number; milestone: number; deadline: number; ease: number; penalty: number };
}

/** One candidate's rank score, 0–100 (higher = earlier on the board). */
export function combineScore(input: RankInput, ctx: RankContext): CombinedScore {
  const plan = planFor(input, ctx.plans);
  const parts = {
    fit: clamp01(input.fit / 100),
    value: clamp01((input.value ?? 40) / 100),
    win: clamp01((input.winProbability ?? 0) / 0.3),
    playbook: playbookPriority(input.type, plan),
    milestone: milestoneAlignment(input, plan),
    deadline: deadlineProximity(input.deadline, input.rolling, ctx.now),
    ease: clamp01(1 - (input.effort ?? 50) / 100),
    penalty: feedbackPenalty(input, ctx.signals),
  };
  const raw =
    RANK_WEIGHTS.fit * parts.fit +
    RANK_WEIGHTS.value * parts.value +
    RANK_WEIGHTS.win * parts.win +
    RANK_WEIGHTS.playbook * parts.playbook +
    RANK_WEIGHTS.milestone * parts.milestone +
    RANK_WEIGHTS.deadline * parts.deadline +
    RANK_WEIGHTS.ease * parts.ease;
  const score = Math.round(raw * (1 - parts.penalty) * 10_000) / 100;
  return { score, parts };
}

/**
 * Keeps the board varied: walking the list best-first, an item is placed only if fewer than
 * `cap` items of its type are among the previous `window - 1` placed items; otherwise the best
 * item that fits goes first. When nothing fits, the best remaining item is placed anyway.
 * Stable: equal inputs keep their order.
 */
export function diversify<T extends { type: string }>(sorted: T[], cap: number, window: number): T[] {
  if (cap <= 0 || window <= 1) return [...sorted];
  const rest = [...sorted];
  const out: T[] = [];
  while (rest.length) {
    const recent = out.slice(-(window - 1));
    const count = (type: string) => recent.reduce((n, x) => (x.type === type ? n + 1 : n), 0);
    let idx = rest.findIndex((x) => count(x.type) < cap);
    if (idx < 0) idx = 0;
    out.push(rest[idx]);
    rest.splice(idx, 1);
  }
  return out;
}

/**
 * Shares the board between goals: each bucket (a goal id, "" for picks no goal claimed) keeps
 * its own best-first order, and buckets take turns in proportion to their weight (smooth
 * weighted round-robin), so a second goal is never crowded out by a first goal with more
 * postings. Unknown buckets weigh half the lightest goal.
 */
export function interleaveByGoal<T extends { goalId: string | null }>(sorted: T[], weights: Record<string, number>): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of sorted) {
    const key = item.goalId ?? "";
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  if (buckets.size <= 1) return [...sorted];
  const known = Object.values(weights).filter((w) => w > 0);
  const fallback = known.length ? Math.min(...known) / 2 : 1;
  const weightOf = (key: string) => (weights[key] && weights[key] > 0 ? weights[key] : fallback);
  const current = new Map<string, number>([...buckets.keys()].map((k) => [k, 0]));
  const out: T[] = [];
  while (out.length < sorted.length) {
    let best: string | null = null;
    let total = 0;
    for (const [key, list] of buckets) {
      if (!list.length) continue;
      const w = weightOf(key);
      total += w;
      current.set(key, (current.get(key) ?? 0) + w);
      if (best === null || (current.get(key) ?? 0) > (current.get(best) ?? 0)) best = key;
    }
    if (best === null) break;
    current.set(best, (current.get(best) ?? 0) - total);
    out.push(buckets.get(best)!.shift()!);
  }
  return out;
}

/**
 * The board order. Ineligible candidates are dropped (they can't apply), except the ones the
 * person added themselves, which stay pinned (rank 0) with their blockers shown as gaps.
 * Repeat postings (same dedupe key) keep only their best copy. Everything else is scored,
 * sorted, shared between goals (`goalWeights`), diversified by type and numbered from 1, at
 * most `limit` items.
 */
export function rankCandidates<T extends RankInput>(
  inputs: T[],
  ctx: RankContext,
  opts: { limit?: number; typeCap?: number; window?: number; goalWeights?: Record<string, number> } = {},
): RankedCandidate<T>[] {
  const limit = opts.limit ?? MAX_MATCHES;
  const pinned: RankedCandidate<T>[] = [];
  const pool: RankedCandidate<T>[] = [];
  for (const input of inputs) {
    const { score } = combineScore(input, ctx);
    if (input.pinned) {
      pinned.push({ ...input, score, rank: 0 });
      continue;
    }
    if (!input.eligible) continue;
    pool.push({ ...input, score, rank: 0 });
  }
  pool.sort((a, b) => b.score - a.score || b.fit - a.fit || a.opportunityId.localeCompare(b.opportunityId));
  const seen = new Set<string>();
  const unique = pool.filter((c) => {
    if (!c.dedupeKey) return true;
    if (seen.has(c.dedupeKey)) return false;
    seen.add(c.dedupeKey);
    return true;
  });
  const shared = opts.goalWeights ? interleaveByGoal(unique, opts.goalWeights) : unique;
  const varied = diversify(shared, opts.typeCap ?? DEFAULT_TYPE_CAP, opts.window ?? DEFAULT_WINDOW).slice(0, limit);
  varied.forEach((c, i) => (c.rank = i + 1));
  pinned.sort((a, b) => b.score - a.score || a.opportunityId.localeCompare(b.opportunityId));
  return [...pinned, ...varied];
}
