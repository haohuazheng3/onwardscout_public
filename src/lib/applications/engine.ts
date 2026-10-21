import "server-only";
import { and, count, desc, eq, isNotNull, max, ne, sql } from "drizzle-orm";
import { assertTransition, type Actor } from "@/lib/core/state-machine";
import { familyOfSubGoal, nextFollowUpAt, subGoalsForOpportunityType, isOpportunityTypeId, type GoalFamily } from "@/lib/core";
import type { ApplicationStatus, ApplicationStepKind, JsonObject, StepStatus } from "@/lib/core/types";
import { releaseApplication, reserveForApplication, settleApplication, type ReserveResult } from "@/lib/credits";
import { db } from "@/lib/db";
import { applicationSteps, applications, events, goals, milestones, type ApplicationRow, type NewApplicationRow } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { enqueueAndRun } from "@/lib/jobs/runner";
import { notify, recordEvent } from "@/lib/notifications";
import { getUserLocale } from "@/lib/user";
import { notificationFor } from "./copy";
import type { Effect } from "./plan";
import type { HandoffPackage, PreparedPackage } from "./types";

/*
 * The application engine: every status change goes through core/state-machine.ts
 * (`assertTransition`) and a conditional UPDATE … WHERE status = <from>, so two workers can never
 * both move an application. Each step is logged in application_steps (the room's timeline),
 * every change is an event (recordEvent) and the person hears about what matters (notify).
 * Credits move only through src/lib/credits.ts.
 */

export type ApplicationErrorCode = "not_found" | "conflict" | "insufficient_credits" | "not_ready" | "needs_confirmation" | "invalid_transition" | "not_submitted" | "busy" | "already_submitted" | "no_followup" | "invalid_answer";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly status = 409,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

const HUMAN: Record<ApplicationErrorCode, string> = {
  not_found: "We couldn't find that application.",
  conflict: "This application just changed. Reload to see where it is now.",
  insufficient_credits: "You need 1 credit to submit this application.",
  not_ready: "This application isn't ready for that step yet.",
  needs_confirmation: "Nothing is submitted without your confirmation.",
  invalid_transition: "That step isn't possible from where this application is now.",
  not_submitted: "Record an outcome once the application has been submitted.",
  busy: "We're submitting this right now. Give it a moment.",
  already_submitted: "This application was already submitted.",
  no_followup: "There is no follow-up waiting for this application.",
  invalid_answer: "That answer doesn't fit this question.",
};

export function appError(code: ApplicationErrorCode, status = 409, extra: Record<string, unknown> = {}): ApplicationError {
  return new ApplicationError(code, HUMAN[code], status, extra);
}

/* ------------------------------------------------------------------ loading */

export async function loadApplication(id: string, userId?: string | null): Promise<ApplicationRow | null> {
  const rows = await db
    .select()
    .from(applications)
    .where(userId ? and(eq(applications.id, id), eq(applications.userId, userId)) : eq(applications.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function requireApplication(id: string, userId: string): Promise<ApplicationRow> {
  const app = await loadApplication(id, userId);
  if (!app) throw appError("not_found", 404);
  return app;
}

/** Never let logging break the person's flow. */
async function safe(label: string, fn: () => Promise<unknown>, context: Record<string, unknown> = {}): Promise<void> {
  try {
    await fn();
  } catch (err) {
    await captureError(err, { route: `applications/${label}`, severity: "warn", context });
  }
}

/* ------------------------------------------------------------------ steps */

export async function addStep(applicationId: string, kind: ApplicationStepKind, input: JsonObject = {}, status: StepStatus = "running"): Promise<{ id: string; n: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const top = await db.select({ n: max(applicationSteps.n) }).from(applicationSteps).where(eq(applicationSteps.applicationId, applicationId));
    const n = (top[0]?.n ?? 0) + 1;
    const id = newId("stp");
    const rows = await db
      .insert(applicationSteps)
      .values({ id, applicationId, n, kind, status, input, startedAt: new Date(), finishedAt: status === "running" || status === "pending" ? null : new Date() })
      .onConflictDoNothing({ target: [applicationSteps.applicationId, applicationSteps.n] })
      .returning({ id: applicationSteps.id, n: applicationSteps.n });
    if (rows[0]) return rows[0];
  }
  throw new Error(`addStep: could not allocate a step number for ${applicationId}`);
}

export async function finishStep(stepId: string, status: StepStatus, output: JsonObject = {}, error?: string | null): Promise<void> {
  await db
    .update(applicationSteps)
    .set({ status, output, error: error ? error.slice(0, 1000) : null, finishedAt: new Date() })
    .where(eq(applicationSteps.id, stepId));
}

/** The newest step of a kind that finished (e.g. the prepared package in `preview`). */
export async function latestStepOutput<T>(applicationId: string, kind: ApplicationStepKind): Promise<T | null> {
  const rows = await db
    .select({ output: applicationSteps.output })
    .from(applicationSteps)
    .where(and(eq(applicationSteps.applicationId, applicationId), eq(applicationSteps.kind, kind), eq(applicationSteps.status, "done")))
    .orderBy(desc(applicationSteps.n))
    .limit(1);
  return (rows[0]?.output as T | undefined) ?? null;
}

export async function latestPrepared(applicationId: string): Promise<PreparedPackage | null> {
  const out = await latestStepOutput<{ prepared?: PreparedPackage }>(applicationId, "preview");
  return out?.prepared ?? null;
}

export async function latestHandoff(applicationId: string): Promise<HandoffPackage | null> {
  const out = await latestStepOutput<{ handoff?: HandoffPackage }>(applicationId, "handoff");
  return out?.handoff ?? null;
}

/* ------------------------------------------------------------------ transitions */

/**
 * Moves an application through the state machine. Throws ApplicationError("conflict") when the
 * row moved meanwhile (the conditional UPDATE matched nothing).
 */
export async function transition(app: ApplicationRow, to: ApplicationStatus, actor: Actor, opts: { needsYouReason?: string | null; patch?: Partial<NewApplicationRow> } = {}): Promise<ApplicationRow> {
  assertTransition(app.status, to, actor, { submitted: Boolean(app.submittedAt) });
  const rows = await db
    .update(applications)
    .set({
      ...(opts.patch ?? {}),
      status: to,
      needsYouReason: to === "needs_you" ? (opts.needsYouReason ?? app.needsYouReason ?? null) : null,
      ...(to === "submitted" && !app.submittedAt ? { submittedAt: new Date() } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(applications.id, app.id), eq(applications.status, app.status)))
    .returning();
  const next = rows[0];
  if (!next) throw appError("conflict");
  await safe("event", () => recordEvent({ userId: app.userId, kind: "application.status", applicationId: app.id, opportunityId: app.opportunityId, data: { from: app.status, to, actor } }));
  return next;
}

/** Writes non-status columns (answers, questions, evidence…) for the owner. */
export async function patchApplication(app: ApplicationRow, patch: Partial<NewApplicationRow>): Promise<ApplicationRow> {
  const rows = await db
    .update(applications)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(applications.id, app.id), eq(applications.userId, app.userId)))
    .returning();
  return rows[0] ?? app;
}

/* ------------------------------------------------------------------ helpers the effects need */

export async function opportunityTarget(app: Pick<ApplicationRow, "opportunityId">): Promise<string> {
  const { getOpportunity } = await import("@/lib/opportunities");
  const opp = await getOpportunity(app.opportunityId);
  return opp?.orgName && !opp.name.includes(opp.orgName) ? `${opp.name} · ${opp.orgName}` : (opp?.name ?? "your application");
}

/** The playbook family that drives follow-ups: the goal's, else the opportunity type's first sub-goal, else G1. */
export async function familyFor(app: Pick<ApplicationRow, "goalId" | "userId">, oppType?: string | null): Promise<GoalFamily> {
  if (app.goalId) {
    const g = await db.select({ family: goals.family }).from(goals).where(and(eq(goals.id, app.goalId), eq(goals.userId, app.userId))).limit(1);
    if (g[0]) return g[0].family;
  }
  if (oppType && isOpportunityTypeId(oppType)) {
    const sub = subGoalsForOpportunityType(oppType)[0];
    if (sub) return familyOfSubGoal(sub.id);
  }
  return "G1";
}

export async function firstFollowUpAt(app: Pick<ApplicationRow, "goalId" | "userId" | "practice">, oppType: string | null, now = new Date()): Promise<Date | null> {
  if (app.practice) return null;
  return nextFollowUpAt(await familyFor(app, oppType), now, 0);
}

/** No other submitted (non-practice) application yet. */
export async function isFirstSubmission(app: Pick<ApplicationRow, "id" | "userId">): Promise<boolean> {
  const rows = await db
    .select({ n: count() })
    .from(applications)
    .where(and(eq(applications.userId, app.userId), eq(applications.practice, false), isNotNull(applications.submittedAt), ne(applications.id, app.id)));
  return (rows[0]?.n ?? 0) === 0;
}

/** Advances the goal's open milestones of a metric, once per application. */
async function bumpMilestone(app: ApplicationRow, metric: string): Promise<void> {
  if (!app.goalId) return;
  const marker = `milestone.${metric}`;
  const seen = await db.select({ id: events.id }).from(events).where(and(eq(events.applicationId, app.id), eq(events.kind, marker))).limit(1);
  if (seen[0]) return;
  await recordEvent({ userId: app.userId, kind: marker, applicationId: app.id, opportunityId: app.opportunityId, data: { goalId: app.goalId } });
  await db
    .update(milestones)
    .set({
      current: sql`${milestones.current} + 1`,
      status: sql`case when ${milestones.current} + 1 >= ${milestones.target} then 'done' else ${milestones.status} end`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(milestones.userId, app.userId), eq(milestones.goalId, app.goalId), eq(milestones.metric, metric as never), eq(milestones.status, "open")));
}

/* ------------------------------------------------------------------ executing a plan */

export interface ExecuteResult {
  app: ApplicationRow;
  unlock: boolean;
  reserve?: ReserveResult;
}

/**
 * Runs a plan's effects in order. A failed reservation stops before anything else moves
 * (ApplicationError "insufficient_credits", 402). Credit settlement after a submission never
 * undoes the submission: a failure there is captured for the reconcile job instead.
 */
export async function execute(start: ApplicationRow, effects: Effect[], opts: { href?: string } = {}): Promise<ExecuteResult> {
  let app = start;
  let unlock = false;
  let reserve: ReserveResult | undefined;
  const href = opts.href ?? `/app/applications/${app.id}`;
  let lang: "en" | "zh" | null = null;
  let target: string | null = null;

  for (const e of effects) {
    switch (e.type) {
      case "reserve": {
        reserve = await reserveForApplication({ userId: app.userId, applicationId: app.id, amount: e.amount });
        if (!reserve.ok) throw appError("insufficient_credits", 402, { available: reserve.available, needed: reserve.needed, reason: reserve.reason });
        app = await patchApplication(app, { creditsReserved: reserve.amount });
        break;
      }
      case "transition":
        app = await transition(app, e.to, e.actor, { needsYouReason: e.needsYouReason });
        break;
      case "settle":
        await safe("settle", () => settleApplication(app.id), { applicationId: app.id });
        break;
      case "release":
        await safe("release", () => releaseApplication(app.id), { applicationId: app.id });
        app = await patchApplication(app, { creditsReserved: 0 });
        break;
      case "enqueue":
        await enqueueAndRun(e.kind, { applicationId: app.id, ...(e.payload ?? {}) }, { userId: app.userId, dedupeKey: `${e.kind}:${app.id}`, onDuplicate: "rearm" });
        break;
      case "evidence":
        app = await patchApplication(app, { evidence: e.evidence, ...(e.evidence.reference ? { externalRef: e.evidence.reference } : {}) });
        break;
      case "handoff": {
        const s = await addStep(app.id, "handoff", { reason: app.needsYouReason ?? null }, "done");
        await finishStep(s.id, "done", { handoff: e.handoff as unknown as JsonObject });
        break;
      }
      case "notify": {
        lang ??= (await getUserLocale(app.userId)) === "zh" ? "zh" : "en";
        target ??= await opportunityTarget(app);
        const n = notificationFor(e.key, target, lang);
        await notify({ userId: app.userId, kind: n.kind, title: n.title, body: n.body, href, email: n.email });
        break;
      }
      case "event":
        await safe("event", () => recordEvent({ userId: app.userId, kind: e.kind, applicationId: app.id, opportunityId: app.opportunityId, data: e.data ?? {} }));
        break;
      case "unlock":
        unlock = true;
        await safe("unlock", () => recordEvent({ userId: app.userId, kind: "application.unlock", applicationId: app.id, opportunityId: app.opportunityId, data: {} }));
        break;
      case "milestone":
        await safe("milestone", () => bumpMilestone(app, e.metric), { applicationId: app.id, metric: e.metric });
        break;
      case "followup":
        app = await patchApplication(app, { followUpAt: e.at, ...(e.sent !== undefined ? { followUpsSent: e.sent } : {}) });
        break;
      case "outcome":
        app = await patchApplication(app, { outcome: e.outcome });
        break;
    }
  }
  return { app, unlock, reserve };
}

/** Enqueues (and kicks inline) the preparation job for an application. */
export async function enqueuePrepare(app: Pick<ApplicationRow, "id" | "userId">, payload: Record<string, string | boolean> = {}): Promise<void> {
  await enqueueAndRun("application.prepare", { applicationId: app.id, ...payload }, { userId: app.userId, dedupeKey: `application.prepare:${app.id}`, onDuplicate: "rearm" });
}

/** Enqueues (and kicks inline) a follow-up run. */
export async function enqueueFollowUp(app: Pick<ApplicationRow, "id" | "userId">, payload: Record<string, string | boolean> = {}): Promise<void> {
  await enqueueAndRun("application.followup", { applicationId: app.id, ...payload }, { userId: app.userId, dedupeKey: `application.followup:${app.id}`, onDuplicate: "rearm" });
}

/** Enqueues (and kicks inline) the submission job again (retry after it gave up). */
export async function enqueueSubmit(app: Pick<ApplicationRow, "id" | "userId">): Promise<void> {
  await enqueueAndRun("application.submit", { applicationId: app.id }, { userId: app.userId, dedupeKey: `application.submit:${app.id}`, onDuplicate: "rearm" });
}
