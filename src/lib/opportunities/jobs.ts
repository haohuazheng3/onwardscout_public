import "server-only";
import type { JsonObject } from "@/lib/core/types";
import type { JobModule } from "@/lib/jobs/handlers";
import type { JobContext } from "@/lib/jobs/registry";
import { PermanentJobError, type JobResult } from "@/lib/jobs/state";
import { refreshMatches, type RefreshState } from "./matching";

/*
 * 'matches.refresh' — payload { userId, notify? }. Enqueued by refreshMatchesSoon() (profile or
 * goal changes, the board's refresh button, scheduled runs). Long Claude-scored runs checkpoint
 * between batches of 50 and continue in the next invocation.
 */
async function refreshJob(ctx: JobContext): Promise<JobResult> {
  const userId = ctx.userId ?? (typeof ctx.payload.userId === "string" ? ctx.payload.userId : null);
  if (!userId) throw new PermanentJobError("matches.refresh needs a userId");
  const outcome = await refreshMatches(userId, {
    state: ctx.state as RefreshState,
    timeLeftMs: ctx.timeLeftMs,
    checkpoint: (state) => ctx.checkpoint(state as unknown as JsonObject),
    notify: ctx.payload.notify === true,
  });
  if (outcome.status === "continue") return { status: "continue", state: outcome.state as unknown as Record<string, unknown>, delayMs: 0 };
  return { status: "done", result: { ...outcome.summary } };
}

export const jobHandlers: JobModule = {
  "matches.refresh": { handler: refreshJob, leaseMs: 5 * 60_000 },
};
