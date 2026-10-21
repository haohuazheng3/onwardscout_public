import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, notifications } from "@/lib/db/schema";
import { withErrorCapture } from "@/lib/errors";
import { ensureUser, isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user as the app shell sees them:
 * `{ userId, email, locale, unreadNotifications, needsYou }` (+ `balance` once billing lands).
 * The shell (src/components/AppNav.tsx → parseAppStatus) reads the counts; every field it does
 * not understand is ignored, so features may add fields here without breaking it.
 */
export const GET = withErrorCapture("/api/me", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const [row, unread, needsYou] = await Promise.all([
    ensureUser(session),
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt))),
    db
      .select({ n: count() })
      .from(applications)
      .where(and(eq(applications.userId, session.userId), eq(applications.status, "needs_you"))),
  ]);
  return Response.json(
    {
      userId: session.userId,
      email: session.email,
      locale: row.locale === "zh" ? "zh" : "en",
      unreadNotifications: unread[0]?.n ?? 0,
      needsYou: needsYou[0]?.n ?? 0,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
