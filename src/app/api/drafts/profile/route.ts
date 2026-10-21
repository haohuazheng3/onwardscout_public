import { withErrorCapture } from "@/lib/errors";
import { draftReader, draftWriter } from "@/lib/profile/draft-route";
import { handleProfileGet, handleProfilePatch } from "@/lib/profile/handlers";
import { ok } from "@/lib/profile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The profile card on /app/start (works signed out). */
export const GET = withErrorCapture("/api/drafts/profile", async () => {
  const owner = await draftReader();
  if (owner instanceof Response) return owner;
  if (!owner) return ok({ profile: null, status: "empty", version: 0, completeness: 0, gaps: [] });
  return handleProfileGet(owner.ownerId);
});

/** One tap on the profile card: saved at once, stored as the person's confirmed choice. */
export const PATCH = withErrorCapture("/api/drafts/profile", async (req: Request) => {
  const ctx = await draftWriter("patch", 240);
  if (ctx instanceof Response) return ctx;
  return handleProfilePatch(ctx.owner.ownerId, req);
});
