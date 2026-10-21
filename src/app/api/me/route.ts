import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { NEEDS_USER_STATUSES } from "@/lib/core/state-machine";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { applications, notifications } from "@/lib/db/schema";
import { captureError, withErrorCapture } from "@/lib/errors";
import { ensureUser, isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user as the app shell sees them:
 * `{ userId, email, locale, unreadNotifications, needsYou, balance: { available, reserved,
 * expiringSoon, trialOnly } }`. The shell (src/components/AppNav.tsx → parseAppStatus) reads
 * the counts and `balance.available/reserved`; every field it does not understand is ignored,
 * so features may add fields here without breaking it.
 *
 * `needsYou` counts every application waiting for the person's tap (needs_info, needs_you,
 * ready = NEEDS_USER_STATUSES) — the same number as `needsYouCount` and the home page's
 * "Needs you" list (counted here directly to keep this hot endpoint's bundle small).
 * The balance is best-effort: a ledger hiccup leaves it out (the badge then hides) instead of
 * failing the whole status call.
 */
export const GET = withErrorCapture("/api/me", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  // The row first: on a first request it also grants the trial the balance should include.
  const row = await ensureUser(session);
  const [unread, needsYou, balance] = await Promise.all([
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt))),
    db
      .select({ n: count() })
      .from(applications)
      .where(and(eq(applications.userId, session.userId), inArray(applications.status, [...NEEDS_USER_STATUSES]))),
    getBalance(session.userId).catch(async (err: unknown) => {
      await captureError(err, { route: "/api/me (balance)", source: "server", severity: "warn" });
      return null;
    }),
  ]);
  return Response.json(
    {
      userId: session.userId,
      email: session.email,
      locale: row.locale === "zh" ? "zh" : "en",
      unreadNotifications: unread[0]?.n ?? 0,
      needsYou: needsYou[0]?.n ?? 0,
      ...(balance
        ? {
            balance: {
              available: balance.available,
              reserved: balance.reserved,
              expiringSoon: balance.expiringSoon,
              trialOnly: balance.trialOnly,
            },
          }
        : {}),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
