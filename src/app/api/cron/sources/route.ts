import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { scheduleDailyRefreshes } from "@/lib/opportunities";
import { runSources } from "@/lib/sources/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** app_state key the admin sources page reads: the summary of the last cron pass. */
const CRON_SOURCES_STATE_KEY = "cron:sources:last";
const NO_STORE = { "Cache-Control": "no-store" };

/** Boards read more recently than this are left alone (the nightly sweep already did them). */
const FRESH_HOURS = 12;

/*
 * Daily ingestion pass (Vercel Cron, GET + Bearer CRON_SECRET): closes past deadlines, refreshes
 * the least recently read ATS boards not read in the last 12 hours for ~180 s, then re-checks a
 * slice of curated program pages. The nightly GitHub Actions run (.github/workflows/sources.yml)
 * does the complete board sweep; when it ran, this route only does the checks — when it did not
 * (Actions minutes used up, a failure), this route keeps the oldest boards moving.
 * Afterwards, with the day's data in: every person with an active goal whose matches are older
 * than 20 hours gets a 'matches.refresh' job (notify → "new matches"), drained by
 * /api/cron/jobs; and the public listing cache (tag "opportunities") is marked stale.
 * GET for schedulers, POST for operators.
 */
async function run(req: Request): Promise<Response> {
  if (!bearerMatches(req, env("CRON_SECRET"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: NO_STORE });
  }
  // Operators may shorten the pass (?budget=<seconds>, 10–220) for a smoke run; the cron uses the full budget.
  const asked = Number(new URL(req.url).searchParams.get("budget"));
  const budgetMs = Number.isFinite(asked) && asked > 0 ? Math.min(220, Math.max(10, Math.floor(asked))) * 1000 : 220_000;
  try {
    const report = await runSources({
      budgetMs,
      notRunSince: new Date(Date.now() - FRESH_HOURS * 60 * 60 * 1000),
      report: (err, context) => captureError(err, { route: "/api/cron/sources", source: "cron", severity: "warn", context }),
    });
    const summary = {
      ranAt: report.startedAt,
      tookMs: report.tookMs,
      expiredByDeadline: report.expiredByDeadline,
      boards: report.boards,
      jobs: report.jobs,
      database: report.database,
      verify: report.verify ? { ...report.verify, goneIds: report.verify.goneIds.slice(0, 50) } : null,
      errors: report.errors.slice(0, 20),
      matchRefreshes: await scheduleDailyRefreshes({ staleHours: 20 }).catch(async (err: unknown) => {
        await captureError(err, { route: "/api/cron/sources#matches", source: "cron", severity: "warn" });
        return { queued: 0 };
      }),
    };
    try {
      revalidateTag("opportunities", "max");
    } catch (err) {
      await captureError(err, { route: "/api/cron/sources#revalidate", source: "cron", severity: "warn" });
    }
    await db
      .insert(appState)
      .values({ key: CRON_SOURCES_STATE_KEY, value: summary })
      .onConflictDoUpdate({ target: appState.key, set: { value: summary, updatedAt: sql`now()` } })
      .catch((err) => captureError(err, { route: "/api/cron/sources", source: "cron", severity: "warn" }));
    return Response.json(summary, { headers: NO_STORE });
  } catch (err) {
    await captureError(err, { route: "/api/cron/sources", source: "cron" });
    return Response.json({ error: "The sources run failed; it has been logged." }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
