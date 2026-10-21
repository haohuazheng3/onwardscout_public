import "server-only";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { NEEDS_USER_STATUSES } from "@/lib/core";
import { db } from "@/lib/db";
import { applications, goals, matches, messages, milestones, opportunities, users } from "@/lib/db/schema";
import type { Locale } from "@/i18n/routing";
import type { JobModule } from "@/lib/jobs/handlers";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { weeklyDigestEnabled } from "./authorizations";
import { createNotification, translatorFor } from "./notifications";

/*
 * The weekly brief (P6): every Monday each eligible person gets one notification of kind
 * `digest` linking to /app — new top picks, how their applications moved, what is waiting
 * for their tap, and milestone progress. Written from templates (no model call), in the
 * person's language. Emailed through the notify.email job when product email is configured,
 * the person allows it and their plan includes the emailed brief (Pro).
 *
 * /api/cron/digest enqueues one `digest.send` job per eligible person with the dedupe key
 * `digest.send:<userId>:<ISO week>`, so a person gets at most one brief per week however
 * often the cron fires.
 */

/* ------------------------------------------------------------------ weeks */

export interface IsoWeek {
  year: number;
  week: number;
  /** "2026-W43". */
  key: string;
}

/** ISO-8601 week of a date, in UTC (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: Date): IsoWeek {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon = 1 … Sun = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year, week, key: `${year}-W${String(week).padStart(2, "0")}` };
}

/** Monday 00:00 UTC of the ISO week that contains `date`. */
export function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** The period a brief sent at `now` covers: the 7 days before it. */
export function digestWindow(now: Date, days = 7): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

export function digestDedupeKey(userId: string, now: Date): string {
  return `digest.send:${userId}:${isoWeek(now).key}`;
}

/* ------------------------------------------------------------------ content selection (pure) */

export interface DigestMatchCandidate {
  opportunityId: string;
  name: string;
  orgName: string | null;
  deadline: Date | null;
  fit: number;
  feedback: string | null;
  status: string;
}

export interface DigestNeedsYou {
  applicationId: string;
  name: string;
  status: string;
}

export interface DigestMilestone {
  title: string;
  current: number;
  target: number;
  dueAt: Date | null;
}

export interface DigestData {
  now: Date;
  /** Matches created in the window, any order. */
  matches: DigestMatchCandidate[];
  /** Applications waiting for the person (needs_info, needs_you, ready), newest first. */
  needsYou: DigestNeedsYou[];
  submittedThisWeek: number;
  replies: number;
  movedForward: number;
  /** Open milestones of active goals. */
  milestones: DigestMilestone[];
}

export interface DigestContent {
  /** False when there is nothing new to say (no brief is sent then). */
  send: boolean;
  newMatchCount: number;
  topMatches: DigestMatchCandidate[];
  needsYouCount: number;
  needsYou: DigestNeedsYou[];
  submittedThisWeek: number;
  replies: number;
  movedForward: number;
  milestones: DigestMilestone[];
}

export const DIGEST_TOP = 3;

/**
 * What goes in the brief. New picks: still open (active, deadline not passed), not dismissed,
 * best fit first and the nearer deadline breaking ties. Waiting items: the newest three.
 * Milestones: the three due soonest. A brief is sent only when something actually happened
 * or is waiting — milestones alone are not news.
 */
export function selectDigestContent(data: DigestData): DigestContent {
  const now = data.now.getTime();
  const open = data.matches.filter(
    (m) => m.status === "active" && m.feedback !== "not_interested" && (m.deadline === null || m.deadline.getTime() > now),
  );
  const seen = new Set<string>();
  const unique = open.filter((m) => (seen.has(m.opportunityId) ? false : (seen.add(m.opportunityId), true)));
  const topMatches = [...unique]
    .sort((a, b) => b.fit - a.fit || (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity) || a.name.localeCompare(b.name))
    .slice(0, DIGEST_TOP);
  const milestones = [...data.milestones]
    .filter((m) => m.target > 0)
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.title.localeCompare(b.title))
    .slice(0, DIGEST_TOP);
  const send = unique.length > 0 || data.needsYou.length > 0 || data.submittedThisWeek > 0 || data.replies > 0 || data.movedForward > 0;
  return {
    send,
    newMatchCount: unique.length,
    topMatches,
    needsYouCount: data.needsYou.length,
    needsYou: data.needsYou.slice(0, DIGEST_TOP),
    submittedThisWeek: data.submittedThisWeek,
    replies: data.replies,
    movedForward: data.movedForward,
    milestones,
  };
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** Title and plain-text body of the brief (pure; `t` is the `settings.digest` translator). */
export function renderDigest(content: DigestContent, t: T): { title: string; body: string } {
  const parts: string[] = [];
  if (content.newMatchCount) parts.push(t("parts.picks", { count: content.newMatchCount }));
  if (content.needsYouCount) parts.push(t("parts.needsYou", { count: content.needsYouCount }));
  if (content.submittedThisWeek) parts.push(t("parts.submitted", { count: content.submittedThisWeek }));
  if (content.replies) parts.push(t("parts.replies", { count: content.replies }));
  const sep = t("separator");
  const title = parts.length ? t("title", { parts: parts.join(sep) }) : t("titleQuiet");

  const lines: string[] = [];
  if (content.topMatches.length) {
    const names = content.topMatches.map((m) => (m.orgName && m.orgName !== m.name ? t("matchWithOrg", { name: m.name, org: m.orgName }) : m.name));
    const more = content.newMatchCount - content.topMatches.length;
    lines.push(t("picksLine", { list: names.join(sep) }) + (more > 0 ? t("andMore", { count: more }) : ""));
  }
  if (content.needsYou.length) {
    const more = content.needsYouCount - content.needsYou.length;
    lines.push(t("needsYouLine", { list: content.needsYou.map((n) => n.name).join(sep) }) + (more > 0 ? t("andMore", { count: more }) : ""));
  }
  if (content.submittedThisWeek || content.replies || content.movedForward) {
    lines.push(t("pipelineLine", { submitted: content.submittedThisWeek, replies: content.replies, moved: content.movedForward }));
  }
  for (const m of content.milestones) lines.push(t("milestoneLine", { title: m.title, current: Math.min(m.current, m.target), target: m.target }));
  if (!lines.length) lines.push(t("quietLine"));
  lines.push(t("cta"));
  return { title, body: lines.join("\n") };
}

/* ------------------------------------------------------------------ data */

export async function buildDigestData(userId: string, now = new Date()): Promise<DigestData> {
  const { from } = digestWindow(now);
  const [matchRows, needsRows, submitted, replies, moved, milestoneRows] = await Promise.all([
    db
      .select({
        opportunityId: matches.opportunityId,
        fit: matches.fit,
        feedback: matches.feedback,
        name: opportunities.name,
        orgName: opportunities.orgName,
        deadline: opportunities.deadline,
        status: opportunities.status,
      })
      .from(matches)
      .innerJoin(opportunities, eq(opportunities.id, matches.opportunityId))
      .where(and(eq(matches.userId, userId), gte(matches.createdAt, from)))
      .orderBy(desc(matches.fit))
      .limit(200),
    db
      .select({ applicationId: applications.id, status: applications.status, name: opportunities.name })
      .from(applications)
      .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .where(and(eq(applications.userId, userId), inArray(applications.status, [...NEEDS_USER_STATUSES])))
      .orderBy(desc(applications.updatedAt))
      .limit(50),
    db
      .select({ n: count() })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.practice, false), gte(applications.submittedAt, from))),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.direction, "in"), gte(messages.createdAt, from))),
    db
      .select({ n: count() })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "progress"), gte(applications.updatedAt, from))),
    db
      .select({ title: milestones.title, current: milestones.current, target: milestones.target, dueAt: milestones.dueAt })
      .from(milestones)
      .innerJoin(goals, eq(goals.id, milestones.goalId))
      .where(and(eq(milestones.userId, userId), eq(milestones.status, "open"), eq(goals.status, "active")))
      .orderBy(sql`${milestones.dueAt} asc nulls last`, asc(milestones.position))
      .limit(10),
  ]);
  return {
    now,
    matches: matchRows.map((m) => ({ ...m, deadline: m.deadline ? new Date(m.deadline) : null })),
    needsYou: needsRows,
    submittedThisWeek: Number(submitted[0]?.n ?? 0),
    replies: Number(replies[0]?.n ?? 0),
    movedForward: Number(moved[0]?.n ?? 0),
    milestones: milestoneRows.map((m) => ({ ...m, dueAt: m.dueAt ? new Date(m.dueAt) : null })),
  };
}

/**
 * Users who get a brief this week: onboarded (at least one goal), seen in the last 120 days,
 * and the weekly brief not switched off (same rule as `deriveAuthorizationState`). Paged by id.
 */
export async function digestCandidates(afterId: string | null, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        afterId ? sql`${users.id} > ${afterId}` : undefined,
        sql`${users.lastSeenAt} > now() - interval '120 days'`,
        sql`exists (select 1 from goals g where g.user_id = ${users.id})`,
        sql`(exists (select 1 from authorizations a where a.user_id = ${users.id} and a.scope = 'weekly_digest' and a.revoked_at is null)
             or not exists (select 1 from authorizations a where a.user_id = ${users.id} and a.scope = 'weekly_digest'))`,
      ),
    )
    .orderBy(asc(users.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ the digest.send job */

export interface DigestOutcome {
  sent: boolean;
  reason?: "no user" | "switched off" | "nothing new";
  notificationId?: string | null;
  title?: string;
}

/**
 * Builds and stores one person's brief. `force` (admin drill) sends even when the switch is
 * off or nothing happened, so the whole path can be checked on demand.
 */
export async function sendDigest(userId: string, opts: { now?: Date; force?: boolean } = {}): Promise<DigestOutcome> {
  const now = opts.now ?? new Date();
  const found = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  if (!found[0]) return { sent: false, reason: "no user" };
  if (!opts.force && !(await weeklyDigestEnabled(userId))) return { sent: false, reason: "switched off" };
  const content = selectDigestContent(await buildDigestData(userId, now));
  if (!content.send && !opts.force) return { sent: false, reason: "nothing new" };
  const locale: Locale = found[0].locale === "zh" ? "zh" : "en";
  const t = await translatorFor(locale, "settings.digest");
  const { title, body } = renderDigest(content, t);
  const notificationId = await createNotification({ userId, kind: "digest", title, body, href: "/app", email: true });
  if (!notificationId) throw new Error("The weekly brief could not be stored");
  return { sent: true, notificationId, title };
}

async function digestJob(ctx: JobContext): Promise<JobResult> {
  const userId = ctx.userId ?? (typeof ctx.payload.userId === "string" ? ctx.payload.userId : null);
  if (!userId) return { status: "fail", error: "digest.send needs a user" };
  // A retry after the notification was stored must not store a second one.
  if (typeof ctx.state.notificationId === "string") return { status: "done", result: { notificationId: ctx.state.notificationId } };
  const out = await sendDigest(userId, { force: ctx.payload.force === true });
  if (out.sent && out.notificationId) await ctx.checkpoint({ notificationId: out.notificationId });
  return { status: "done", result: { sent: out.sent, ...(out.reason ? { reason: out.reason } : {}) } };
}

export const jobHandlers: JobModule = {
  "digest.send": { handler: digestJob, leaseMs: 2 * 60_000, timeoutMs: 60_000 },
};
