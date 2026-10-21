"use server";

import { waitUntil } from "@vercel/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/admin";
import { getOpportunityType, isOpportunityTypeId, OPPORTUNITY_STATUSES } from "@/lib/core";
import { grantAdjustment } from "@/lib/credits";
import { db } from "@/lib/db";
import { contactMessages, errorGroups, opportunities, sources } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { cancel, enqueue, retryNow } from "@/lib/jobs/queue";
import { runJobNow } from "@/lib/jobs/runner";
import type { NoticeKey } from "./_lib/notice";

/*
 * Operator levers of the admin area. Every action re-checks the admin session, validates its
 * input with zod, is idempotent (a double submit finds the row already in the target state),
 * and redirects back to the page it came from — filters kept — with a notice. Credits move only
 * through src/lib/credits.ts (grantAdjustment); jobs only through src/lib/jobs/queue.ts.
 */

const ADMIN_PATH = /^\/admin(?:\/[A-Za-z0-9_-]+)*$/;
const SAFE_QUERY = /^[A-Za-z0-9_=&%.:\-+]*$/;

function back(formData: FormData, notice: NoticeKey, extra: Record<string, string> = {}): never {
  const locale = formData.get("locale") === "zh" ? "zh" : "en";
  const rawPath = String(formData.get("path") ?? "/admin");
  const path = ADMIN_PATH.test(rawPath) ? rawPath : "/admin";
  const rawBack = String(formData.get("back") ?? "");
  const q = new URLSearchParams(SAFE_QUERY.test(rawBack) ? rawBack : "");
  q.delete("notice");
  q.delete("n");
  q.delete("r");
  q.set("notice", notice);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  redirect({ href: `${path}?${q.toString()}`, locale });
  // next-intl's redirect throws NEXT_REDIRECT; this line only satisfies the `never` return type.
  throw new Error("redirect did not interrupt the action");
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

const JobId = z.string().regex(/^job_[0-9a-z]{8,32}$/);
const SourceId = z.string().regex(/^src_[0-9a-z]{8,32}$/);
const OppId = z.string().regex(/^opp_[0-9a-z]{8,32}$/);
const ErrId = z.string().regex(/^err_[0-9a-z]{8,32}$/);
const MessageId = z.string().regex(/^cm_[0-9a-z]{8,32}$/);
const UserId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

function kick(jobId: string): void {
  try {
    waitUntil(runJobNow(jobId, { maxMs: 60_000 }));
  } catch (err) {
    // Outside a request context the minute cron runs it; nothing is lost.
    console.warn("[admin] inline kick unavailable", err);
  }
}

/* ------------------------------------------------------------------ jobs */

export async function retryJobAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = JobId.safeParse(field(formData, "id"));
  if (!id.success) back(formData, "invalid");
  const ok = await retryNow(id.data);
  if (!ok) back(formData, "jobRetryRefused");
  kick(id.data);
  back(formData, "jobRetried");
}

export async function cancelJobAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = JobId.safeParse(field(formData, "id"));
  if (!id.success) back(formData, "invalid");
  const ok = await cancel(id.data);
  back(formData, ok ? "jobCancelled" : "jobCancelRefused");
}

/* ------------------------------------------------------------------ sources */

export async function runSourceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = SourceId.safeParse(field(formData, "id"));
  if (!id.success) back(formData, "invalid");
  const found = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, id.data)).limit(1);
  if (!found[0]) back(formData, "notFound");
  // One manual run per source per 5 minutes, whatever the number of presses (payload: src/lib/sources/jobs.ts).
  const bucket = Math.floor(Date.now() / 300_000);
  const job = await enqueue("sources.run", { sourceIds: [id.data] }, { dedupeKey: `sources.run:${id.data}:manual:${bucket}` });
  if (!job.created) back(formData, "sourceAlreadyQueued");
  kick(job.id);
  back(formData, "sourceQueued");
}

/** "Refresh all boards now": one full pass (it continues across invocations), at most once per hour. */
export async function runAllSourcesAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const hour = new Date().toISOString().slice(0, 13);
  const job = await enqueue("sources.run", { full: true }, { dedupeKey: `sources.run:full:${hour}` });
  if (!job.created) back(formData, "sourceAlreadyQueued");
  kick(job.id);
  back(formData, "sourceQueued");
}

/* ------------------------------------------------------------------ opportunities */

export async function reviewOpportunityAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = OppId.safeParse(field(formData, "id"));
  const decision = z.enum(["approve", "reject", "expire"]).safeParse(field(formData, "decision"));
  if (!id.success || !decision.success) back(formData, "invalid");
  const rows = await db.select({ type: opportunities.type }).from(opportunities).where(eq(opportunities.id, id.data)).limit(1);
  const opp = rows[0];
  if (!opp) back(formData, "notFound");
  if (decision.data === "approve") {
    const publicSeo = isOpportunityTypeId(opp.type) ? getOpportunityType(opp.type).publicSeo : false;
    await db
      .update(opportunities)
      .set({ status: "active", public: publicSeo, verifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(opportunities.id, id.data));
    back(formData, "approved");
  }
  if (decision.data === "reject") {
    await db.update(opportunities).set({ status: "rejected", public: false, updatedAt: sql`now()` }).where(eq(opportunities.id, id.data));
    back(formData, "rejected");
  }
  await db.update(opportunities).set({ status: "expired", updatedAt: sql`now()` }).where(eq(opportunities.id, id.data));
  back(formData, "expired");
}

const OpportunityForm = z.object({
  id: OppId,
  name: z.string().trim().min(2).max(300),
  orgName: z.string().trim().max(200),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2000)]),
  summary: z.string().trim().max(2000),
  type: z.string().refine((v) => isOpportunityTypeId(v), "unknown type"),
  deadline: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  rolling: z.boolean(),
  status: z.enum(OPPORTUNITY_STATUSES),
  public: z.boolean(),
});

export async function updateOpportunityAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = OpportunityForm.safeParse({
    id: field(formData, "id"),
    name: field(formData, "name"),
    orgName: field(formData, "orgName"),
    url: field(formData, "url"),
    summary: field(formData, "summary"),
    type: field(formData, "type"),
    deadline: field(formData, "deadline"),
    rolling: formData.get("rolling") === "on",
    status: field(formData, "status"),
    public: formData.get("public") === "on",
  });
  if (!parsed.success) back(formData, "invalid");
  const f = parsed.data;
  const type = f.type as Parameters<typeof getOpportunityType>[0];
  // A deadline is a calendar day: stored as its last second in UTC.
  const deadline = f.deadline ? new Date(`${f.deadline}T23:59:59Z`) : null;
  if (deadline && Number.isNaN(deadline.getTime())) back(formData, "invalid");
  const rows = await db
    .update(opportunities)
    .set({
      name: f.name,
      orgName: f.orgName || null,
      url: f.url || null,
      summary: f.summary || null,
      type,
      deadline,
      rolling: f.rolling,
      status: f.status,
      public: f.public && getOpportunityType(type).publicSeo && f.status === "active",
      updatedAt: sql`now()`,
    })
    .where(eq(opportunities.id, f.id))
    .returning({ id: opportunities.id });
  back(formData, rows[0] ? "saved" : "notFound");
}

/* ------------------------------------------------------------------ credits */

export async function grantCreditsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ userId: UserId, amount: z.coerce.number().int().min(1).max(500), key: z.string().regex(/^[A-Za-z0-9-]{3,60}$/) })
    .safeParse({ userId: field(formData, "userId"), amount: field(formData, "amount"), key: field(formData, "key") });
  if (!parsed.success) back(formData, "invalid");
  let created = false;
  try {
    ({ created } = await grantAdjustment({ userId: parsed.data.userId, amount: parsed.data.amount, key: parsed.data.key }));
  } catch (err) {
    await captureError(err, { route: "/admin/users#grant", severity: "warn", context: { userId: parsed.data.userId, admin: admin.email } });
    back(formData, "creditsFailed", { r: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
  }
  back(formData, created ? "creditsGranted" : "creditsExisting", { n: String(parsed.data.amount) });
}

/* ------------------------------------------------------------------ errors */

export async function setErrorResolvedAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = ErrId.safeParse(field(formData, "id"));
  const resolve = field(formData, "resolve") === "1";
  if (!id.success) back(formData, "invalid");
  await db
    .update(errorGroups)
    .set({ resolvedAt: resolve ? sql`now()` : null })
    .where(eq(errorGroups.id, id.data));
  back(formData, resolve ? "resolved" : "reopened");
}

export async function resolveAllErrorsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await db.update(errorGroups).set({ resolvedAt: sql`now()` }).where(isNull(errorGroups.resolvedAt));
  back(formData, "allResolved");
}

/* ------------------------------------------------------------------ contact messages */

export async function setMessageStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = MessageId.safeParse(field(formData, "id"));
  const status = z.enum(["new", "replied", "archived"]).safeParse(field(formData, "status"));
  if (!id.success || !status.success) back(formData, "invalid");
  await db.update(contactMessages).set({ status: status.data }).where(and(eq(contactMessages.id, id.data)));
  back(formData, "messageUpdated");
}
