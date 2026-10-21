import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import type { JsonObject } from "@/lib/core";
import { db } from "@/lib/db";
import { events, notifications, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { messageFallback } from "@/i18n/fallback";
import { loadMessages } from "@/i18n/messages";
import { localizePath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";
import { newId } from "@/lib/ids";
import type { JobModule } from "@/lib/jobs/handlers";
import { enqueue } from "@/lib/jobs/queue";
import type { JobContext } from "@/lib/jobs/registry";
import { runJobNow } from "@/lib/jobs/runner";
import type { JobResult } from "@/lib/jobs/state";
import { mailerConfigured, sendUserEmail } from "@/lib/mailer";
import { isSafeReturnPath, siteUrl } from "@/lib/site";
import { getNotificationPrefs, NO_PERKS, planPerks, type NotificationPrefs, type Perks } from "./authorizations";

/*
 * Notifications and the activity log (P6; contracts-features §9).
 *
 *  - notify(): one in-app row in `notifications` (the bell, the home page list); when the
 *    caller asks for email, a `notify.email` job sends it through src/lib/mailer.ts — only if
 *    product email is configured AND the person's preference allows it. Never throws.
 *  - recordEvent(): one row in `events` (the timeline). Never throws.
 *  - list / unread / mark read for /api/notifications and the bell.
 *
 * Titles and bodies are written by the producer in the person's language; `href` is an
 * unprefixed internal path ("/app/applications/app_…"): the bell renders it with the
 * locale-aware Link, emails with the person's locale prefix.
 */

export const NOTIFICATION_KINDS = ["needs_you", "submitted", "reply", "progress", "new_matches", "digest", "billing", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(v);
}

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  /** Also send it by email when product email is configured and the person allows it. */
  email?: boolean;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ pure helpers */

export const TITLE_MAX = 160;
export const BODY_MAX = 1200;

function clean(text: string, max: number): string {
  const t = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Only same-site paths may be stored as a notification link (never another origin). */
export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!isSafeReturnPath(h) || h.length > 500) return null;
  return h;
}

/** Normalised, size-capped content of a notification (pure). */
export function sanitizeNotification(input: { title: string; body?: string | null; href?: string | null }): { title: string; body: string | null; href: string | null } {
  const title = clean(input.title ?? "", TITLE_MAX) || "Onward Scout";
  const body = input.body ? clean(input.body, BODY_MAX) || null : null;
  return { title, body, href: safeHref(input.href) };
}

/**
 * Whether a notification of this kind may go out by email. The in-app copy always exists;
 * email needs the person's preference (and, for the weekly brief, a plan that includes it).
 */
export function emailAllowed(kind: string, prefs: NotificationPrefs, perks: Perks): boolean {
  if (kind === "digest") return prefs.emailDigest && perks.weeklyDigest;
  return prefs.emailUpdates;
}

/** Absolute, localized URL of an internal path, for emails. */
export function absoluteAppUrl(path: string, locale: Locale, origin = siteUrl()): string {
  const [p, hash = ""] = path.split("#");
  const [pathname, query = ""] = p.split("?");
  return `${origin}${localizePath(pathname || "/", locale)}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Plain-text email for a notification (pure; `t` is the `settings.email` translator). */
export function notificationEmail(
  n: { title: string; body: string | null; href: string | null },
  locale: Locale,
  t: (key: string, values?: Record<string, string | number>) => string,
  origin = siteUrl(),
): { subject: string; text: string } {
  const link = absoluteAppUrl(n.href ?? "/app", locale, origin);
  const settings = absoluteAppUrl("/app/settings#notifications", locale, origin);
  const lines = [n.title, "", ...(n.body ? [n.body, ""] : []), t("open", { url: link }), "", "—", t("why"), t("manage", { url: settings })];
  return { subject: n.title, text: lines.join("\n") };
}

/* ------------------------------------------------------------------ translator for server-side text */

/**
 * A translator for one namespace that works anywhere on the server (jobs, crons, route
 * handlers), without the request-scoped next-intl config. English fills missing zh keys.
 */
export async function translatorFor(locale: Locale, namespace: string) {
  const messages = await loadMessages(locale, ["settings", "admin"]);
  return createTranslator({
    locale,
    messages,
    namespace: namespace as never,
    onError: (error) => {
      if (error.code !== "MISSING_MESSAGE") console.error(`[i18n] ${error.code}: ${error.message}`);
    },
    getMessageFallback: ({ namespace: ns, key }) => messageFallback({ namespace: ns, key }),
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
}

/* ------------------------------------------------------------------ unsubscribe tokens */

export type UnsubscribeScope = "digest" | "updates";

function unsubscribeSecret(): string | null {
  const base = env("CRON_SECRET");
  return base ? createHmac("sha256", base).update("onward-scout:unsubscribe:v1").digest("hex") : null;
}

/** HMAC token for one-click unsubscribe links (RFC 8058). Null when no secret is configured. */
export function unsubscribeToken(userId: string, scope: UnsubscribeScope, secret = unsubscribeSecret()): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${scope}:${userId}`).digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, scope: UnsubscribeScope, token: string, secret = unsubscribeSecret()): boolean {
  const expected = unsubscribeToken(userId, scope, secret);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(userId: string, scope: UnsubscribeScope, origin = siteUrl()): string | undefined {
  const token = unsubscribeToken(userId, scope);
  if (!token) return undefined;
  const qs = new URLSearchParams({ u: userId, s: scope, t: token });
  return `${origin}/api/notifications/unsubscribe?${qs.toString()}`;
}

/* ------------------------------------------------------------------ writes */

function kick(jobId: string): void {
  // Inline start in the background of the current request; the minute cron drains it otherwise.
  try {
    waitUntil(runJobNow(jobId, { maxMs: 30_000 }));
  } catch {
    // Outside a request (scripts, tests): the cron picks the job up.
  }
}

/**
 * Inserts one notification and returns its id (null when it could not be stored; the error
 * is captured). Prefer `notify()` unless you need the id.
 */
export async function createNotification(input: NotifyInput): Promise<string | null> {
  try {
    const { title, body, href } = sanitizeNotification(input);
    const id = newId("ntf");
    await db.insert(notifications).values({ id, userId: input.userId, kind: input.kind, title, body, href });
    if (input.email && mailerConfigured()) {
      const job = await enqueue("notify.email", { notificationId: id }, { userId: input.userId, dedupeKey: `notify.email:${id}`, maxAttempts: 6 });
      if (job.created && job.status === "queued") kick(job.id);
    }
    return id;
  } catch (err) {
    await captureError(err, { route: "notifications.notify", context: { kind: input.kind, userId: input.userId } });
    return null;
  }
}

/** In-app notification (+ email when configured and allowed). Never throws. */
export async function notify(input: NotifyInput): Promise<void> {
  await createNotification(input);
}

/** Appends one activity event (the application timeline, the digest's "this week"). Never throws. */
export async function recordEvent(input: {
  userId: string;
  kind: string;
  applicationId?: string;
  opportunityId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(events).values({
      id: newId("evt"),
      userId: input.userId,
      kind: input.kind.slice(0, 80),
      applicationId: input.applicationId ?? null,
      opportunityId: input.opportunityId ?? null,
      data: (input.data ?? {}) as JsonObject,
    });
  } catch (err) {
    await captureError(err, { route: "notifications.recordEvent", context: { kind: input.kind, userId: input.userId } });
  }
}

/* ------------------------------------------------------------------ reads & read state */

function toItem(r: { id: string; kind: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date }): NotificationItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    readAt: r.readAt ? new Date(r.readAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

/** Newest first; `before` (ISO time) pages back. */
export async function listNotifications(userId: string, opts: { limit?: number; before?: Date | null } = {}): Promise<NotificationItem[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
  const where = opts.before ? and(eq(notifications.userId, userId), lt(notifications.createdAt, opts.before)) : eq(notifications.userId, userId);
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
  return rows.map(toItem);
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(rows[0]?.n ?? 0);
}

/** Marks the given notifications of this user read; returns how many changed. */
export async function markRead(userId: string, ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, unique), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/* ------------------------------------------------------------------ the notify.email job */

async function sendNotificationEmailJob(ctx: JobContext): Promise<JobResult> {
  const id = typeof ctx.payload.notificationId === "string" ? ctx.payload.notificationId : null;
  if (!id) return { status: "fail", error: "notify.email needs payload.notificationId" };
  const found = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      emailedAt: notifications.emailedAt,
      email: users.email,
      locale: users.locale,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, id))
    .limit(1);
  const n = found[0];
  if (!n) return { status: "done", result: { skipped: "notification deleted" } };
  if (n.emailedAt) return { status: "done", result: { skipped: "already emailed" } };
  if (!n.email) return { status: "done", result: { skipped: "no user row" } };
  if (!mailerConfigured()) return { status: "done", result: { skipped: "mailer not configured" } };

  const [prefs, perks] = await Promise.all([getNotificationPrefs(n.userId), n.kind === "digest" ? planPerks(n.userId) : Promise.resolve(NO_PERKS)]);
  if (!emailAllowed(n.kind, prefs, perks)) return { status: "done", result: { skipped: "preference" } };

  const locale: Locale = n.locale === "zh" ? "zh" : "en";
  const t = await translatorFor(locale, "settings.email");
  const mail = notificationEmail(n, locale, t);
  const scope: "digest" | "updates" = n.kind === "digest" ? "digest" : "updates";
  const res = await sendUserEmail({
    to: n.email,
    subject: mail.subject,
    text: mail.text,
    idempotencyKey: `ntf:${n.id}`,
    unsubscribeUrl: unsubscribeUrl(n.userId, scope),
    tags: { kind: n.kind },
  });
  if (!res.sent) {
    // Invalid address or missing config will not fix itself; anything else (Resend down, 5xx) is retried.
    if (/not a valid email|not configured|required/i.test(res.reason)) return { status: "done", result: { skipped: res.reason } };
    return { status: "retry", error: res.reason };
  }
  await db.update(notifications).set({ emailedAt: sql`now()` }).where(and(eq(notifications.id, n.id), isNull(notifications.emailedAt)));
  return { status: "done", result: { emailed: true, id: res.id } };
}

export const jobHandlers: JobModule = {
  "notify.email": { handler: sendNotificationEmailJob, leaseMs: 60_000, timeoutMs: 30_000 },
};
