import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { cache } from "react";
import { applyInfoSchema, opportunityGeoSchema, type ApplicationStatus, type MaterialId, type OpportunityGeo } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications, matches, opportunities, type OpportunityRow } from "@/lib/db/schema";
import { DEADLINE_DAYS, EFFORT_LIMITS, filtersToQuery, parseBoardFilters, tagWords, type BoardFilters } from "./filters";
import { groupCounts, typesInBoardGroup, type BoardGroup } from "./groups";
import { effectiveChannel } from "./ranking";
import type { BoardItem, BoardPage, MatchCard, MatchInfo, OpportunityCard, OpportunityDetail } from "./types";

/*
 * Read side of the opportunity engine: the Scout board, the detail page, public lists for SEO
 * pages and the home page's picks. List queries select list columns only (never `description`
 * or the raw form schema) and every per-person query is scoped by user id.
 *
 * Visibility: an opportunity is visible to a person when it is active and not someone else's
 * private link, or when it is their own private link (source_ref "user:<userId>:<hash>",
 * status active or unverified). Closed ones (deadline passed) never appear on the board.
 */

const o = opportunities;
const m = matches;
const a = applications;

export const USER_REF_PREFIX = "user:";
export const NEW_MATCH_DAYS = 7;

/** source_ref prefix of the links one person added (see import.ts). */
export function ownerRefPrefix(userId: string): string {
  return `${USER_REF_PREFIX}${userId}:`;
}

export function isOwnedBy(sourceRef: string | null | undefined, userId: string | null | undefined): boolean {
  return Boolean(userId && sourceRef && sourceRef.startsWith(ownerRefPrefix(userId)));
}

/** SQL: the opportunity is visible to this person (see the module comment). */
export function visibleTo(userId: string): SQL {
  return sql`((${o.status} = 'active' and not starts_with(coalesce(${o.sourceRef}, ''), ${USER_REF_PREFIX})) or (${o.status} in ('active', 'unverified') and starts_with(coalesce(${o.sourceRef}, ''), ${ownerRefPrefix(userId)})))`;
}

/** SQL: still open (no deadline, or a deadline in the future). */
export const notClosed: SQL = sql`(${o.deadline} is null or ${o.deadline} > now())`;

/* ------------------------------------------------------------------ columns & mapping */

const cardColumns = {
  id: o.id,
  slug: o.slug,
  type: o.type,
  name: o.name,
  orgName: o.orgName,
  orgSlug: o.orgSlug,
  url: o.url,
  summary: o.summary,
  deadline: o.deadline,
  rolling: o.rolling,
  cycle: o.cycle,
  geo: o.geo,
  benefits: o.benefits,
  cost: o.cost,
  applyChannel: sql<string | null>`${o.apply}->>'channel'`.as("apply_channel"),
  requiresAccount: sql<boolean | null>`(${o.apply}->>'requiresAccount')::boolean`.as("requires_account"),
  requiresPayment: sql<boolean | null>`(${o.apply}->>'requiresPayment')::boolean`.as("requires_payment"),
  captchaLikely: sql<boolean | null>`(${o.apply}->>'captchaLikely')::boolean`.as("captcha_likely"),
  requiredMaterials: o.requiredMaterials,
  tags: o.tags,
  estEffortMinutes: o.estEffortMinutes,
  qualityScore: o.qualityScore,
  verifiedAt: o.verifiedAt,
  status: o.status,
  public: o.public,
  sourceRef: o.sourceRef,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
};

const matchColumns = {
  mId: m.id,
  mGoalId: m.goalId,
  mFit: m.fit,
  mWin: m.winProbability,
  mEffort: m.effort,
  mValue: m.value,
  mReasons: m.reasons,
  mGaps: m.gaps,
  mRank: m.rank,
  mFeedback: m.feedback,
  mFeedbackReason: m.feedbackReason,
  mCreatedAt: m.createdAt,
};

const appColumns = { appId: a.id, appStatus: a.status };

type CardRow = {
  id: string;
  slug: string;
  type: OpportunityRow["type"];
  name: string;
  orgName: string | null;
  orgSlug: string | null;
  url: string | null;
  summary: string | null;
  deadline: Date | string | null;
  rolling: boolean;
  cycle: string | null;
  geo: OpportunityGeo | null;
  benefits: OpportunityRow["benefits"];
  cost: OpportunityRow["cost"];
  applyChannel: string | null;
  requiresAccount: boolean | null;
  requiresPayment: boolean | null;
  captchaLikely: boolean | null;
  requiredMaterials: string[] | null;
  tags: string[] | null;
  estEffortMinutes: number | null;
  qualityScore: number | null;
  verifiedAt: Date | string | null;
  status: OpportunityRow["status"];
  public: boolean;
  sourceRef: string | null;
  createdAt: Date | string;
  updatedAt: Date | string | null;
};

type MatchRowPart = {
  mId: string | null;
  mGoalId: string | null;
  mFit: number | null;
  mWin: number | null;
  mEffort: number | null;
  mValue: number | null;
  mReasons: string[] | null;
  mGaps: string[] | null;
  mRank: number | null;
  mFeedback: MatchInfo["feedback"];
  mFeedbackReason: string | null;
  mCreatedAt: Date | string | null;
};

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function safeGeo(g: unknown): OpportunityGeo {
  const parsed = opportunityGeoSchema.safeParse(g ?? {});
  return parsed.success ? parsed.data : { countries: [], cities: [], remote: null, worldwide: false };
}

/** A list row → the card every surface renders. */
export function toCard(row: CardRow, userId?: string | null): OpportunityCard {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    name: row.name,
    orgName: row.orgName,
    orgSlug: row.orgSlug,
    url: row.url,
    summary: row.summary,
    deadline: iso(row.deadline),
    rolling: row.rolling,
    cycle: row.cycle,
    geo: safeGeo(row.geo),
    benefits: row.benefits ?? null,
    cost: row.cost ?? null,
    channel: effectiveChannel(row.type, row.applyChannel),
    requiresAccount: Boolean(row.requiresAccount),
    requiresPayment: Boolean(row.requiresPayment),
    captchaLikely: Boolean(row.captchaLikely),
    requiredMaterials: (row.requiredMaterials ?? []) as MaterialId[],
    tags: (row.tags ?? []).slice(0, 12),
    estEffortMinutes: row.estEffortMinutes,
    qualityScore: row.qualityScore,
    verifiedAt: iso(row.verifiedAt),
    updatedAt: iso(row.updatedAt),
    status: row.status,
    public: row.public,
    mine: isOwnedBy(row.sourceRef, userId),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/** A full opportunities row → card (detail page, imports). */
export function cardFromRow(row: OpportunityRow, userId?: string | null): OpportunityCard {
  const apply = applyInfoSchema.safeParse(row.apply);
  return toCard(
    {
      ...row,
      applyChannel: apply.success ? apply.data.channel : null,
      requiresAccount: apply.success ? apply.data.requiresAccount : null,
      requiresPayment: apply.success ? apply.data.requiresPayment : null,
      captchaLikely: apply.success ? apply.data.captchaLikely : null,
    },
    userId,
  );
}

export function toDetail(row: OpportunityRow, userId?: string | null): OpportunityDetail {
  const apply = applyInfoSchema.safeParse(row.apply);
  return {
    ...cardFromRow(row, userId),
    tags: row.tags ?? [],
    description: row.description,
    eligibility: row.eligibility ?? null,
    languages: row.languages ?? [],
    industries: row.industries ?? [],
    functions: row.functions ?? [],
    applyUrl: apply.success ? apply.data.url : null,
    applyEmail: apply.success ? apply.data.email : null,
    platform: apply.success ? apply.data.platform : null,
    instructions: apply.success ? apply.data.instructions : null,
    estAcceptanceRate: row.estAcceptanceRate,
  };
}

function toMatch(row: MatchRowPart, now: Date): MatchInfo | null {
  if (!row.mId) return null;
  const created = iso(row.mCreatedAt) ?? new Date(0).toISOString();
  return {
    id: row.mId,
    goalId: row.mGoalId,
    fit: row.mFit ?? 0,
    winProbability: row.mWin,
    effortMinutes: row.mEffort,
    value: row.mValue,
    reasons: Array.isArray(row.mReasons) ? row.mReasons.filter((r) => typeof r === "string") : [],
    gaps: Array.isArray(row.mGaps) ? row.mGaps.filter((g) => typeof g === "string") : [],
    rank: row.mRank,
    feedback: row.mFeedback,
    feedbackReason: row.mFeedbackReason,
    createdAt: created,
    isNew: !row.mFeedback && now.getTime() - new Date(created).getTime() < NEW_MATCH_DAYS * 86_400_000,
  };
}

/* ------------------------------------------------------------------ filters → SQL */

function searchCondition(q: string): SQL {
  const words = tagWords(q);
  const ts = sql`${o.search} @@ websearch_to_tsquery('simple', ${q})`;
  if (!words.length) return ts;
  return sql`(${ts} or ${o.tags} && array[${sql.join(
    words.map((w) => sql`${w}`),
    sql`, `,
  )}]::text[])`;
}

/** WHERE parts for the board's filters. `effort` reads minutes from the given expression. */
export function filterConditions(f: BoardFilters, effort: SQL, opts: { omitGroup?: boolean } = {}): SQL[] {
  const c: SQL[] = [];
  if (!opts.omitGroup) {
    if (f.type) c.push(eq(o.type, f.type));
    else if (f.group) c.push(inArray(o.type, typesInBoardGroup(f.group)));
  }
  if (f.remote === "remote") c.push(sql`(${o.geo}->>'remote' = 'remote' or ${o.geo}->>'worldwide' = 'true')`);
  else if (f.remote) c.push(sql`${o.geo}->>'remote' = ${f.remote}`);
  if (f.country) c.push(sql`((${o.geo}->'countries') @> jsonb_build_array(${f.country}::text) or ${o.geo}->>'worldwide' = 'true')`);
  if (f.deadline === "open") c.push(sql`(${o.deadline} is null or ${o.rolling} = true)`);
  else if (f.deadline) c.push(sql`(${o.deadline} > now() and ${o.deadline} <= now() + (${DEADLINE_DAYS[f.deadline]}::int * interval '1 day'))`);
  if (f.effort) {
    const { min, max } = EFFORT_LIMITS[f.effort];
    c.push(max === null ? sql`${effort} >= ${min}::int` : sql`${effort} between ${min}::int and ${max}::int`);
  }
  if (f.q) c.push(searchCondition(f.q));
  return c;
}

/* ------------------------------------------------------------------ the board */

export interface BoardQuery {
  userId: string;
  filters: BoardFilters;
  offset?: number;
  limit?: number;
  now?: Date;
}

/** Whether the person has any application at all (practice runs included). */
export const hasAnyApplication = cache(async (userId: string): Promise<boolean> => {
  const rows = await db.select({ id: a.id }).from(a).where(eq(a.userId, userId)).limit(1);
  return rows.length > 0;
});

function pickConditions(userId: string, f: BoardFilters, practiceAllowed: boolean, opts: { omitGroup?: boolean } = {}): SQL[] {
  // "Later" keeps everything the person saved, ranked or not (saved from "Everything open", or
  // pushed out of the top picks by a later refresh); picks are the ranked board.
  const c: SQL[] = [
    eq(m.userId, userId),
    f.view === "later" ? eq(m.feedback, "later") : and(isNotNull(m.rank), sql`(${m.feedback} is null or ${m.feedback} = 'interested')`)!,
    visibleTo(userId),
    notClosed,
    isNull(a.id),
    ...filterConditions(f, sql`${m.effort}`, opts),
  ];
  if (f.goal) c.push(eq(m.goalId, f.goal));
  if (!practiceAllowed) c.push(ne(o.type, "practice"));
  return c;
}

function allConditions(userId: string, f: BoardFilters, opts: { omitGroup?: boolean } = {}): SQL[] {
  return [
    visibleTo(userId),
    notClosed,
    ne(o.type, "practice"),
    sql`${m.feedback} is distinct from 'not_interested'`,
    ...filterConditions(f, sql`coalesce(${m.effort}, ${o.estEffortMinutes})`, opts),
  ];
}

function appJoin(userId: string): SQL {
  return and(eq(a.userId, userId), eq(a.opportunityId, o.id), eq(a.practice, false)) as SQL;
}

async function queryBoard(q: BoardQuery): Promise<BoardPage> {
  const { userId, filters: f } = q;
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 20;
  const now = q.now ?? new Date();
  const columns = { ...cardColumns, ...matchColumns, ...appColumns };

  let rows: (CardRow & MatchRowPart & { appId: string | null; appStatus: ApplicationStatus | null })[];
  if (f.view === "all") {
    const order: SQL[] = [];
    if (f.q) order.push(sql`ts_rank(${o.search}, websearch_to_tsquery('simple', ${f.q})) desc`);
    order.push(sql`${m.rank} asc nulls last`, sql`${o.qualityScore} desc nulls last`, sql`${o.deadline} asc nulls last`, asc(o.id));
    rows = await db
      .select(columns)
      .from(o)
      .leftJoin(m, and(eq(m.opportunityId, o.id), eq(m.userId, userId)))
      .leftJoin(a, appJoin(userId))
      .where(and(...allConditions(userId, f)))
      .orderBy(...order)
      .limit(limit + 1)
      .offset(offset);
  } else {
    const practiceAllowed = !(await hasAnyApplication(userId));
    rows = await db
      .select(columns)
      .from(m)
      .innerJoin(o, eq(o.id, m.opportunityId))
      .leftJoin(a, appJoin(userId))
      .where(and(...pickConditions(userId, f, practiceAllowed)))
      .orderBy(...(f.view === "later" ? [desc(m.updatedAt), asc(o.id)] : [asc(m.rank), desc(m.updatedAt), asc(o.id)]))
      .limit(limit + 1)
      .offset(offset);
  }

  const items: BoardItem[] = rows.slice(0, limit).map((r) => ({
    opportunity: toCard(r, userId),
    match: toMatch(r, now),
    application: r.appId && r.appStatus ? { id: r.appId, status: r.appStatus } : null,
  }));
  return { items, next: rows.length > limit ? offset + limit : null };
}

const boardCached = cache((userId: string, key: string, offset: number, limit: number) =>
  queryBoard({ userId, filters: parseBoardFilters(new URLSearchParams(key)), offset, limit }),
);

/** One page of the Scout board. Deduplicated per request (React cache). */
export function listBoard(q: BoardQuery): Promise<BoardPage> {
  if (q.now) return queryBoard(q);
  return boardCached(q.userId, filtersToQuery(q.filters), q.offset ?? 0, q.limit ?? 20);
}

/** Per-chip counts for the current view and filters (the chip filter itself ignored). */
export const boardGroupCounts = cache(async (userId: string, key: string): Promise<Record<BoardGroup, number>> => {
  const f = parseBoardFilters(new URLSearchParams(key));
  const count = sql<number>`count(*)::int`;
  let rows: { type: string; n: number }[];
  if (f.view === "all") {
    rows = await db
      .select({ type: o.type, n: count })
      .from(o)
      .leftJoin(m, and(eq(m.opportunityId, o.id), eq(m.userId, userId)))
      .where(and(...allConditions(userId, f, { omitGroup: true })))
      .groupBy(o.type);
  } else {
    const practiceAllowed = !(await hasAnyApplication(userId));
    rows = await db
      .select({ type: o.type, n: count })
      .from(m)
      .innerJoin(o, eq(o.id, m.opportunityId))
      .leftJoin(a, appJoin(userId))
      .where(and(...pickConditions(userId, f, practiceAllowed, { omitGroup: true })))
      .groupBy(o.type);
  }
  return groupCounts(Object.fromEntries(rows.map((r) => [r.type, Number(r.n)])));
});

/** Picks added to the board in the last seven days and not acted on (optionally for one goal). */
export const newThisWeek = cache(async (userId: string, goalId: string | null): Promise<number> => {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .innerJoin(o, eq(o.id, m.opportunityId))
    .where(
      and(
        eq(m.userId, userId),
        isNotNull(m.rank),
        isNull(m.feedback),
        ne(o.type, "practice"),
        sql`${m.createdAt} > now() - (${NEW_MATCH_DAYS}::int * interval '1 day')`,
        visibleTo(userId),
        notClosed,
        goalId ? eq(m.goalId, goalId) : undefined,
      ),
    );
  return Number(rows[0]?.n ?? 0);
});

/** Countries that appear on the person's picks, most frequent first (the region filter). */
export const boardRegions = cache(async (userId: string): Promise<string[]> => {
  const res = await db.execute(sql`
    select c.code as code, count(*)::int as n
    from ${m} m
    join ${o} on ${o.id} = m.opportunity_id
    cross join lateral jsonb_array_elements_text(coalesce(${o.geo}->'countries', '[]'::jsonb)) as c(code)
    where m.user_id = ${userId} and m.rank is not null and (m.feedback is null or m.feedback = 'interested')
      and ${visibleTo(userId)} and ${notClosed}
    group by c.code
    order by n desc, c.code asc
    limit 16
  `);
  return ((res.rows ?? []) as { code: string }[]).map((r) => String(r.code).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
});

/** Whether the person has any ranked pick yet (else the scout is still out looking). */
export const hasAnyMatch = cache(async (userId: string): Promise<boolean> => {
  const rows = await db.select({ id: m.id }).from(m).where(and(eq(m.userId, userId), isNotNull(m.rank))).limit(1);
  return rows.length > 0;
});

/** When the person's picks were last refreshed (max matches.updated_at), null before the first run. */
export const lastRefreshedAt = cache(async (userId: string): Promise<string | null> => {
  const rows = await db.select({ at: sql<string | null>`max(${m.updatedAt})` }).from(m).where(eq(m.userId, userId));
  return iso(rows[0]?.at ?? null);
});

/* ------------------------------------------------------------------ single opportunity */

export const getOpportunityRow = cache(async (id: string): Promise<OpportunityRow | null> => {
  const rows = await db.select().from(o).where(eq(o.id, id)).limit(1);
  return rows[0] ?? null;
});

export const getOpportunityRowBySlug = cache(async (slug: string): Promise<OpportunityRow | null> => {
  const rows = await db.select().from(o).where(eq(o.slug, slug)).limit(1);
  return rows[0] ?? null;
});

export interface DetailForUser {
  opportunity: OpportunityDetail;
  match: MatchInfo | null;
  application: { id: string; status: ApplicationStatus } | null;
  /** Visible on the board rules (else only reachable through the person's own application). */
  visible: boolean;
}

/**
 * The detail page's data: the opportunity when the person may see it (visible to them, or they
 * already applied), their match and their application. Null when not found or not theirs to see.
 */
export const getDetailForUser = cache(async (userId: string, id: string): Promise<DetailForUser | null> => {
  const now = new Date();
  const [row, matchRows, appRows] = await Promise.all([
    getOpportunityRow(id),
    db.select(matchColumns).from(m).where(and(eq(m.userId, userId), eq(m.opportunityId, id))).limit(1),
    db
      .select(appColumns)
      .from(a)
      .where(and(eq(a.userId, userId), eq(a.opportunityId, id)))
      .orderBy(asc(a.practice), desc(a.createdAt))
      .limit(1),
  ]);
  if (!row) return null;
  const owned = isOwnedBy(row.sourceRef, userId);
  const visible = (row.status === "active" && !(row.sourceRef ?? "").startsWith(USER_REF_PREFIX)) || (owned && (row.status === "active" || row.status === "unverified"));
  const app = appRows[0];
  if (!visible && !app) return null;
  return {
    opportunity: toDetail(row, userId),
    match: matchRows[0] ? toMatch(matchRows[0], now) : null,
    application: app?.appId && app.appStatus ? { id: app.appId, status: app.appStatus } : null,
    visible,
  };
});

/** Up to `limit` open opportunities of the same type (the person's best matches first). */
export const similarOpportunities = cache(async (userId: string, id: string, type: string, limit = 4): Promise<BoardItem[]> => {
  const rows = await db
    .select({ ...cardColumns, ...matchColumns })
    .from(o)
    .leftJoin(m, and(eq(m.opportunityId, o.id), eq(m.userId, userId)))
    .where(and(eq(o.type, type as OpportunityRow["type"]), ne(o.id, id), visibleTo(userId), notClosed, sql`${m.feedback} is distinct from 'not_interested'`))
    .orderBy(sql`${m.rank} asc nulls last`, sql`${o.qualityScore} desc nulls last`, sql`${o.deadline} asc nulls last`, asc(o.id))
    .limit(limit);
  const now = new Date();
  return rows.map((r) => ({ opportunity: toCard(r, userId), match: toMatch(r, now), application: null }));
});

/* ------------------------------------------------------------------ public lists (SEO, P5b) */

/** Public, active opportunities for programmatic pages (list columns only). */
export async function listPublicOpportunities(input: { type?: string; orgSlug?: string; limit: number; offset?: number }): Promise<OpportunityCard[]> {
  const rows = await db
    .select(cardColumns)
    .from(o)
    .where(
      and(
        eq(o.status, "active"),
        eq(o.public, true),
        notClosed,
        input.type ? eq(o.type, input.type as OpportunityRow["type"]) : undefined,
        input.orgSlug ? eq(o.orgSlug, input.orgSlug) : undefined,
      ),
    )
    .orderBy(sql`${o.deadline} asc nulls last`, sql`${o.qualityScore} desc nulls last`, asc(o.name))
    .limit(Math.max(1, Math.min(input.limit, 500)))
    .offset(Math.max(0, input.offset ?? 0));
  return rows.map((r) => toCard(r, null));
}

/** Open public opportunities per type (`{ grant: 41, accelerator: 18, … }`). */
export async function countPublicByType(): Promise<Record<string, number>> {
  const rows = await db
    .select({ type: o.type, n: sql<number>`count(*)::int` })
    .from(o)
    .where(and(eq(o.status, "active"), eq(o.public, true), notClosed))
    .groupBy(o.type);
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

/* ------------------------------------------------------------------ top matches (home, digest) */

/**
 * The person's best open picks, best first (home "this week's picks", digest). The practice run
 * is left out unless asked for: it is a rehearsal, not a match (its stored fit is 0).
 */
export async function topMatches(userId: string, limit: number, opts: { includePractice?: boolean } = {}): Promise<MatchCard[]> {
  const n = Math.max(1, Math.min(limit, 50));
  const page = await listBoard({ userId, filters: parseBoardFilters(null), offset: 0, limit: n + 1 });
  return page.items
    .filter((i): i is BoardItem & { match: MatchInfo } => Boolean(i.match) && (opts.includePractice || i.opportunity.type !== "practice"))
    .slice(0, n)
    .map((i) => ({ ...i.match, opportunity: i.opportunity }));
}

/** The person's match for one opportunity (null when none). */
export async function getMatchFor(userId: string, opportunityId: string): Promise<MatchInfo | null> {
  const rows = await db.select(matchColumns).from(m).where(and(eq(m.userId, userId), eq(m.opportunityId, opportunityId))).limit(1);
  return rows[0] ? toMatch(rows[0], new Date()) : null;
}

/** An open opportunity visible to the person whose official URL is one of `urls` (import dedupe). */
export async function findVisibleByUrl(userId: string, urls: string[]): Promise<OpportunityRow | null> {
  const list = [...new Set(urls.filter(Boolean))];
  if (!list.length) return null;
  const rows = await db
    .select()
    .from(o)
    .where(and(inArray(o.url, list), visibleTo(userId), notClosed, ne(o.type, "practice")))
    .orderBy(sql`case when ${o.status} = 'active' then 0 else 1 end`, asc(o.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
