import { withErrorCapture } from "@/lib/errors";
import { handleLinks } from "@/lib/profile/handlers";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pasted links (signed in): saved as sources and read right away (LinkedIn is saved, not read). */
export const POST = withErrorCapture("/api/uploads/link", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`uploads:link:${session.userId}`, 40, 600);
  if (!rl.ok) return tooMany(rl);
  return handleLinks(session.userId, req);
});
