import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { appState, errorGroups } from "./db/schema";
import { HEALTH_SOURCES } from "./errors";
import { notifyOwner } from "./notify";
import { SITE } from "./site";

/** app_state key holding the UTC day of the last digest, so a cron that fires twice sends once. */
export const ERROR_DIGEST_STATE_KEY = "errors:digest:last";
const TOP = 10;

export interface DigestItem {
  name: string;
  message: string;
  route: string | null;
  source: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const minute = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

/**
 * The once-a-day summary of the error inbox: our own code's unresolved severe errors (the ones
 * that used to turn /api/health red), newest activity first. Null when there are none: browser
 * reports and warnings alone never send anything (anonymous input can be forged at will).
 */
export function buildErrorDigest(input: { day: string; severeOpen: number; otherOpen: number; top: DigestItem[]; adminUrl: string }): { subject: string; text: string } | null {
  if (input.severeOpen <= 0) return null;
  const n = input.severeOpen;
  const lines = input.top.map((e, i) => {
    const message = e.message.replace(/\s+/g, " ").trim();
    return [
      `${i + 1}. ${e.name}: ${message.length > 180 ? `${message.slice(0, 180)}…` : message}`,
      `   ${e.source} · ${e.route ?? "-"} · ${e.count}× · first ${minute(e.firstSeen)} UTC · last ${minute(e.lastSeen)} UTC`,
    ].join("\n");
  });
  const more = n > input.top.length ? [`…and ${n - input.top.length} more.`] : [];
  const other = input.otherOpen > 0 ? [`Also open: ${input.otherOpen} lower-priority group${input.otherOpen === 1 ? "" : "s"} (warnings and browser reports).`] : [];
  return {
    subject: `Daily error digest: ${n} unresolved server error${n === 1 ? "" : "s"} (${input.day})`,
    text: [
      `${n} unresolved server error group${n === 1 ? "" : "s"} in the error inbox on ${input.day} (UTC). The site is serving: /api/health stays 200 and only reports this count.`,
      "",
      ...lines,
      ...more,
      "",
      ...other,
      `Review and resolve: ${input.adminUrl}`,
      "",
      "One digest per day at most, none when nothing is open. A new severe error still emails once when it first happens.",
    ].join("\n"),
  };
}

/**
 * Sends the digest at most once per UTC day (run by the nightly /api/cron/expire). Read-only on
 * the error inbox: it never resolves or edits an error group.
 */
export async function sendErrorDigest(now = new Date()): Promise<{ sent: boolean; severeOpen: number; reason?: string }> {
  const today = day(now);
  const severe = and(isNull(errorGroups.resolvedAt), eq(errorGroups.severity, "error"), inArray(errorGroups.source, [...HEALTH_SOURCES]));
  const [severeRows, openRows, top] = await Promise.all([
    db.select({ n: count() }).from(errorGroups).where(severe),
    db.select({ n: count() }).from(errorGroups).where(isNull(errorGroups.resolvedAt)),
    db
      .select({ name: errorGroups.name, message: errorGroups.message, route: errorGroups.route, source: errorGroups.source, count: errorGroups.count, firstSeen: errorGroups.firstSeen, lastSeen: errorGroups.lastSeen })
      .from(errorGroups)
      .where(severe)
      .orderBy(desc(errorGroups.lastSeen))
      .limit(TOP),
  ]);
  const severeOpen = Number(severeRows[0]?.n ?? 0);
  const otherOpen = Math.max(0, Number(openRows[0]?.n ?? 0) - severeOpen);
  const digest = buildErrorDigest({ day: today, severeOpen, otherOpen, top, adminUrl: `${SITE.url}/admin/errors` });
  if (!digest) return { sent: false, severeOpen, reason: "nothing open" };

  // Claim the day before sending (idempotent: a second run the same day finds it claimed).
  const value = { day: today, at: now.toISOString(), severeOpen };
  const claimed = await db
    .insert(appState)
    .values({ key: ERROR_DIGEST_STATE_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: sql`now()` }, setWhere: sql`${appState.value}->>'day' is distinct from ${today}` })
    .returning({ key: appState.key });
  if (claimed.length === 0) return { sent: false, severeOpen, reason: "already sent today" };

  const sent = await notifyOwner(digest);
  if (!sent) {
    // Give the day back so a rerun can try again.
    await db
      .update(appState)
      .set({ value: { day: null, failedAt: now.toISOString() }, updatedAt: sql`now()` })
      .where(eq(appState.key, ERROR_DIGEST_STATE_KEY));
    return { sent: false, severeOpen, reason: "mail worker refused or unreachable" };
  }
  return { sent: true, severeOpen };
}
