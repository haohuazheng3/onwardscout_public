import { z } from "zod";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { localeSchema, ok, readBody } from "@/lib/profile/http";
import { reparseDocument } from "@/lib/profile/pipeline";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ locale: localeSchema });

/** Reads one of the person's sources again from scratch. */
export const POST = withErrorCapture("/api/documents/[id]/reparse", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`documents:reparse:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, Body);
  if ("error" in body) return body.error;
  const { id } = await ctx.params;
  const row = await reparseDocument(session.userId, id, body.data.locale);
  if (!row) return jsonError("We couldn't find that document.", 404);
  return ok({ document: { id: row.id, status: row.status } });
});
