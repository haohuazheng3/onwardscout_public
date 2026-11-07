import { sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { queueStats } from "@/lib/jobs/queue";
import { DRAIN_DEPTH_HEADER, kickDrain, runDue } from "@/lib/jobs/runner";
import { reportAlarm } from "@/lib/ops-alarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** app_state key the admin jobs/diagnostics pages read: the summary of the last drain. */
const CRON_JOBS_STATE_KEY = "cron:jobs:last";
/** The owner alarm of the scheduled drain (src/lib/ops-alarm.ts; state in R2, not in the database). */
const DRAIN_ALARM = { name: "drain", title: "hourly job drain (also the database probe)" } as const;

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
    if (req.method === "GET") await reportAlarm({ ...DRAIN_ALARM, ok: true, detail: `The scheduled /api/cron/jobs run at ${startedAt.toISOString()} succeeded.` }).catch((e: unknown) => console.error("[cron/jobs] owner alarm failed", e));
    return Response.json(
      { ...summary, outcomes: report.outcomes.slice(0, 50).map((o) => ({ id: o.id, kind: o.kind, status: o.status, ms: o.ms, ...(o.error ? { error: o.error.slice(0, 200) } : {}) })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    await captureError(err, { route: "/api/cron/jobs", source: "cron" });
    // The hourly drain is also the database probe (the scheduled health check is shallow, so it
    // never wakes the database off the hour): a failed scheduled run feeds the owner alarm, which
    // emails on a change of state only (DOWN after 2 failed runs in a row, a daily reminder,
    // RECOVERED) — the error inbox may be unreachable for the same reason.
    if (req.method === "GET") {
      await reportAlarm({
        ...DRAIN_ALARM,
        ok: false,
        detail: `The scheduled /api/cron/jobs run failed at ${startedAt.toISOString()}.\n\n${err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 1000) : String(err).slice(0, 1000)}`,
      }).catch((e: unknown) => console.error("[cron/jobs] owner alarm failed", e));
    }
    return Response.json({ error: "The job drain failed; it has been logged." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(req: Request) {
  return drain(req);
}

export async function POST(req: Request) {
  return drain(req);
}
