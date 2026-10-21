import { withErrorCapture } from "@/lib/errors";
import { handleProfileGet, handleProfilePatch } from "@/lib/profile/handlers";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in person's profile document, state and open questions. */
export const GET = withErrorCapture("/api/profile", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  return handleProfileGet(session.userId);
});

/** One tap (roles, industries, functions, occupation, location, remote, work authorization, an answer, a field, "looks right"). */
export const PATCH = withErrorCapture("/api/profile", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`profile:patch:${session.userId}`, 240, 600);
  if (!rl.ok) return tooMany(rl);
  return handleProfilePatch(session.userId, req);
});
