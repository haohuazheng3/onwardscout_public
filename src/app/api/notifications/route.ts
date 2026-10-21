import { z } from "zod";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/lib/notifications";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.iso
    .datetime({ offset: true })
    .optional()
    .transform((v) => (v ? new Date(v) : null)),
});

/** The signed-in person's notifications, newest first, with the unread count. */
export const GET = withErrorCapture("/api/notifications", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const url = new URL(req.url);
  const parsed = Query.safeParse({ limit: url.searchParams.get("limit") ?? undefined, before: url.searchParams.get("before") ?? undefined });
  if (!parsed.success) return jsonError("That list request is not valid. Reload the page and try again.", 400);
  const [items, unread] = await Promise.all([
    listNotifications(session.userId, { limit: parsed.data.limit, before: parsed.data.before }),
    unreadCount(session.userId),
  ]);
  return Response.json({ notifications: items, unread, more: items.length === parsed.data.limit }, { headers: NO_STORE });
});

const Body = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().regex(/^ntf_[0-9a-z]{8,32}$/)).min(1).max(200) }),
]);

/** Mark notifications read: `{ ids: [...] }` or `{ all: true }`. Answers the new unread count. */
export const POST = withErrorCapture("/api/notifications", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`notifications:write:${session.userId}`, 120, 60);
  if (!rl.ok) return tooMany(rl);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("That change is not valid. Reload the page and try again.", 400);
  const changed = "all" in parsed.data ? await markAllRead(session.userId) : await markRead(session.userId, parsed.data.ids);
  const unread = await unreadCount(session.userId);
  return Response.json({ changed, unread }, { headers: NO_STORE });
});
