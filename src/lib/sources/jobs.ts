import "server-only";
import { z } from "zod";
import { ATS_PROVIDERS } from "@/lib/core/types";
import { captureError } from "@/lib/errors";
import type { JobModule } from "@/lib/jobs/handlers";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { runSources, type RunScope } from "./runner";

/*
 * Job kind `sources.run`: one ingestion pass inside the job's time budget.
 * Payload (all optional): { only?: ("greenhouse"|"lever"|"ashby"|"verify")[], sourceIds?: string[],
 * budgetMs?: number, full?: boolean }. With `full: true` the job keeps continuing (new
 * invocations) until every selected board has run once since the job started — the admin
 * "refresh all boards now" button enqueues that (dedupe key with a date bucket).
 */

const payloadSchema = z.object({
  only: z.array(z.enum([...ATS_PROVIDERS, "verify"])).optional(),
  sourceIds: z.array(z.string().min(1)).max(1000).optional(),
  budgetMs: z.number().int().min(5_000).max(280_000).optional(),
  full: z.boolean().optional(),
});

async function sourcesRun(ctx: JobContext): Promise<JobResult> {
  const parsed = payloadSchema.safeParse(ctx.payload ?? {});
  if (!parsed.success) return { status: "fail", error: `Invalid sources.run payload: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  const p = parsed.data;
  const cycleStart = typeof ctx.state.cycleStart === "string" ? new Date(ctx.state.cycleStart) : new Date();
  const budgetMs = Math.max(5_000, Math.min(p.budgetMs ?? 240_000, ctx.timeLeftMs() - 20_000));
  const report = await runSources({
    budgetMs,
    only: p.only as RunScope[] | undefined,
    sourceIds: p.sourceIds,
    notRunSince: p.full ? cycleStart : undefined,
    force: Boolean(p.sourceIds?.length),
    signal: ctx.signal,
    report: (err, context) => captureError(err, { route: "job:sources.run", source: "cron", severity: "warn", context }),
  });
  const summary = {
    tookMs: report.tookMs,
    boards: report.boards,
    jobs: report.jobs,
    expiredByDeadline: report.expiredByDeadline,
    verify: report.verify ? { checked: report.verify.checked, ok: report.verify.ok, gone: report.verify.gone, blocked: report.verify.blocked } : null,
  };
  // Public opportunity pages and their data caches (a day long) pick up what this pass changed.
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("opportunities", "max");
  } catch (err) {
    await captureError(err, { route: "job:sources.run#revalidate", source: "cron", severity: "warn" });
  }
  if (p.full && report.boards.remaining > 0) {
    return { status: "continue", state: { cycleStart: cycleStart.toISOString(), last: summary }, delayMs: 5_000 };
  }
  return { status: "done", result: summary };
}

export const jobHandlers: JobModule = {
  "sources.run": { handler: sourcesRun, leaseMs: 6 * 60_000, maxAttempts: 3 },
};
