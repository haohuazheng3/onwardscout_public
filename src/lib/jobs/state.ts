import type { JobStatus } from "@/lib/core/types";

/*
 * The queue's pure decision logic: what happens to a job after a handler ran (or threw),
 * retry backoff, and which status moves are legal. queue.ts applies the decisions with
 * conditional UPDATEs; tests cover this module without a database.
 *
 *   queued ──claim──▶ running ──done──────────▶ done
 *     ▲                 │ ──continue────────▶ queued (attempt refunded, run now/after delay)
 *     │                 │ ──retry/throw─────▶ queued (backoff) | failed (attempts used up)
 *     │                 │ ──fail/permanent──▶ failed
 *     │                 │ ──lease expired───▶ (re-claimed) | failed (attempts used up)
 *     └── cancel ◀──────┴──────────────────────▶ cancelled
 */

export const TERMINAL_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled"];

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["done", "failed", "queued", "cancelled", "running"],
  done: ["queued"], // re-armed by enqueue({ onDuplicate: "rearm" })
  failed: ["queued"], // retried by an operator or re-armed
  cancelled: ["queued"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;

/**
 * Delay before retry number `attempt` (1 = the first retry): 30 s, 1 min, 2 min, 4 min…
 * capped at one hour, with ±20 % jitter so retries of a burst don't stampede together.
 * `random` is injectable for deterministic tests.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(Math.min(BACKOFF_MAX_MS, base * jitter));
}

/** Longest pause an invocation sits through to resume a job that asked to continue after a delay. */
export const MAX_INLINE_WAIT_MS = 30_000;

/**
 * How long an invocation should wait before resuming a job that continued with `delayMs`, or
 * null when the wait does not fit (longer than MAX_INLINE_WAIT_MS, or it would eat into the
 * `reserveMs` kept free at the end) and the job is left to the next drain. Without this, a job
 * that polls ("continue in 3 s") sat queued until the hourly cron. Pure.
 */
export function inlineWaitMs(delayMs: number, timeLeftMs: number, reserveMs: number): number | null {
  const wait = Math.max(0, Math.round(delayMs));
  if (wait > MAX_INLINE_WAIT_MS) return null;
  if (timeLeftMs - wait < reserveMs) return null;
  return wait;
}

/** What a handler may return; `undefined` means done. */
export type JobResult =
  | void
  | undefined
  | { status: "done"; result?: Record<string, unknown> }
  /** Yield and continue in a new invocation (long tasks): state is merged first. */
  | { status: "continue"; state?: Record<string, unknown>; delayMs?: number }
  /** Transient problem: try again later (counts as an attempt). */
  | { status: "retry"; error: string; delayMs?: number }
  /** Permanent problem: stop. */
  | { status: "fail"; error: string };

/** Thrown by handlers for errors retrying can't fix (bad payload, deleted record). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export type Decision =
  | { status: "done"; result: Record<string, unknown> | null }
  | { status: "queued"; delayMs: number; error: string | null; refundAttempt: boolean; state: Record<string, unknown> | null }
  | { status: "failed"; error: string };

export interface AttemptInfo {
  /** Attempts used so far, including the one that just ran. */
  attempts: number;
  maxAttempts: number;
}

/** Turns a handler's result (or thrown error) into the next job state. Pure. */
export function decide(outcome: { result?: JobResult; error?: unknown }, job: AttemptInfo, random: () => number = Math.random): Decision {
  if (outcome.error !== undefined) {
    const err = outcome.error;
    const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 2000);
    if (err instanceof PermanentJobError || (err instanceof Error && err.name === "PermanentJobError")) return { status: "failed", error: message };
    if (job.attempts >= job.maxAttempts) return { status: "failed", error: `${message} (gave up after ${job.attempts} attempts)` };
    return { status: "queued", delayMs: backoffMs(job.attempts, random), error: message, refundAttempt: false, state: null };
  }
  const r = outcome.result;
  if (!r || r.status === "done") return { status: "done", result: r && "result" in r ? (r.result ?? null) : null };
  if (r.status === "continue") return { status: "queued", delayMs: Math.max(0, r.delayMs ?? 0), error: null, refundAttempt: true, state: r.state ?? null };
  if (r.status === "fail") return { status: "failed", error: r.error.slice(0, 2000) };
  // retry
  if (job.attempts >= job.maxAttempts) return { status: "failed", error: `${r.error.slice(0, 2000)} (gave up after ${job.attempts} attempts)` };
  return { status: "queued", delayMs: r.delayMs ?? backoffMs(job.attempts, random), error: r.error.slice(0, 2000), refundAttempt: false, state: null };
}
