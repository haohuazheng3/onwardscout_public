import { withErrorCapture } from "@/lib/errors";
import { handleSign } from "@/lib/profile/handlers";
import { UPLOAD_LIMITS } from "@/lib/profile/uploads";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 1 of an upload (signed in): a 15-minute signed PUT link straight to the files worker. */
export const POST = withErrorCapture("/api/uploads/sign", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`uploads:sign:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  return handleSign(session.userId, req, UPLOAD_LIMITS.maxFilesSignedIn);
});
