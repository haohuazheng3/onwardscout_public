import { sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { queueStats } from "@/lib/jobs/queue";
import { DRAIN_DEPTH_HEADER, kickDrain, runDue } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** app_state key the admin jobs/diagnostics pages read: the summary of the last drain. */
const CRON_JOBS_STATE_KEY = "cron:jobs:last";

/*
 * Drains the job queue. Called hourly by Vercel Cron (GET) and on demand by kickDrain() (POST),
 * always with `Authorization: Bearer CRON_SECRET`. When the time budget runs out with work left,
 * it chains the next drain itself (bounded), so the hourly cadence never delays user work.
 * Runs due jobs for up to ~280 s of the 300 s budget and answers with counts; the summary
 * is kept in app_state for the admin pages. GET for schedulers, POST for operators.
 */
async function drain(req: Request): Promise<Response> {
  if (!bearerMatches(req, env("CRON_SECRET"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(req.url);
  const maxJobs = Math.min(500, Math.max(1, Number(url.searchParams.get("max") ?? 200) || 200));
  const kinds = url.searchParams.get("kinds")?.split(",").map((k) => k.trim()).filter(Boolean);
  const startedAt = new Date();
  try {
    const depth = Math.max(0, Math.min(10, Number(req.headers.get(DRAIN_DEPTH_HEADER) ?? 0) || 0));
    const report = await runDue({ maxMs: 280_000, maxJobs, kinds });
    // Budget or cap exhausted with jobs still claimable → keep going in a fresh invocation.
    if (!kinds && (report.claimed >= maxJobs || report.continued > 0)) kickDrain(depth);
    const stats = await queueStats().catch((err) => {
      console.error("[cron/jobs] queue stats unavailable", err);
      return {};
    });
    const summary = {
      ranAt: startedAt.toISOString(),
      tookMs: report.tookMs,
      claimed: report.claimed,
      done: report.done,
      continued: report.continued,
      retried: report.retried,
      failed: report.failed,
      lost: report.lost,
      sweptExpired: report.sweptExpired,
      queue: stats,
    };
    await db
      .insert(appState)
      .values({ key: CRON_JOBS_STATE_KEY, value: summary })
      .onConflictDoUpdate({ target: appState.key, set: { value: summary, updatedAt: sql`now()` } })
      .catch((err) => captureError(err, { route: "/api/cron/jobs", source: "cron", severity: "warn" }));
    return Response.json(
      { ...summary, outcomes: report.outcomes.slice(0, 50).map((o) => ({ id: o.id, kind: o.kind, status: o.status, ms: o.ms, ...(o.error ? { error: o.error.slice(0, 200) } : {}) })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    await captureError(err, { route: "/api/cron/jobs", source: "cron" });
    return Response.json({ error: "The job drain failed; it has been logged." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(req: Request) {
  return drain(req);
}

export async function POST(req: Request) {
  return drain(req);
}
