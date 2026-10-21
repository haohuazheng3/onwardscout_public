import { sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { dueFollowUps } from "@/lib/applications";
import { db } from "@/lib/db";
import { appState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATE_KEY = "cron:followups:last";
const LIMIT = 300;

/*
 * Follow-ups that are due (Vercel Cron, hourly, GET + Bearer CRON_SECRET). The application
 * engine (P3a) decides which applications are due (`dueFollowUps`: submitted/waiting, no reply,
 * follow_up_at passed); this route only enqueues one `application.followup` job per application
 * per UTC day. The handler then sends it automatically when the person authorised automatic
 * follow-ups (`autoFollowUpAllowed` in src/lib/authorizations.ts), otherwise it prepares the
 * follow-up and asks for a tap.
 */
export async function GET(req: Request) {
  if (!bearerMatches(req, env("CRON_SECRET"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  try {
    const due = await dueFollowUps(LIMIT);
    let enqueued = 0;
    let existing = 0;
    let failed = 0;
    for (let i = 0; i < due.length; i += 20) {
      const results = await Promise.allSettled(
        due.slice(i, i + 20).map((d: { applicationId: string; userId: string }) =>
          enqueue("application.followup", { applicationId: d.applicationId }, { userId: d.userId, dedupeKey: `application.followup:${d.applicationId}:${day}` }),
        ),
      );
      for (const r of results) {
        if (r.status === "rejected") {
          failed++;
          if (failed <= 3) await captureError(r.reason, { route: "/api/cron/followups", source: "cron" });
        } else if (r.value.created) enqueued++;
        else existing++;
      }
    }
    const summary = { ranAt: now.toISOString(), tookMs: Date.now() - started, due: due.length, enqueued, existing, failed, capped: due.length >= LIMIT };
    await db
      .insert(appState)
      .values({ key: STATE_KEY, value: summary })
      .onConflictDoUpdate({ target: appState.key, set: { value: summary, updatedAt: sql`now()` } });
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/cron/followups", source: "cron" });
    return Response.json({ error: "The follow-up scan failed; it has been logged." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
