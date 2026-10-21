import { z } from "zod";
import { applicationView, regenerate } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  documentId: z.string().regex(/^gen_[0-9a-z]{6,40}$/).optional(),
  questionId: z.string().min(1).max(220).optional(),
  tone: z.enum(["professional", "warm", "concise", "enthusiastic"]).optional(),
  /** Re-prepare everything from the current answers. */
  all: z.boolean().optional(),
});

/** A fresh draft: one document (new version), one question's text draft, or the whole application. */
export const POST = withErrorCapture("/api/applications/[id]/regenerate", async (req: Request, ctx: RouteContext<"/api/applications/[id]/regenerate">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:regenerate:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success || (!parsed.data.documentId && !parsed.data.questionId && !parsed.data.all)) return BAD_INPUT();
  try {
    const r = await regenerate(session.userId, id, { documentId: parsed.data.documentId, questionId: parsed.data.questionId, tone: parsed.data.tone });
    return ok({ ...r, application: await applicationView(session.userId, id) });
  } catch (err) {
    return fromError(err);
  }
});
