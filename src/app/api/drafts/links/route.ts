import { withErrorCapture } from "@/lib/errors";
import { draftWriter } from "@/lib/profile/draft-route";
import { handleLinks } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pasted links on /app/start (works signed out). */
export const POST = withErrorCapture("/api/drafts/links", async (req: Request) => {
  const ctx = await draftWriter("links", 30);
  if (ctx instanceof Response) return ctx;
  return handleLinks(ctx.owner.ownerId, req, { maxLinksTotal: ctx.maxLinks });
});
