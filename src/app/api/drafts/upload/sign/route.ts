import { withErrorCapture } from "@/lib/errors";
import { draftWriter } from "@/lib/profile/draft-route";
import { handleSign } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 1 of an upload on /app/start (works signed out): a signed PUT link to the files worker. */
export const POST = withErrorCapture("/api/drafts/upload/sign", async (req: Request) => {
  const ctx = await draftWriter("sign", 40);
  if (ctx instanceof Response) return ctx;
  return handleSign(ctx.owner.ownerId, req, ctx.maxFiles);
});
