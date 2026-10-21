import "server-only";
import { registerJob, registeredJob, type JobHandler, type JobOptions, type KnownJobKind, type RegisteredJob } from "./registry";

/*
 * Where each job kind's handler lives. The runner loads a kind's module lazily the first
 * time it sees a job of that kind, so /api/cron/jobs only pulls in the feature code it needs.
 *
 * Owner module contract (src/lib/<area>/jobs.ts, or src/lib/digest.ts / notifications.ts):
 *
 *   import type { JobModule } from "@/lib/jobs/handlers";
 *   export const jobHandlers: JobModule = {
 *     "profile.parse": { handler: parseDocument, leaseMs: 4 * 60_000 },
 *     "profile.extract": extractProfileJob,            // a bare handler is fine too
 *   };
 *
 * (Calling `registerJob(kind, handler)` at import time works as well.)
 *
 * WHY THE LIST BELOW IS EXPLICIT: a static `import()` of a module that doesn't exist fails
 * the TypeScript check and the Next build, and a lazy per-kind loader keeps each function's
 * bundle small. A new kind gets its line here when its module ships. A job whose kind has no
 * loader stays queued with a "no handler" error and is retried with backoff, then fails after
 * max attempts; nothing is lost silently.
 */

export type JobModuleEntry = JobHandler | ({ handler: JobHandler } & JobOptions);
export type JobModule = Partial<Record<KnownJobKind | (string & {}), JobModuleEntry>>;

type Loader = () => Promise<{ jobHandlers?: JobModule } & Record<string, unknown>>;

export const JOB_MODULES: Partial<Record<KnownJobKind, Loader>> = {
  "profile.parse": () => import("@/lib/profile/jobs"),
  "profile.extract": () => import("@/lib/profile/jobs"),
  "matches.refresh": () => import("@/lib/opportunities/jobs"),
  "application.prepare": () => import("@/lib/applications/jobs"),
  "application.submit": () => import("@/lib/applications/jobs"),
  "application.followup": () => import("@/lib/applications/jobs"),
  "sources.run": () => import("@/lib/sources/jobs"),
  "digest.send": () => import("@/lib/digest"),
  "notify.email": () => import("@/lib/notifications"),
};

/** Registers every handler a module exports in `jobHandlers`. */
export function registerModule(mod: { jobHandlers?: JobModule }): void {
  for (const [kind, entry] of Object.entries(mod.jobHandlers ?? {})) {
    if (!entry) continue;
    if (typeof entry === "function") registerJob(kind, entry);
    else registerJob(kind, entry.handler, entry);
  }
}

const loading = new Map<string, Promise<void>>();

/** The handler for a kind: already registered, or loaded from its module. Null when unknown. */
export async function loadHandler(kind: string): Promise<RegisteredJob | null> {
  const ready = registeredJob(kind);
  if (ready) return ready;
  const loader = JOB_MODULES[kind as KnownJobKind];
  if (!loader) return null;
  let p = loading.get(kind);
  if (!p) {
    p = loader().then(registerModule);
    loading.set(kind, p);
    // A failed import may succeed on a later invocation (deploy in progress): don't cache it.
    p.catch(() => loading.delete(kind));
  }
  await p;
  return registeredJob(kind) ?? null;
}
