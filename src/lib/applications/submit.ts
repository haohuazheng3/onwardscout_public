import "server-only";
import { getChannel, outreachPreflight, type ChannelId as ChannelImplId } from "@/lib/channels";
import { isIdentityCode, isMinor } from "@/lib/core";
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

/**
 * Practice is free because it goes to our own sandbox. A row marked practice for anything else
 * (written before the server derived the flag itself) must never submit, settle or hand over free.
 */
export function practiceMismatch(app: { practice: boolean }, opp: { type: string } | null): boolean {
  return app.practice && opp?.type !== "practice";
}

/** A minor (identity S1) without a parent or guardian's email on their profile. */
export async function guardianMissing(userId: string): Promise<boolean> {
  const { getProfile } = await import("@/lib/profile");
  const profile = await getProfile(userId);
  const codes = ((profile?.roles ?? []) as { code?: string }[]).map((r) => r.code).filter((c): c is string => typeof c === "string").filter(isIdentityCode);
  if (!isMinor(codes)) return false;
  const guardian = (profile?.identity as { guardianEmail?: string | null } | null)?.guardianEmail;
  return !guardian?.trim();
}

export async function confirmApplication(userId: string, applicationId: string): Promise<ExecuteResult> {
  const app = await requireApplication(applicationId, userId);
  const opp = await getOpportunity(app.opportunityId);
  if (practiceMismatch(app, opp)) throw appError("invalid_request", 400);
  const plan = planConfirm(app, { explicit: true, guardianRequired: !app.practice && (await guardianMissing(userId)) });
  if (!plan.ok) throw appError(plan.error);
  if (app.channel === "CH4") {
    // Opt-outs, the 30-day rule and the minor rule are explained before the credit is reserved.
    const to = (await latestPrepared(app.id))?.email?.to?.trim();
    if (to) {
      const policy = await outreachPreflight(userId, app.id, to);
      if (!policy.ok) throw appError("outreach_blocked", 409, { reason: policy.code, detail: policy.message, ...(policy.retryAt ? { retryAt: policy.retryAt.toISOString() } : {}) });
    }
  }
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
  const mismatch = practiceMismatch(app, opp);
  if (!opp || !prepared || mismatch) {
    result = {
      status: "failed",
      error: !opp ? "The opportunity is no longer available." : mismatch ? "This practice run points at a real opportunity, so it was not submitted." : "The prepared application is missing; prepare it again.",
      retryable: false,
    };
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
    preparedHandoff: mismatch ? null : (prepared?.handoff ?? null),
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
  if (practiceMismatch(app, opp)) throw appError("invalid_request", 400);
  const plan = planHandoffDone(app, input, { firstSubmission: await isFirstSubmission(app), followUpAt: await firstFollowUpAt(app, opp?.type ?? null), now: new Date() });
  if (!plan.ok) throw appError(plan.error);
  const step = await addStep(app.id, "handoff", { completed: true }, "running");
  const res = await execute(app, plan.effects);
  await finishStep(step.id, "done", { completed: true, url: input.url ?? null, reference: input.reference ?? null, handoff: ((await latestHandoff(app.id)) ?? null) as unknown as JsonObject });
  return res;
}
