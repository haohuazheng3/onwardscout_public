import "server-only";
import { getChannel, type ChannelId as ChannelImplId } from "@/lib/channels";
import type { JsonObject } from "@/lib/core/types";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { getOpportunity } from "@/lib/opportunities";
import { addStep, appError, ApplicationError, execute, finishStep, firstFollowUpAt, isFirstSubmission, latestHandoff, latestPrepared, loadApplication, requireApplication, type ExecuteResult } from "./engine";
import { planConfirm, planHandoffDone, planSubmitResult } from "./plan";
import type { SubmitResultLike } from "./types";

/*
 * Confirm & submit (plan §7.1 step 5, honesty rule 2): the person's explicit tap (or a standing
 * authorization) → reserve the credit (practice is free) → `submitting` → job
 * `application.submit` → channel.submit →
 *   submitted  → settle, evidence, follow-ups scheduled, `unlock` on the first one;
 *   needs_you  → the handoff package is stored, the credit stays reserved until "I submitted it";
 *   failed     → transient: retried twice by the queue; then rolled back to `ready`, credit released.
 */

const MAX_SUBMIT_ATTEMPTS = 3;

export async function confirmApplication(userId: string, applicationId: string): Promise<ExecuteResult> {
  const app = await requireApplication(applicationId, userId);
  const plan = planConfirm(app, { explicit: true });
  if (!plan.ok) throw appError(plan.error);
  const step = await addStep(app.id, "confirm", { by: "user" });
  try {
    const res = await execute(app, plan.effects);
    await finishStep(step.id, "done", { cost: app.practice ? 0 : 1 });
    return res;
  } catch (err) {
    await finishStep(step.id, "failed", {}, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function submitJob(job: JobContext): Promise<JobResult> {
  const applicationId = String(job.payload.applicationId ?? "");
  const app = await loadApplication(applicationId);
  if (!app || app.status !== "submitting") return { status: "done", result: { skipped: app?.status ?? "missing" } };
  const opp = await getOpportunity(app.opportunityId);
  const prepared = await latestPrepared(app.id);
  const step = await addStep(app.id, "submit", { channel: app.channel, attempt: job.attempt });

  let result: SubmitResultLike;
  if (!opp || !prepared) {
    result = { status: "failed", error: !opp ? "The opportunity is no longer available." : "The prepared application is missing; prepare it again.", retryable: false };
  } else {
    try {
      const channel = getChannel(app.channel as ChannelImplId);
      result = await channel.submit({ userId: app.userId, application: app, opportunity: opp, prepared });
    } catch (err) {
      result = { status: "failed", error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }

  if (result.status === "failed" && result.retryable && job.attempt < MAX_SUBMIT_ATTEMPTS) {
    await finishStep(step.id, "failed", { retrying: true }, result.error);
    return { status: "retry", error: result.error, delayMs: 45_000 };
  }

  await finishStep(
    step.id,
    result.status === "failed" ? "failed" : "done",
    { status: result.status, ...(result.status === "needs_you" ? { reason: result.reason } : {}), ...(result.status === "submitted" ? { evidence: result.evidence as JsonObject } : {}) },
    result.status === "failed" ? result.error : null,
  );

  const plan = planSubmitResult(app, result, {
    firstSubmission: await isFirstSubmission(app),
    followUpAt: await firstFollowUpAt(app, opp?.type ?? null),
    now: new Date(),
    preparedHandoff: prepared?.handoff ?? null,
  });
  if (!plan.ok) return { status: "done", result: { skipped: plan.error } };
  try {
    await execute(app, plan.effects);
  } catch (err) {
    if (err instanceof ApplicationError && err.code === "conflict") return { status: "done", result: { skipped: "moved" } };
    throw err;
  }
  return { status: "done", result: { status: result.status } };
}

/** "I submitted it" on a handoff (CH6, or any channel that handed over). Settles the credit. */
export async function completeHandoff(userId: string, applicationId: string, input: { url?: string | null; reference?: string | null; screenshotKey?: string | null; note?: string | null }): Promise<ExecuteResult> {
  const app = await requireApplication(applicationId, userId);
  const opp = await getOpportunity(app.opportunityId);
  const plan = planHandoffDone(app, input, { firstSubmission: await isFirstSubmission(app), followUpAt: await firstFollowUpAt(app, opp?.type ?? null), now: new Date() });
  if (!plan.ok) throw appError(plan.error);
  const step = await addStep(app.id, "handoff", { completed: true }, "running");
  const res = await execute(app, plan.effects);
  await finishStep(step.id, "done", { completed: true, url: input.url ?? null, reference: input.reference ?? null, handoff: ((await latestHandoff(app.id)) ?? null) as unknown as JsonObject });
  return res;
}
