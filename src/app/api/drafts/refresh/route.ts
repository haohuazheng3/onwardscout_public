import { withErrorCapture } from "@/lib/errors";
import { refreshState } from "@/lib/opportunities";
import { draftReader } from "@/lib/profile/draft-route";
import { ok } from "@/lib/profile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the dashboard's first picks are still being found (signed in or a draft): it reloads when they land. */
export const GET = withErrorCapture("/api/drafts/refresh", async () => {
  const owner = await draftReader();
  if (owner instanceof Response) return owner;
  if (!owner) return ok({ refresh: { refreshing: false, finishedAt: null, failed: false } });
  return ok({ refresh: await refreshState(owner.ownerId) });
});
