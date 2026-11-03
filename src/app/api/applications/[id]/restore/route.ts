import { z } from "zod";
import { applicationView, restoreDocument } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ documentId: z.string().regex(/^gen_[0-9a-z]{6,40}$/) });

/** Brings an earlier version of a document back as the newest one. */
export const POST = withErrorCapture("/api/applications/[id]/restore", async (req: Request, ctx: RouteContext<"/api/applications/[id]/restore">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:restore:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    const r = await restoreDocument(session.userId, id, parsed.data.documentId);
    return ok({ ...r, application: await applicationView(session.userId, id) });
  } catch (err) {
    return fromError(err);
  }
});
