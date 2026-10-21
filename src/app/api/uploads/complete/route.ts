import { withErrorCapture } from "@/lib/errors";
import { handleComplete } from "@/lib/profile/handlers";
import { UPLOAD_LIMITS } from "@/lib/profile/uploads";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 2 (signed in): the file arrived → documents row → 'profile.parse' starts right away. */
export const POST = withErrorCapture("/api/uploads/complete", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`uploads:complete:${session.userId}`, 120, 600);
  if (!rl.ok) return tooMany(rl);
  return handleComplete(session.userId, req, UPLOAD_LIMITS.maxFilesSignedIn);
});
