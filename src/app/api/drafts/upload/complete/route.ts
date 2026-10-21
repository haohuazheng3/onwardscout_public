import { withErrorCapture } from "@/lib/errors";
import { draftWriter } from "@/lib/profile/draft-route";
import { handleComplete } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step 2 on /app/start: the file arrived → documents row → parsing starts right away. */
export const POST = withErrorCapture("/api/drafts/upload/complete", async (req: Request) => {
  const ctx = await draftWriter("complete", 60);
  if (ctx instanceof Response) return ctx;
  return handleComplete(ctx.owner.ownerId, req, ctx.maxFiles);
});
