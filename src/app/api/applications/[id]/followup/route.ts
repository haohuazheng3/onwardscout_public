import { z } from "zod";
import { applicationView, approveFollowUp, skipFollowUp } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ decision: z.enum(["send", "skip"]) });

/** The person sends (or skips) a drafted follow-up email. Nothing is sent without this tap unless auto follow-ups are on. */
export const POST = withErrorCapture("/api/applications/[id]/followup", async (req: Request, ctx: RouteContext<"/api/applications/[id]/followup">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:followup:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    if (parsed.data.decision === "send") await approveFollowUp(session.userId, id);
    else await skipFollowUp(session.userId, id);
    return ok({ application: await applicationView(session.userId, id) });
  } catch (err) {
    return fromError(err);
  }
});
