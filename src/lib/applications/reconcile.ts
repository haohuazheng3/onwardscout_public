import "server-only";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { allApplicationsHoldingCredits, releaseApplication, settleApplication } from "@/lib/credits";
import { db } from "@/lib/db";
import { applications, opportunities } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { DEADLINE_GRACE_MS } from "@/lib/sources/expiry";
import { ApplicationError, execute, loadApplication } from "./engine";

/*
 * Daily credit reconciliation (run by /api/cron/expire). The engine never lets a credit move undo
 * a submission or a withdrawal, so a settle or release that failed (or a function that died
 * between the status change and the credit move) is repaired here:
 *   - submitted (submitted_at set) but still held      → settle;
 *   - ended unsubmitted (withdrawn, expired, closed, rejected) but still held → release;
 *   - waiting for the person (`needs_you`, not submitted) after the deadline → expired + release
 *     (refund policy: "it can't be completed before its deadline → the credit returns").
 * `submitting` is never touched: a submission whose job gave up is re-run by the person.
 */

const ENDED_UNSUBMITTED = new Set(["withdrawn", "expired", "closed", "rejected"]);

export interface CreditReconcileReport {
  checked: number;
  settled: number;
  released: number;
  expired: number;
}

/** Moves waiting applications past their deadline to `expired`, releasing a held credit. */
async function expireOverdue(now: Date, limit: number): Promise<number> {
  const cutoff = new Date(now.getTime() - DEADLINE_GRACE_MS);
  const rows = await db
    .select({ id: applications.id, deadline: opportunities.deadline })
    .from(applications)
    .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .where(
      and(
        eq(applications.status, "needs_you"),
        isNull(applications.submittedAt),
        eq(applications.practice, false),
        eq(opportunities.rolling, false),
        isNotNull(opportunities.deadline),
        lt(opportunities.deadline, cutoff),
      ),
    )
    .limit(limit);
  let expired = 0;
  for (const r of rows) {
    const app = await loadApplication(r.id);
    if (!app || app.status !== "needs_you" || app.submittedAt) continue;
    try {
      await execute(app, [
        { type: "transition", to: "expired", actor: "system" },
        { type: "release" },
        { type: "event", kind: "application.expired", data: { deadline: r.deadline?.toISOString() ?? null, from: "needs_you" } },
        { type: "followup", at: null },
        { type: "notify", key: "expired" },
      ]);
      expired++;
    } catch (err) {
      if (err instanceof ApplicationError && err.code === "conflict") continue; // the person acted meanwhile
      await captureError(err, { route: "applications/reconcile#expire", source: "cron", context: { applicationId: r.id } });
    }
  }
  return expired;
}

export async function reconcileApplicationCredits(opts: { now?: Date; limit?: number } = {}): Promise<CreditReconcileReport> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 300;
  const report: CreditReconcileReport = { checked: 0, settled: 0, released: 0, expired: 0 };
  report.expired = await expireOverdue(now, limit);

  for (const id of await allApplicationsHoldingCredits(limit)) {
    report.checked++;
    try {
      const app = await loadApplication(id);
      if (!app) continue;
      if (app.submittedAt) {
        if ((await settleApplication(app.id)).debited > 0) report.settled++;
        continue;
      }
      // A held round on a live, unsubmitted application (ready, preparing…) is reused by its next
      // confirm, so it is left alone: releasing it could free the reservation of a confirm in flight.
      if (ENDED_UNSUBMITTED.has(app.status)) {
        if ((await releaseApplication(app.id)).released > 0) {
          report.released++;
          await db.update(applications).set({ creditsReserved: 0, updatedAt: sql`now()` }).where(and(eq(applications.id, app.id), eq(applications.status, app.status)));
        }
        continue;
      }
      // `submitting` stays as it is: the submit job may still be running, and a job that gave up
      // cannot tell whether the form went through — the person re-runs it from the room.
    } catch (err) {
      await captureError(err, { route: "applications/reconcile", source: "cron", context: { applicationId: id } });
    }
  }
  return report;
}
