import "server-only";
import { and, eq } from "drizzle-orm";
import { channelFor } from "@/lib/channels";
import { isOpportunityTypeId } from "@/lib/core";
import { subGoalsForOpportunityType } from "@/lib/core/goals";
import { db } from "@/lib/db";
import { applications } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { ensurePracticeOpportunity, getDetailForUser, getOpportunity } from "@/lib/opportunities";
import { activeGoals } from "@/lib/profile";
import { recordEvent } from "@/lib/notifications";
import { captureError } from "@/lib/errors";
import { appError, enqueuePrepare, transition } from "./engine";

/*
 * Applications (contracts §6). Entry points other features call: the Apply button (P2a), the
 * home page (P1), the crons and admin (P6). The engine lives in ./engine, ./prepare, ./submit,
 * ./followup and ./actions; read models in ./queries.
 */

export { dueFollowUps } from "./followup";
export { needsYouCount, pipelineSummary, listBoard, applicationView, goalFilters } from "./queries";
export { confirmApplication, completeHandoff } from "./submit";
export { approveFollowUp, skipFollowUp } from "./followup";
export { answerQuestion, editAnswers, editDocument, editEmail, regenerate, recordOutcome, recordReply, withdrawApplication } from "./actions";
export { ApplicationError } from "./engine";
export type { ApplicationView, BoardCard } from "./types";

/** Picks the person's active goal that pursues this opportunity type (for the board's goal filter). */
export function pickGoal(goals: { id: string; family: string; sub: string | null }[], oppType: string): string | null {
  if (!goals.length) return null;
  if (!isOpportunityTypeId(oppType)) return goals[0].id;
  const subs = subGoalsForOpportunityType(oppType);
  const exact = goals.find((g) => g.sub && subs.some((s) => s.id === g.sub));
  if (exact) return exact.id;
  const fam = goals.find((g) => subs.some((s) => s.family === g.family));
  return fam?.id ?? null;
}

/**
 * contracts §6 — "Apply for me". Creates the application (one per person and opportunity;
 * practice runs repeat), then enqueues `application.prepare` and starts it inline. An earlier
 * application that was withdrawn or expired before submission is reopened instead.
 */
export async function startApplication(input: { userId: string; opportunityId: string; goalId?: string; practice?: boolean }): Promise<{ applicationId: string; created: boolean }> {
  const opp = await getOpportunity(input.opportunityId);
  if (!opp) throw appError("not_found", 404);
  // Practice is a property of the opportunity (our own sandbox), never of the request: a client
  // flag on a real opportunity would make a free, repeatable submission to a real organisation.
  const practice = opp.type === "practice";
  if (input.practice === true && !practice) throw appError("invalid_request", 400);
  if (!practice) {
    // Only what the person may see on their board (or what they already applied to: the reopen path).
    const detail = await getDetailForUser(input.userId, opp.id);
    const ownApplication = detail && !detail.visible
      ? (await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, input.userId), eq(applications.opportunityId, opp.id), eq(applications.practice, false))).limit(1))[0]
      : null;
    if (!detail || (!detail.visible && !ownApplication)) throw appError("not_found", 404);
  }
  let goalId = input.goalId ?? null;
  if (!goalId) {
    try {
      goalId = pickGoal(await activeGoals(input.userId), opp.type);
    } catch (err) {
      await captureError(err, { route: "applications/start (goal)", severity: "warn" });
    }
  }
  const id = newId("app");
  const channel = channelFor(opp).id;
  const inserted = await db
    .insert(applications)
    .values({ id, userId: input.userId, goalId, opportunityId: opp.id, channel, status: "draft", practice })
    .onConflictDoNothing()
    .returning({ id: applications.id });

  let applicationId = inserted[0]?.id;
  let created = Boolean(applicationId);
  if (!applicationId) {
    const existing = await db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, input.userId), eq(applications.opportunityId, opp.id), eq(applications.practice, false)))
      .limit(1);
    const app = existing[0];
    if (!app) throw new Error("startApplication: conflict without an existing row");
    applicationId = app.id;
    created = false;
    if ((app.status === "withdrawn" || app.status === "expired") && !app.submittedAt) {
      const reopened = await transition(app, "draft", "user", { patch: { questions: [], ...(goalId && !app.goalId ? { goalId } : {}) } });
      await enqueuePrepare(reopened);
    }
    return { applicationId, created };
  }

  try {
    await recordEvent({ userId: input.userId, kind: "application.requested", applicationId, opportunityId: opp.id, data: { practice, channel } });
  } catch (err) {
    await captureError(err, { route: "applications/start (event)", severity: "warn" });
  }
  await enqueuePrepare({ id: applicationId, userId: input.userId });
  return { applicationId, created };
}

/** contracts §6 — a fresh practice run against the sandbox form (free). */
export async function startPracticeApplication(userId: string): Promise<{ applicationId: string }> {
  const opp = await ensurePracticeOpportunity();
  const r = await startApplication({ userId, opportunityId: opp.id, practice: true });
  return { applicationId: r.applicationId };
}
