import { sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";
import { digestCandidates, isoWeek } from "@/lib/digest";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** app_state key the admin diagnostics page reads. */
const STATE_KEY = "cron:digest:last";
const PAGE = 500;
const PARALLEL = 20;

/*
 * Weekly brief fan-out (Vercel Cron, Mondays 14:00 UTC, GET + Bearer CRON_SECRET). Enqueues one
 * `digest.send` job per eligible person; the dedupe key carries the ISO week, so a second run
 * in the same week (a retry, a manual call) enqueues nothing new. The jobs drain through
 * /api/cron/jobs. `?dry=1` only counts.
 */
export async function GET(req: Request) {
  if (!bearerMatches(req, env("CRON_SECRET"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const now = new Date();
  const week = isoWeek(now).key;
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  let candidates = 0;
  let enqueued = 0;
  let existing = 0;
  let failed = 0;
  let complete = true;
  try {
    let after: string | null = null;
    for (;;) {
      if (Date.now() - started > 250_000) {
        complete = false;
        break;
      }
      const ids = await digestCandidates(after, PAGE);
      if (!ids.length) break;
      candidates += ids.length;
      after = ids[ids.length - 1];
      if (!dry) {
        for (let i = 0; i < ids.length; i += PARALLEL) {
          const results = await Promise.allSettled(
            ids.slice(i, i + PARALLEL).map((userId) => enqueue("digest.send", { week }, { userId, dedupeKey: `digest.send:${userId}:${week}`, maxAttempts: 4 })),
          );
          for (const r of results) {
            if (r.status === "rejected") {
              failed++;
              if (failed <= 3) await captureError(r.reason, { route: "/api/cron/digest", source: "cron", context: { week } });
            } else if (r.value.created) enqueued++;
            else existing++;
          }
        }
      }
      if (ids.length < PAGE) break;
    }
    const summary = { ranAt: now.toISOString(), tookMs: Date.now() - started, week, dry, candidates, enqueued, existing, failed, complete };
    if (!dry) {
      await db
        .insert(appState)
        .values({ key: STATE_KEY, value: summary })
        .onConflictDoUpdate({ target: appState.key, set: { value: summary, updatedAt: sql`now()` } });
    }
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/cron/digest", source: "cron", context: { week, candidates, enqueued } });
    return Response.json({ error: "The weekly brief fan-out failed; it has been logged." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
