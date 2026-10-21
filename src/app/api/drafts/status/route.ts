import { withErrorCapture } from "@/lib/errors";
import { draftReader, emptyStatus } from "@/lib/profile/draft-route";
import { handleStatus } from "@/lib/profile/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the wizard polls every 1.5 s while sources are read (works signed out). */
export const GET = withErrorCapture("/api/drafts/status", async (req: Request) => {
  const owner = await draftReader();
  if (owner instanceof Response) return owner;
  if (!owner) return emptyStatus();
  return handleStatus(owner.ownerId, req);
});
