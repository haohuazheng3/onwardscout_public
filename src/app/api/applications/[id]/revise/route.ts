import { z } from "zod";
import { applicationView, reviseDocument } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  documentId: z.string().regex(/^gen_[0-9a-z]{6,40}$/),
  /** The person's note: what to change ("shorter", "lead with the pilots", "我们月活两万"). */
  note: z.string().trim().min(2).max(2000),
});

/** "Tell the AI what to change": a new version of one document, with what changed. */
export const POST = withErrorCapture("/api/applications/[id]/revise", async (req: Request, ctx: RouteContext<"/api/applications/[id]/revise">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:revise:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    const r = await reviseDocument(session.userId, id, parsed.data.documentId, parsed.data.note);
    return ok({ ...r, application: await applicationView(session.userId, id) });
  } catch (err) {
    return fromError(err);
  }
});
