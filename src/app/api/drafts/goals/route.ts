import { withErrorCapture } from "@/lib/errors";
import { refreshMatchesSoon } from "@/lib/opportunities";
import { draftWriter } from "@/lib/profile/draft-route";
import { handleGoalsCreate } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Finish" on /app/start: goals + playbook milestones. Signed out, they wait in the draft until
 * the person saves it by signing in (/api/drafts/claim); signed in, matching starts now.
 */
export const POST = withErrorCapture("/api/drafts/goals", async (req: Request) => {
  const ctx = await draftWriter("goals", 30);
  if (ctx instanceof Response) return ctx;
  const { response } = await handleGoalsCreate(ctx.owner.ownerId, req);
  if (response.ok && !ctx.owner.anonymous) await refreshMatchesSoon(ctx.owner.ownerId);
  return response;
});
