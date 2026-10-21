import "server-only";
import { waitUntil } from "@vercel/functions";
import type { JobRow } from "@/lib/db/schema";
import type { JsonObject } from "@/lib/core/types";
import { captureError } from "@/lib/errors";
import { env } from "@/lib/env";
import { SITE } from "@/lib/site";
import { loadHandler } from "./handlers";
import { checkpoint, claim, claimById, enqueue, settle, sweepExpired, WORKER_ID, type EnqueueOptions, type EnqueueResult } from "./queue";
import { DEFAULT_LEASE_MS, type JobContext, type JobKind } from "./registry";
import { decide, type Decision, type JobResult } from "./state";

/*
 * Executes jobs. Two entry points:
 *  - runDue(): the drain (/api/cron/jobs, hourly by Vercel Cron, and on demand through
 *    kickDrain()) — claims due jobs in small batches until the time budget or the job cap
 *    is reached;
 *  - runJobNow(id): the inline kick right after enqueue, inside the user's request
 *    (`waitUntil(runJobNow(id))`, or `enqueueAndRun`), so nobody waits for the cron.
 * Handlers get a deadline and an AbortSignal; long work checkpoints its state and returns
 * `{ status: "continue" }` to resume in the next invocation.
 *
 * Cost rule: the database (Neon free plan, 100 CU-hours a month per project) must be able to
 * scale to zero, so nothing polls it every minute. The cron runs hourly; user-triggered work
 * runs inline (runJobNow keeps continuing a job while its budget lasts) and, when work is
 * left over, kickDrain() starts the next drain immediately instead of waiting for the cron.
 */

/** Seconds kept free at the end of an invocation for settling and the response. */
const SAFETY_MS = 15_000;
const BATCH = 3;

export interface JobOutcome {
  id: string;
  kind: string;
  status: Decision["status"] | "lost";
  error?: string;
  ms: number;
}

export interface RunReport {
  claimed: number;
  done: number;
  continued: number;
  retried: number;
  failed: number;
  lost: number;
  sweptExpired: number;
  tookMs: number;
  outcomes: JobOutcome[];
}

class Timeout extends Error {
  constructor(ms: number) {
    super(`Handler exceeded its time budget (${Math.round(ms / 1000)} s)`);
    this.name = "JobTimeout";
  }
}

async function execute(job: JobRow, deadline: number): Promise<JobOutcome> {
  const started = Date.now();
  const registered = await loadHandler(job.kind).catch(async (err) => {
    await captureError(err, { route: `jobs/${job.kind}`, source: "cron", severity: "warn", context: { jobId: job.id, phase: "load" } });
    return null;
  });
  let outcome: { result?: JobResult; error?: unknown };
  if (!registered) {
    // The module may not be deployed yet: retry slowly (fails after max attempts, ~1 h).
    outcome = { result: { status: "retry", error: `No handler is registered for job kind "${job.kind}"`, delayMs: 15 * 60_000 } };
  } else {
    const budget = Math.max(1_000, Math.min(deadline, registered.timeoutMs ? started + registered.timeoutMs : deadline) - Date.now());
    const controller = new AbortController();
    const leaseMs = registered.leaseMs ?? DEFAULT_LEASE_MS;
    const ctx: JobContext = {
      job,
      kind: job.kind,
      userId: job.userId,
      payload: (job.payload ?? {}) as JsonObject,
      state: (job.state ?? {}) as JsonObject,
      attempt: job.attempts,
      deadline: Date.now() + budget,
      timeLeftMs: () => Math.max(0, ctx.deadline - Date.now()),
      checkpoint: async (patch: JsonObject) => {
        Object.assign(ctx.state, patch);
        const ok = await checkpoint(job, patch, leaseMs);
        if (!ok) throw new Error("Lost the job lease (cancelled or taken over by another worker)");
      },
      signal: controller.signal,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        registered.handler(ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Timeout(budget));
          }, budget);
        }),
      ]);
      outcome = { result };
    } catch (err) {
      outcome = { error: err };
    } finally {
      clearTimeout(timer);
    }
  }
  const maxAttempts = registered?.maxAttempts ?? job.maxAttempts;
  const decision = decide(outcome, { attempts: job.attempts, maxAttempts });
  if (outcome.error !== undefined && decision.status === "failed") {
    await captureError(outcome.error, { route: `jobs/${job.kind}`, source: "cron", context: { jobId: job.id, attempts: job.attempts } });
  } else if (outcome.error !== undefined) {
    console.warn(`[jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed, retrying:`, outcome.error instanceof Error ? outcome.error.message : outcome.error);
  }
  let held = false;
  try {
    held = await settle(job, decision);
  } catch (err) {
    await captureError(err, { route: `jobs/${job.kind}`, source: "cron", context: { jobId: job.id, phase: "settle" } });
  }
  return {
    id: job.id,
    kind: job.kind,
    status: held ? decision.status : "lost",
    ...(decision.status === "failed" ? { error: decision.error } : decision.status === "queued" && decision.error ? { error: decision.error } : {}),
    ms: Date.now() - started,
  };
}

function tally(report: RunReport, o: JobOutcome): void {
  report.outcomes.push(o);
  if (o.status === "done") report.done++;
  else if (o.status === "failed") report.failed++;
  else if (o.status === "lost") report.lost++;
  else if (o.error) report.retried++;
  else report.continued++;
}

export interface RunDueOptions {
  /** Wall-clock budget for this drain (default 280 s for a 300 s function). */
  maxMs?: number;
  /** Stop after this many jobs (default 100). */
  maxJobs?: number;
  /** Only these kinds (default: all). */
  kinds?: string[];
}

/** Drains due jobs until the time budget or the job cap is used up. */
export async function runDue(opts: RunDueOptions = {}): Promise<RunReport> {
  const started = Date.now();
  const deadline = started + (opts.maxMs ?? 280_000);
  const maxJobs = opts.maxJobs ?? 100;
  const report: RunReport = { claimed: 0, done: 0, continued: 0, retried: 0, failed: 0, lost: 0, sweptExpired: 0, tookMs: 0, outcomes: [] };
  report.sweptExpired = await sweepExpired();
  while (report.claimed < maxJobs && deadline - Date.now() > SAFETY_MS + 5_000) {
    const batch = await claim({ limit: Math.min(BATCH, maxJobs - report.claimed), kinds: opts.kinds, workerId: WORKER_ID });
    if (!batch.length) break;
    report.claimed += batch.length;
    // A small batch runs concurrently: handlers are I/O-bound (model calls, fetches, DB).
    const results = await Promise.all(batch.map((job) => execute(job, deadline - SAFETY_MS)));
    for (const r of results) tally(report, r);
  }
  report.tookMs = Date.now() - started;
  return report;
}

/** Header carrying how many drains in a row were chained by kickDrain (bounded). */
export const DRAIN_DEPTH_HEADER = "x-drain-depth";
const MAX_DRAIN_CHAIN = 5;

/**
 * Starts a drain (/api/cron/jobs) in a separate invocation without waiting for it: Vercel
 * functions keep running when the caller disconnects (cancellation is opt-in), so the caller
 * only waits for the request to leave. Bounded by MAX_DRAIN_CHAIN to avoid endless chains.
 */
export function kickDrain(depth = 0): void {
  const secret = env("CRON_SECRET");
  if (!secret || depth >= MAX_DRAIN_CHAIN) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  const p = fetch(`${SITE.url}/api/cron/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, [DRAIN_DEPTH_HEADER]: String(depth + 1) },
    signal: ctrl.signal,
    cache: "no-store",
  })
    .catch((err) => {
      // An abort after the request left is expected; anything else is logged, never thrown.
      if (!(err instanceof Error && err.name === "AbortError")) console.warn("[jobs] kickDrain failed", err);
    })
    .finally(() => clearTimeout(timer));
  try {
    waitUntil(p);
  } catch {
    void p;
  }
}

function continued(o: JobOutcome): boolean {
  return o.status === "queued" && !o.error;
}

/**
 * Runs one job right now if it is due and unclaimed (inline kick after enqueue). A job that
 * checkpoints and asks to continue is resumed in the same invocation while the budget lasts;
 * if it still has work when the budget runs out, the next drain is kicked immediately.
 */
export async function runJobNow(id: string, opts: { maxMs?: number } = {}): Promise<JobOutcome | null> {
  const budgetEnd = Date.now() + (opts.maxMs ?? 240_000);
  let last: JobOutcome | null = null;
  try {
    for (let round = 0; round < 50; round++) {
      const job = await claimById(id, { workerId: WORKER_ID });
      if (!job) return last; // not due yet, already running elsewhere, or finished
      last = await execute(job, budgetEnd);
      if (!continued(last)) return last;
      if (budgetEnd - Date.now() < SAFETY_MS + 10_000) {
        kickDrain();
        return last;
      }
    }
    return last;
  } catch (err) {
    // The cron will pick the job up; the person's request must not fail because of a kick.
    await captureError(err, { route: "jobs/runJobNow", severity: "warn", context: { jobId: id } });
    return null;
  }
}

/**
 * Enqueue and start immediately in the background of the current request (Vercel
 * `waitUntil`): the common pattern for user-triggered work.
 */
export async function enqueueAndRun(kind: JobKind, payload: JsonObject = {}, opts: EnqueueOptions & { maxMs?: number } = {}): Promise<EnqueueResult> {
  const res = await enqueue(kind, payload, opts);
  if (res.status === "queued" && (!opts.runAfter || opts.runAfter.getTime() <= Date.now())) {
    waitUntil(runJobNow(res.id, { maxMs: opts.maxMs }));
  }
  return res;
}
