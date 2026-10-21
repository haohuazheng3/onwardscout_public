import { withErrorCapture } from "@/lib/errors";
import { handleNote } from "@/lib/profile/handlers";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Anything else?" (signed in): one line in the person's words, kept as a source. */
export const POST = withErrorCapture("/api/uploads/note", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`uploads:note:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  return handleNote(session.userId, req);
});
