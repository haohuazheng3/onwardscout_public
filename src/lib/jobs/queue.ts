import "server-only";
import { and, asc, eq, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, type JobRow } from "@/lib/db/schema";
import type { JsonObject } from "@/lib/core/types";
import { newId, randomString } from "@/lib/ids";
import { DEFAULT_LEASE_MS, type JobKind } from "./registry";
import { decide, type Decision } from "./state";

/*
 * Postgres job queue on Neon over HTTP. No interactive transactions, so every operation is
 * one statement:
 *
 *  - enqueue: INSERT … ON CONFLICT (dedupe_key) — at most one job per dedupe key (or re-arm
 *    a finished one when asked);
 *  - claim: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *,
 *    taking due queued jobs and running jobs whose lease expired (a crashed invocation);
 *  - complete / fail / defer / checkpoint: conditional UPDATEs on (id, status = running,
 *    locked_by = this worker), so a worker that lost its lease can't overwrite the new owner.
 */

export const WORKER_ID = `${process.env.VERCEL_REGION ?? "local"}:${randomString(8)}`;

/** `now() + n seconds` with an explicitly typed parameter (Neon HTTP sends parameters as text). */
function fromNow(ms: number): SQL {
  return sql`now() + (${Math.max(0, Math.round(ms)) / 1000}::float8 * interval '1 second')`;
}

export interface EnqueueOptions {
  userId?: string | null;
  /** Earliest time to run (default now). */
  runAfter?: Date;
  /**
   * At most one job per key. Pick keys that say what must not happen twice:
   * `profile.extract:<profileId>:<docsHash>`, `digest.send:<userId>:<isoWeek>`.
   */
  dedupeKey?: string | null;
  /** When a job with the same dedupe key already finished (or its worker died): "skip" (default) or "rearm" it. */
  onDuplicate?: "skip" | "rearm";
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string;
  /** False when an existing job with the same dedupe key was returned instead. */
  created: boolean;
  status: JobRow["status"];
}

export async function enqueue(kind: JobKind, payload: JsonObject = {}, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
  const values = {
    id: newId("job"),
    kind,
    userId: opts.userId ?? null,
    payload,
    state: {},
    status: "queued" as const,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 5,
    runAfter: opts.runAfter ?? new Date(),
    dedupeKey: opts.dedupeKey ?? null,
  };
  if (!values.dedupeKey) {
    const rows = await db.insert(jobs).values(values).returning({ id: jobs.id, status: jobs.status });
    return { id: rows[0].id, created: true, status: rows[0].status };
  }
  const insert = db.insert(jobs).values(values);
  const rows =
    opts.onDuplicate === "rearm"
      ? await insert
          .onConflictDoUpdate({
            target: jobs.dedupeKey,
            set: {
              status: "queued",
              payload: sql`excluded.payload`,
              state: sql`'{}'::jsonb`,
              attempts: 0,
              runAfter: sql`excluded.run_after`,
              lockedUntil: null,
              lockedBy: null,
              error: null,
              updatedAt: sql`now()`,
            },
            // A running job whose lease ran out lost its worker (the invocation died): start it over too.
            setWhere: or(inArray(jobs.status, ["done", "failed", "cancelled"]), and(eq(jobs.status, "running"), isNotNull(jobs.lockedUntil), lt(jobs.lockedUntil, sql`now()`)))!,
          })
          .returning({ id: jobs.id, status: jobs.status })
      : await insert.onConflictDoNothing({ target: jobs.dedupeKey }).returning({ id: jobs.id, status: jobs.status });
  if (rows[0]) return { id: rows[0].id, created: rows[0].id === values.id || opts.onDuplicate === "rearm", status: rows[0].status };
  const existing = await db.select({ id: jobs.id, status: jobs.status }).from(jobs).where(eq(jobs.dedupeKey, values.dedupeKey)).limit(1);
  if (!existing[0]) throw new Error(`enqueue: conflict on ${values.dedupeKey} but no row found`);
  return { id: existing[0].id, created: false, status: existing[0].status };
}

export interface ClaimOptions {
  limit?: number;
  kinds?: string[];
  leaseMs?: number;
  workerId?: string;
}

/** Claims up to `limit` due jobs (oldest first) for this worker. */
export async function claim(opts: ClaimOptions = {}): Promise<JobRow[]> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const due: SQL = or(and(eq(jobs.status, "queued"), lte(jobs.runAfter, sql`now()`)), and(eq(jobs.status, "running"), isNotNull(jobs.lockedUntil), lt(jobs.lockedUntil, sql`now()`), lt(jobs.attempts, jobs.maxAttempts)))!;
  const where = opts.kinds?.length ? and(due, inArray(jobs.kind, opts.kinds))! : due;
  const candidates = db.select({ id: jobs.id }).from(jobs).where(where).orderBy(asc(jobs.runAfter)).limit(limit).for("update", { skipLocked: true });
  return db
    .update(jobs)
    .set({
      status: "running",
      attempts: sql`${jobs.attempts} + 1`,
      lockedUntil: fromNow(leaseMs),
      lockedBy: opts.workerId ?? WORKER_ID,
      updatedAt: sql`now()`,
    })
    .where(inArray(jobs.id, candidates))
    .returning();
}

/** Claims one specific job (inline kick after enqueue). Null when it isn't due or someone else has it. */
export async function claimById(id: string, opts: { leaseMs?: number; workerId?: string } = {}): Promise<JobRow | null> {
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const rows = await db
    .update(jobs)
    .set({
      status: "running",
      attempts: sql`${jobs.attempts} + 1`,
      lockedUntil: fromNow(leaseMs),
      lockedBy: opts.workerId ?? WORKER_ID,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, "queued"), lte(jobs.runAfter, sql`now()`)))
    .returning();
  return rows[0] ?? null;
}

function mine(id: string, workerId: string): SQL {
  return and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId))!;
}

/** Applies a runner decision (see state.ts `decide`). False when this worker no longer holds the job. */
export async function settle(job: Pick<JobRow, "id" | "lockedBy">, decision: Decision): Promise<boolean> {
  const workerId = job.lockedBy ?? WORKER_ID;
  let rows: Array<{ id: string }>;
  if (decision.status === "done") {
    rows = await db
      .update(jobs)
      .set({
        status: "done",
        lockedUntil: null,
        lockedBy: null,
        error: null,
        state: decision.result ? sql`${jobs.state} || ${JSON.stringify({ result: decision.result })}::jsonb` : jobs.state,
        updatedAt: sql`now()`,
      })
      .where(mine(job.id, workerId))
      .returning({ id: jobs.id });
  } else if (decision.status === "failed") {
    rows = await db.update(jobs).set({ status: "failed", lockedUntil: null, lockedBy: null, error: decision.error, updatedAt: sql`now()` }).where(mine(job.id, workerId)).returning({ id: jobs.id });
  } else {
    rows = await db
      .update(jobs)
      .set({
        status: "queued",
        lockedUntil: null,
        lockedBy: null,
        error: decision.error,
        runAfter: fromNow(decision.delayMs),
        // A "continue" is not a failure: give the attempt back.
        attempts: decision.refundAttempt ? sql`greatest(${jobs.attempts} - 1, 0)` : jobs.attempts,
        state: decision.state ? sql`${jobs.state} || ${JSON.stringify(decision.state)}::jsonb` : jobs.state,
        updatedAt: sql`now()`,
      })
      .where(mine(job.id, workerId))
      .returning({ id: jobs.id });
  }
  return rows.length > 0;
}

/** Marks a running job done (the runner does this for handlers; exposed for custom loops). */
export function complete(job: Pick<JobRow, "id" | "lockedBy">, result: Record<string, unknown> | null = null): Promise<boolean> {
  return settle(job, { status: "done", result });
}

/** Fails a running job: retried with exponential backoff while attempts remain, unless `retry: false`. */
export function fail(job: Pick<JobRow, "id" | "lockedBy" | "attempts" | "maxAttempts">, error: string, opts: { retry?: boolean; delayMs?: number } = {}): Promise<boolean> {
  const decision = decide({ result: opts.retry === false ? { status: "fail", error } : { status: "retry", error, delayMs: opts.delayMs } }, { attempts: job.attempts, maxAttempts: job.maxAttempts });
  return settle(job, decision);
}

/** Merges a state patch and extends the lease (heartbeat for long handlers). */
export async function checkpoint(job: Pick<JobRow, "id" | "lockedBy">, patch: JsonObject, leaseMs = DEFAULT_LEASE_MS): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      state: sql`${jobs.state} || ${JSON.stringify(patch)}::jsonb`,
      lockedUntil: fromNow(leaseMs),
      updatedAt: sql`now()`,
    })
    .where(mine(job.id, job.lockedBy ?? WORKER_ID))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Cancels a queued or running job (a running handler finishes its step; its settle is then ignored). */
export async function cancel(id: string, opts: { userId?: string } = {}): Promise<boolean> {
  const where = opts.userId ? and(eq(jobs.id, id), eq(jobs.userId, opts.userId), inArray(jobs.status, ["queued", "running"])) : and(eq(jobs.id, id), inArray(jobs.status, ["queued", "running"]));
  const rows = await db.update(jobs).set({ status: "cancelled", lockedUntil: null, lockedBy: null, updatedAt: sql`now()` }).where(where).returning({ id: jobs.id });
  return rows.length > 0;
}

/** Operator lever: put a failed or cancelled job back in the queue with fresh attempts. */
export async function retryNow(id: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAfter: sql`now()`, lockedUntil: null, lockedBy: null, error: null, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Fails running jobs whose lease expired after their last allowed attempt (a crash loop). */
export async function sweepExpired(): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "failed", lockedUntil: null, lockedBy: null, error: sql`coalesce(${jobs.error}, 'The job stopped responding') || ' (lease expired after the last attempt)'`, updatedAt: sql`now()` })
    .where(and(eq(jobs.status, "running"), isNotNull(jobs.lockedUntil), lt(jobs.lockedUntil, sql`now()`), sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function getJob(id: string, opts: { userId?: string } = {}): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(opts.userId ? and(eq(jobs.id, id), eq(jobs.userId, opts.userId)) : eq(jobs.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Counts by status, for the admin jobs page and /api/cron/jobs reports. */
export async function queueStats(): Promise<Record<string, number>> {
  const rows = await db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
