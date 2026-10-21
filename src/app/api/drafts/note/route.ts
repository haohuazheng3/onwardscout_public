import { withErrorCapture } from "@/lib/errors";
import { draftWriter } from "@/lib/profile/draft-route";
import { handleNote } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Anything else?" on /app/start (works signed out). */
export const POST = withErrorCapture("/api/drafts/note", async (req: Request) => {
  const ctx = await draftWriter("note", 20);
  if (ctx instanceof Response) return ctx;
  return handleNote(ctx.owner.ownerId, req);
});
