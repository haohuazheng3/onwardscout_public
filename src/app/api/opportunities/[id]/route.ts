import { z } from "zod";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { getDetailForUser } from "@/lib/opportunities/queries";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.string().regex(/^opp_[0-9a-z]{4,40}$/);

/** GET /api/opportunities/<id> → { opportunity, match, application } for the signed-in person. */
export const GET = withErrorCapture("/api/opportunities/[id]", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const parsed = Id.safeParse(id);
  if (!parsed.success) return jsonError("We couldn't find that opportunity.", 404);
  const detail = await getDetailForUser(session.userId, parsed.data);
  if (!detail) return jsonError("We couldn't find that opportunity.", 404);
  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
});
