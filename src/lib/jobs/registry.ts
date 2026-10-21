import type { JobRow } from "@/lib/db/schema";
import type { JsonObject } from "@/lib/core/types";
import type { JobResult } from "./state";

/*
 * Job handlers by kind. Owners register their handlers in their own modules
 * (`registerJob("profile.parse", handler)` at import time, or by exporting `jobHandlers`);
 * src/lib/jobs/handlers.ts knows which module to load for each kind, so the runner never
 * imports feature code it doesn't need.
 */

/** Kinds used across the product (owners in parentheses). New kinds are plain strings. */
export const JOB_KINDS = [
  "profile.parse", // P1: extract text from an uploaded document / fetched link
  "profile.extract", // P1: documents → profile + facts (intelligence.extractProfile)
  "matches.refresh", // P2a: score opportunities for a person
  "application.prepare", // P3a: analyse, gaps, compose, render
  "application.submit", // P3a/P3b: submit through the channel after the person's tap
  "application.followup", // P3a/P3b: follow-up email after N days without a reply
  "sources.run", // P2b: crawl / fetch one source
  "digest.send", // P6: weekly digest
  "notify.email", // P6: "needs you" and other product email
] as const;

export type KnownJobKind = (typeof JOB_KINDS)[number];
export type JobKind = KnownJobKind | (string & {});

export interface JobContext {
  job: JobRow;
  kind: string;
  userId: string | null;
  payload: JsonObject;
  /** Checkpointed state from earlier invocations ({} on the first run). */
  state: JsonObject;
  /** Attempt number of this run (1-based). */
  attempt: number;
  /** Epoch ms by which the handler should return (yield with `{status: "continue"}`). */
  deadline: number;
  timeLeftMs(): number;
  /** Persists a state patch and extends the lease (heartbeat). */
  checkpoint(patch: JsonObject): Promise<void>;
  /** Aborted when the invocation runs out of time. */
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobOptions {
  /** How long a claim holds the job before another worker may take it (default 5 min). */
  leaseMs?: number;
  /** Upper bound for one invocation of this handler (default: the runner's remaining time). */
  timeoutMs?: number;
  /** Attempts before the job fails (default: the row's max_attempts, 5). */
  maxAttempts?: number;
}

export interface RegisteredJob extends JobOptions {
  kind: string;
  handler: JobHandler;
}

const handlers = new Map<string, RegisteredJob>();

export function registerJob(kind: JobKind, handler: JobHandler, opts: JobOptions = {}): void {
  handlers.set(kind, { kind, handler, ...opts });
}

export function registeredJob(kind: string): RegisteredJob | undefined {
  return handlers.get(kind);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()].sort();
}

/** Tests only: forget every registration. */
export function clearRegistry(): void {
  handlers.clear();
}

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
