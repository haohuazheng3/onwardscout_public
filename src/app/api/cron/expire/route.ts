import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { deleteAnonymousDraft, staleAnonymousIds } from "@/lib/data-export";
import { db } from "@/lib/db";
import { appState, jobs, opportunities } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { sweepExpired } from "@/lib/jobs/queue";
import { DEADLINE_GRACE_MS, expirePastDeadlines } from "@/lib/sources/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE_KEY = "cron:expire:last";
/** Abandoned anonymous drafts (`anon_*`, never claimed by signing in) are erased after this many idle days… */
const ANON_DAYS = 7;
/** …and any unclaimed draft once it is this old (privacy policy: "at most 30 days"; the os_anon cookie lives 30 days). */
const ANON_MAX_AGE_DAYS = 30;

/*
 * Nightly housekeeping (Vercel Cron 04:40 UTC, GET + Bearer CRON_SECRET). Each step runs on its
 * own; one failing step is captured and reported without stopping the others.
 *
 *  1. Opportunities whose deadline passed (the sources module's rule: the stated day ends at
 *     23:59:59 UTC, plus 12 hours of grace) and that are not rolling → status `expired`, for
 *     active and unverified rows alike (they leave matching, public lists and the review queue).
 *  2. Anonymous drafts idle for 7 days, or older than 30 → their files in R2 and every row erased.
 *  3. Jobs: running jobs whose lease ran out on their last attempt → failed (sweepExpired);
 *     weekly briefs still queued after their week, and notification emails still queued after
 *     3 days, are cancelled (late is worse than never; the in-app copy stays). Other kinds are
 *     left alone: a backlog after an outage is real work, and dedupe keys are kept forever.
 *  4. Credit lots need no marking: src/lib/credits.ts treats `expires_at` as authoritative
 *     (an expired lot is simply not usable), and lots only have the statuses active/revoked.
 */
export async function GET(req: Request) {
  if (!bearerMatches(req, env("CRON_SECRET"))) {
    return Response.json({ error: "Not authorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const now = new Date();
  const errors: { step: string; error: string }[] = [];
  const step = async <T,>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      errors.push({ step: name, error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) });
      await captureError(err, { route: `/api/cron/expire#${name}`, source: "cron" });
      return fallback;
    }
  };

  const expiredOpportunities = await step(
    "opportunities",
    async () => {
      // One rule for "past deadline", shared with the source runs (src/lib/sources/expiry.ts):
      // deadlines are stored as 23:59:59 UTC of the stated day, plus 12 hours of grace.
      const active = await expirePastDeadlines(now);
      // Unverified entries whose deadline passed leave the review queue the same way.
      const cutoff = new Date(now.getTime() - DEADLINE_GRACE_MS);
      const unverified = await db
        .update(opportunities)
        .set({ status: "expired", updatedAt: sql`now()` })
        .where(and(eq(opportunities.status, "unverified"), eq(opportunities.rolling, false), isNotNull(opportunities.deadline), lt(opportunities.deadline, cutoff)))
        .returning({ id: opportunities.id });
      return active + unverified.length;
    },
    0,
  );

  const anonymous = await step(
    "anonymous",
    async () => {
      let drafts = 0;
      let objects = 0;
      for (let round = 0; round < 10 && Date.now() - started < 200_000; round++) {
        const ids = await staleAnonymousIds(ANON_DAYS, 50, ANON_MAX_AGE_DAYS);
        if (!ids.length) break;
        for (const id of ids) {
          if (Date.now() - started > 240_000) break;
          const report = await deleteAnonymousDraft(id);
          drafts++;
          objects += report.objects;
        }
        if (ids.length < 50) break;
      }
      return { drafts, objects };
    },
    { drafts: 0, objects: 0 },
  );

  const jobsReport = await step(
    "jobs",
    async () => {
      const swept = await sweepExpired();
      const staleDigests = await db
        .update(jobs)
        .set({ status: "cancelled", error: "Cancelled: the week of this brief is over", lockedUntil: null, lockedBy: null, updatedAt: sql`now()` })
        .where(and(eq(jobs.kind, "digest.send"), eq(jobs.status, "queued"), lt(jobs.createdAt, sql`now() - interval '6 days'`)))
        .returning({ id: jobs.id });
      const staleEmails = await db
        .update(jobs)
        .set({ status: "cancelled", error: "Cancelled: an email this late would be noise (the in-app notification stays)", lockedUntil: null, lockedBy: null, updatedAt: sql`now()` })
        .where(and(eq(jobs.kind, "notify.email"), eq(jobs.status, "queued"), lt(jobs.createdAt, sql`now() - interval '3 days'`)))
        .returning({ id: jobs.id });
      return { swept, staleDigests: staleDigests.length, staleEmails: staleEmails.length };
    },
    { swept: 0, staleDigests: 0, staleEmails: 0 },
  );

  const summary = { ranAt: now.toISOString(), tookMs: Date.now() - started, expiredOpportunities, anonymous, jobs: jobsReport, errors };
  await db
    .insert(appState)
    .values({ key: STATE_KEY, value: summary })
    .onConflictDoUpdate({ target: appState.key, set: { value: summary, updatedAt: sql`now()` } })
    .catch((err) => captureError(err, { route: "/api/cron/expire", source: "cron", severity: "warn" }));
  return Response.json(summary, { status: errors.length ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
