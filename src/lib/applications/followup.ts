import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getChannel, type ChannelId as ChannelImplId } from "@/lib/channels";
import { getPlaybook } from "@/lib/core/playbooks";
import type { JsonObject } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications } from "@/lib/db/schema";
import { composeDocumentWith, latestDocuments } from "@/lib/documents";
import { plainText, readContent } from "@/lib/documents/content";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { getOpportunity } from "@/lib/opportunities";
import { autoFollowUpAllowed } from "@/lib/authorizations";
import { addStep, appError, ApplicationError, enqueueFollowUp, execute, familyFor, finishStep, latestPrepared, loadApplication, requireApplication } from "./engine";
import { planFollowUp } from "./plan";

/*
 * Follow-ups per playbook (core/playbooks.ts `followUpDays`). Email applications (CH4) get a
 * follow-up email composed from facts and sent through the channel's `followUp` — automatically
 * only with the standing `auto_followup` authorization, otherwise the person approves it with one
 * tap. Every other channel gets a "check status" nudge to record an outcome. After the last
 * follow-up a quiet period ends the application as "no response".
 */

/** P6's followups cron: applications whose follow-up is due. */
export async function dueFollowUps(limit: number): Promise<{ applicationId: string; userId: string }[]> {
  const rows = await db
    .select({ applicationId: applications.id, userId: applications.userId })
    .from(applications)
    .where(and(inArray(applications.status, ["submitted", "waiting"]), lte(applications.followUpAt, new Date()), eq(applications.practice, false)))
    .orderBy(asc(applications.followUpAt))
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows;
}

async function followUpDraft(app: NonNullable<Awaited<ReturnType<typeof loadApplication>>>) {
  const docs = await latestDocuments(app.userId, app.id);
  const first = docs.find((d) => d.kind === "email" && readContent(d.content).meta.composer !== "email_follow_up");
  const firstContent = first ? readContent(first.content) : null;
  const subjectIdx = firstContent ? firstContent.meta.roles.indexOf("subject") : -1;
  const previousSubject = firstContent && subjectIdx >= 0 ? firstContent.blocks[subjectIdx].text : (first?.title ?? null);
  const { row } = await composeDocumentWith(
    { userId: app.userId, applicationId: app.id, kind: "email", opportunityId: app.opportunityId, language: first?.language ?? "en" },
    { previous: { subject: previousSubject, sentAt: app.submittedAt } },
  );
  const content = readContent(row.content);
  const idx = content.meta.roles.indexOf("subject");
  return { id: row.id, subject: idx >= 0 ? content.blocks[idx].text : row.title, body: plainText({ blocks: content.blocks.filter((_, i) => i !== idx) }) };
}

export async function followUpJob(job: JobContext): Promise<JobResult> {
  const applicationId = String(job.payload.applicationId ?? "");
  const app = await loadApplication(applicationId);
  if (!app) return { status: "done", result: { skipped: "missing" } };
  const opp = await getOpportunity(app.opportunityId);
  const family = await familyFor(app, opp?.type ?? null);
  const channel = (() => {
    try {
      return getChannel(app.channel as ChannelImplId);
    } catch {
      return null;
    }
  })();
  const plan = planFollowUp(app, {
    now: new Date(),
    followUpDays: getPlaybook(family).followUpDays,
    channelFollowUp: app.channel === "CH4" && typeof channel?.followUp === "function",
    authorized: await autoFollowUpAllowed(app.userId),
    approved: job.payload.approved === true,
  });

  try {
    switch (plan.action) {
      case "none":
        return { status: "done", result: { skipped: "not_due" } };
      case "close":
      case "nudge":
        await execute(app, plan.effects);
        return { status: "done", result: { action: plan.action } };
      case "ask": {
        // Draft first, so the person reads exactly what would be sent.
        const draft = await followUpDraft(app);
        const s = await addStep(app.id, "followup", { approval: true }, "running");
        await finishStep(s.id, "done", { draftId: draft.id, awaitingApproval: true });
        await execute(app, plan.effects);
        return { status: "done", result: { action: "ask" } };
      }
      case "send": {
        if (!opp || !channel?.followUp) return { status: "done", result: { skipped: "no_channel" } };
        const moved = plan.before.length ? (await execute(app, plan.before)).app : app;
        const prepared = await latestPrepared(app.id);
        if (!prepared) return { status: "done", result: { skipped: "no_prepared" } };
        const docs = await latestDocuments(app.userId, app.id);
        const existing = docs.find((d) => d.kind === "email" && readContent(d.content).meta.composer === "email_follow_up");
        const draft = existing && job.payload.approved === true ? (() => {
          const c = readContent(existing.content);
          const i = c.meta.roles.indexOf("subject");
          return { id: existing.id, subject: i >= 0 ? c.blocks[i].text : existing.title, body: plainText({ blocks: c.blocks.filter((_, k) => k !== i) }) };
        })() : await followUpDraft(moved);
        const step = await addStep(app.id, "followup", { attempt: (app.followUpsSent ?? 0) + 1, draftId: draft.id });
        const result = await channel.followUp({
          userId: app.userId,
          application: moved,
          opportunity: opp,
          prepared: { ...prepared, email: { to: prepared.email?.to ?? opp.apply.email ?? "", subject: draft.subject, body: draft.body } },
          attempt: (app.followUpsSent ?? 0) + 1,
        });
        if (result.status === "submitted") {
          await finishStep(step.id, "done", { evidence: result.evidence as JsonObject });
          await execute(moved, plan.afterSent);
          return { status: "done", result: { action: "sent" } };
        }
        if (result.status === "failed" && result.retryable && job.attempt < 3) {
          await finishStep(step.id, "failed", { retrying: true }, result.error);
          return { status: "retry", error: result.error, delayMs: 10 * 60_000 };
        }
        await finishStep(step.id, "failed", { status: result.status }, result.status === "failed" ? result.error : result.reason);
        if (moved.status === "waiting") await execute(moved, [{ type: "transition", to: "needs_you", actor: "system", needsYouReason: "followup_approval" }, { type: "notify", key: "followup_ready" }]);
        return { status: "done", result: { action: "handed_over" } };
      }
    }
  } catch (err) {
    if (err instanceof ApplicationError && err.code === "conflict") return { status: "done", result: { skipped: "moved" } };
    throw err;
  }
}

/** The person approved the drafted follow-up from the room. */
export async function approveFollowUp(userId: string, applicationId: string): Promise<void> {
  const app = await requireApplication(applicationId, userId);
  if (app.status !== "needs_you" || app.needsYouReason !== "followup_approval") throw appError("no_followup");
  await enqueueFollowUp(app, { approved: true });
}

/** The person skipped the follow-up: back to waiting, next nudge per playbook. */
export async function skipFollowUp(userId: string, applicationId: string): Promise<void> {
  const app = await requireApplication(applicationId, userId);
  if (app.status !== "needs_you" || app.needsYouReason !== "followup_approval") throw appError("no_followup");
  const opp = await getOpportunity(app.opportunityId);
  const days = getPlaybook(await familyFor(app, opp?.type ?? null)).followUpDays;
  const sent = (app.followUpsSent ?? 0) + 1;
  const gap = sent < days.length ? days[sent] - days[sent - 1] : 14;
  await execute(app, [
    { type: "transition", to: "waiting", actor: "user" },
    { type: "followup", at: new Date(Date.now() + gap * 24 * 3600 * 1000), sent },
    { type: "event", kind: "application.followup_skipped", data: { n: sent } },
  ]);
}
