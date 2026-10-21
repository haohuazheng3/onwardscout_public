import { z } from "zod";
import { applicationView, recordOutcome } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { OUTCOME_CHOICES } from "@/lib/applications/plan";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ result: z.enum(OUTCOME_CHOICES), note: z.string().trim().max(1000).optional() });

/** The person records what happened: interview, offer, not selected, no response… */
export const POST = withErrorCapture("/api/applications/[id]/outcome", async (req: Request, ctx: RouteContext<"/api/applications/[id]/outcome">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:outcome:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    await recordOutcome(session.userId, id, parsed.data.result, parsed.data.note ?? null);
    return ok({ application: await applicationView(session.userId, id) });
  } catch (err) {
    return fromError(err);
  }
});
