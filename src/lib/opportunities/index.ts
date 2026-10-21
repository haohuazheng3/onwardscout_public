import "server-only";
import { waitUntil } from "@vercel/functions";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type Opportunity } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/queue";
import { enqueueAndRun, runJobNow } from "@/lib/jobs/runner";
import { PRACTICE_OPPORTUNITY_SLUG, ensurePracticeOpportunity } from "./practice";
import { getOpportunityRow, getOpportunityRowBySlug } from "./queries";

/*
 * The opportunity engine (owner P2a) — contracts-features §7. Consumers: P1 (home picks,
 * refresh after profile/goal changes), P3a (the opportunity an application is for, the
 * practice run), P5b (public lists and counts), P6 (digest, admin).
 */

export { PRACTICE_OPPORTUNITY_SLUG, ensurePracticeOpportunity } from "./practice";
export { countPublicByType, listPublicOpportunities, topMatches, listBoard, getDetailForUser, similarOpportunities } from "./queries";
export { refreshMatches, scoreAndPin, type RefreshOutcome, type RefreshSummary } from "./matching";
export { importFromUrl, type ImportResult } from "./import";
export type { BoardItem, BoardPage, MatchCard, MatchInfo, OpportunityCard, OpportunityDetail } from "./types";

/** Any opportunity by id (any status, any visibility: callers check access). */
export async function getOpportunity(id: string): Promise<Opportunity | null> {
  return getOpportunityRow(id);
}

/** Any opportunity by slug. The practice opportunity is created on first request. */
export async function getOpportunityBySlug(slug: string): Promise<Opportunity | null> {
  const row = await getOpportunityRowBySlug(slug);
  if (row || slug !== PRACTICE_OPPORTUNITY_SLUG) return row;
  return ensurePracticeOpportunity();
}

/** Dedupe key of a person's refresh job (one row per person, re-armed when finished). */
export function refreshKey(userId: string): string {
  return `matches.refresh:${userId}`;
}

/**
 * Re-scores the person's board soon: enqueues 'matches.refresh' (deduplicated: a queued or
 * running refresh is reused; a finished one is re-armed) and starts it right away in the
 * background of this request. A refresh that is waiting out a retry backoff is pulled forward,
 * because someone is asking for it now. Never throws — a failed kick is logged and the cron
 * picks the job up.
 */
export async function refreshMatchesSoon(userId: string, opts: { notify?: boolean } = {}): Promise<void> {
  try {
    const res = await enqueueAndRun("matches.refresh", { userId, notify: Boolean(opts.notify) }, { userId, dedupeKey: refreshKey(userId), onDuplicate: "rearm", maxMs: 240_000 });
    if (!res.created && res.status === "queued") {
      const pulled = await db
        .update(jobs)
        .set({ runAfter: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(jobs.id, res.id), eq(jobs.status, "queued"), sql`${jobs.runAfter} > now()`))
        .returning({ id: jobs.id });
      if (pulled.length) waitUntil(runJobNow(res.id, { maxMs: 240_000 }));
    }
  } catch (err) {
    await captureError(err, { route: "opportunities/refreshMatchesSoon", severity: "warn", context: { userId } });
  }
}

export interface RefreshState {
  /** A refresh is queued or running. */
  refreshing: boolean;
  /** When the last refresh finished (or failed), ISO. */
  finishedAt: string | null;
  /** The last refresh failed for good. */
  failed: boolean;
}

/** Whether the person's board is being refreshed (for the board's "your scout is out looking" state). */
export async function refreshState(userId: string): Promise<RefreshState> {
  const rows = await db
    .select({ status: jobs.status, updatedAt: jobs.updatedAt })
    .from(jobs)
    .where(eq(jobs.dedupeKey, refreshKey(userId)))
    .limit(1);
  const job = rows[0];
  if (!job) return { refreshing: false, finishedAt: null, failed: false };
  const refreshing = job.status === "queued" || job.status === "running";
  return { refreshing, finishedAt: refreshing ? null : job.updatedAt.toISOString(), failed: job.status === "failed" };
}

/**
 * Daily pass for a cron (after the sources have run): queues a refresh, with a "new matches"
 * notification, for every person with an active goal whose board is older than `staleHours`.
 * Jobs are not kicked inline — the jobs cron drains them. Returns how many were queued.
 */
export async function scheduleDailyRefreshes(opts: { limit?: number; staleHours?: number } = {}): Promise<{ queued: number }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
  const staleHours = Math.max(1, opts.staleHours ?? 20);
  const res = await db.execute(sql`
    select g.user_id as user_id
    from goals g
    where g.status = 'active' and not starts_with(g.user_id, 'anon_')
    group by g.user_id
    having coalesce((select max(m.updated_at) from matches m where m.user_id = g.user_id), 'epoch'::timestamptz) < now() - (${staleHours}::int * interval '1 hour')
    limit ${limit}
  `);
  let queued = 0;
  for (const row of (res.rows ?? []) as { user_id: string }[]) {
    try {
      const r = await enqueue("matches.refresh", { userId: row.user_id, notify: true }, { userId: row.user_id, dedupeKey: refreshKey(row.user_id), onDuplicate: "rearm" });
      if (r.created) queued++;
    } catch (err) {
      await captureError(err, { route: "opportunities/scheduleDailyRefreshes", severity: "warn", context: { userId: row.user_id } });
    }
  }
  return { queued };
}
