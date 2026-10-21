import { withErrorCapture } from "@/lib/errors";
import { handleStatus } from "@/lib/profile/handlers";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live reading/building status of the signed-in person's sources (polled every 1.5 s while busy). */
export const GET = withErrorCapture("/api/profile/status", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  return handleStatus(session.userId, req);
});
