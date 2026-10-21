/*
 * When an opportunity stops being open.
 * - Deadlines: a dated opportunity (not rolling) expires once its deadline day has ended
 *   everywhere (deadlines are stored as 23:59:59 UTC of the stated date; we wait a further
 *   12 hours, "anywhere on Earth", before calling it past).
 * - Jobs: a posting not listed in either of the last two complete runs of its board expires
 *   (one missed run can be a hiccup of the board's API). A posting that reappears is reopened.
 * Pure decisions are exported for tests; the DB helpers apply them with conditional UPDATEs.
 */
import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import type { OpportunityStatus } from "@/lib/core/types";
import { db } from "@/lib/db";
import { opportunities } from "@/lib/db/schema";

/** Days a closed job posting is kept (for "this role closed" on matches and links) before it is purged. */
export const CLOSED_JOB_RETENTION_DAYS = 30;

/** Grace after the stored deadline (23:59:59 UTC) before an opportunity counts as past. */
export const DEADLINE_GRACE_MS = 12 * 60 * 60 * 1000;
/** Complete board runs a job may be missing from before it expires. */
export const UNSEEN_RUNS_TO_EXPIRE = 2;

export function isPastDeadline(deadline: Date | null | undefined, now: Date): boolean {
  if (!deadline) return false;
  return deadline.getTime() + DEADLINE_GRACE_MS < now.getTime();
}

/** Status of a curated entry: expired when its (non-rolling) deadline has passed, else active when verified. */
export function curatedStatus(input: { verified: boolean; deadline: Date | null; rolling: boolean; now: Date }): OpportunityStatus {
  if (!input.rolling && isPastDeadline(input.deadline, input.now)) return "expired";
  return input.verified ? "active" : "unverified";
}

export interface SeenRun {
  /** ISO time the run started. */
  at: string;
  /** Posting ids the board listed in that run (after the per-board cap). */
  refs: string[];
}

/** Adds a complete run to the history, keeping the newest `keep`. */
export function pushRun(history: readonly SeenRun[], run: SeenRun, keep = UNSEEN_RUNS_TO_EXPIRE): SeenRun[] {
  return [run, ...history].slice(0, keep);
}

/**
 * Refs (among `activeRefs`) that were in none of the last `UNSEEN_RUNS_TO_EXPIRE` complete runs.
 * Nothing expires until that many runs are on record.
 */
export function unseenRefs(activeRefs: readonly string[], history: readonly SeenRun[]): string[] {
  const recent = history.slice(0, UNSEEN_RUNS_TO_EXPIRE);
  if (recent.length < UNSEEN_RUNS_TO_EXPIRE) return [];
  const seen = new Set(recent.flatMap((r) => r.refs));
  return activeRefs.filter((r) => !seen.has(r));
}

/** Refs still listed in at least one of the recent runs (what stays open). */
export function keptRefs(history: readonly SeenRun[]): string[] {
  return [...new Set(history.slice(0, UNSEEN_RUNS_TO_EXPIRE).flatMap((r) => r.refs))];
}

/** Reads the run history stored in `sources.config.extra.seenRuns` (tolerates anything). */
export function readSeenRuns(config: unknown): SeenRun[] {
  const extra = (config as { extra?: { seenRuns?: unknown } } | null)?.extra;
  const runs = Array.isArray(extra?.seenRuns) ? extra.seenRuns : [];
  return runs
    .filter((r): r is SeenRun => Boolean(r) && typeof (r as SeenRun).at === "string" && Array.isArray((r as SeenRun).refs))
    .map((r) => ({ at: r.at, refs: r.refs.filter((x): x is string => typeof x === "string") }));
}

/* ------------------------------------------------------------------ database */

/** Expires every active, non-rolling opportunity whose deadline (plus grace) has passed. Returns the count. */
export async function expirePastDeadlines(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEADLINE_GRACE_MS);
  const rows = await db
    .update(opportunities)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(and(eq(opportunities.status, "active"), eq(opportunities.rolling, false), isNotNull(opportunities.deadline), lt(opportunities.deadline, cutoff)))
    .returning({ id: opportunities.id });
  return rows.length;
}

/**
 * Expires the active postings of a source that are not in `keep` (the refs listed in the last
 * complete runs). With `keep` empty every active posting of the source expires (board gone).
 */
export async function expireUnlisted(sourceId: string, keep: readonly string[]): Promise<number> {
  const where = keep.length
    ? and(eq(opportunities.sourceId, sourceId), eq(opportunities.status, "active"), notInArray(opportunities.sourceRef, [...keep]))
    : and(eq(opportunities.sourceId, sourceId), eq(opportunities.status, "active"));
  const rows = await db.update(opportunities).set({ status: "expired", updatedAt: sql`now()` }).where(where).returning({ id: opportunities.id });
  return rows.length;
}

/** Reopens expired postings that a board lists again (never touches rejected or unverified rows). */
export async function reopenListed(sourceId: string, refs: readonly string[]): Promise<number> {
  if (!refs.length) return 0;
  const rows = await db
    .update(opportunities)
    .set({ status: "active", verifiedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(opportunities.sourceId, sourceId), eq(opportunities.status, "expired"), inArray(opportunities.sourceRef, [...refs]), sql`(${opportunities.deadline} is null or ${opportunities.deadline} > now())`))
    .returning({ id: opportunities.id });
  return rows.length;
}

/**
 * Deletes ATS job postings that closed more than `CLOSED_JOB_RETENTION_DAYS` ago and that no
 * application or match refers to (plus their snapshots), so a nightly churn of postings does not
 * grow the database forever. Curated programs and anything a person interacted with are never purged.
 */
export async function purgeClosedJobs(opts: { olderThanDays?: number; limit?: number } = {}): Promise<number> {
  const days = opts.olderThanDays ?? CLOSED_JOB_RETENTION_DAYS;
  const limit = opts.limit ?? 5000;
  const res = await db.execute(sql`
    with doomed as (
      select o.id from opportunities o
      join sources s on s.id = o.source_id
      where s.kind in ('greenhouse', 'lever', 'ashby')
        and o.status = 'expired'
        and o.updated_at < now() - make_interval(days => ${days})
        and not exists (select 1 from applications a where a.opportunity_id = o.id)
        and not exists (select 1 from matches m where m.opportunity_id = o.id)
      limit ${limit}
    ), snaps as (
      delete from opportunity_snapshots where opportunity_id in (select id from doomed) returning 1
    )
    delete from opportunities where id in (select id from doomed) returning id
  `);
  return ((res as unknown as { rows?: unknown[] }).rows ?? []).length;
}
