import "server-only";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { appState, creditLots, users } from "@/lib/db/schema";

/*
 * Read-only helpers shared by the admin pages. Nothing here moves credits or changes status:
 * operator levers live in ../actions.ts and go through the owning modules.
 */

/** requireAdmin() once per request: the layout and the page share one Clerk lookup. */
export const requireAdminOnce = cache(requireAdmin);

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type LocaleParams = Promise<{ locale: string }>;

/** First step of every admin page: the validated locale, set for this request. */
export async function adminLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}

export function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

export const ADMIN_PAGE = 100;

/** app_state keys written by the crons (theirs or ours), for the overview and diagnostics. */
export const CRON_STATE_KEYS = {
  jobs: "cron:jobs:last",
  digest: "cron:digest:last",
  followups: "cron:followups:last",
  expire: "cron:expire:last",
  sources: "cron:sources:last",
  reconcile: "cron:reconcile:last",
} as const;

export async function appStateEntries(keys: readonly string[]): Promise<Map<string, { value: unknown; updatedAt: Date }>> {
  const out = new Map<string, { value: unknown; updatedAt: Date }>();
  if (!keys.length) return out;
  const rows = await db.select().from(appState).where(inArray(appState.key, [...keys]));
  for (const r of rows) out.set(r.key, { value: r.value, updatedAt: r.updatedAt });
  return out;
}

/** `ranAt` from a cron summary, else the row's update time. */
export function lastRunOf(entry: { value: unknown; updatedAt: Date } | undefined): Date | null {
  if (!entry) return null;
  const v = entry.value as { ranAt?: unknown } | null;
  if (v && typeof v.ranAt === "string") {
    const d = new Date(v.ranAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return entry.updatedAt;
}

export async function emailsForUsers(userIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
  for (const r of rows) out.set(r.id, r.email);
  return out;
}

/** Spendable credits per user (active, unexpired lots), read-only and without side effects. */
export async function availableCredits(userIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  const rows = await db
    .select({ userId: creditLots.userId, available: sql<number>`coalesce(sum(${creditLots.remaining}), 0)::int` })
    .from(creditLots)
    .where(and(inArray(creditLots.userId, [...userIds]), eq(creditLots.status, "active"), or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, sql`now()`))))
    .groupBy(creditLots.userId);
  for (const r of rows) out.set(r.userId, Number(r.available));
  return out;
}

/** Escapes LIKE wildcards in user input. */
export function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Query string of the current filters, minus the notice (forms send it back as `back`). */
export function backQuery(sp: Record<string, string | string[] | undefined>, keys: readonly string[]): string {
  const q = new URLSearchParams();
  for (const k of keys) {
    const v = one(sp[k]);
    if (v) q.set(k, v);
  }
  return q.toString();
}
