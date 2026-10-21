import { jsonError, withErrorCapture } from "@/lib/errors";
import { loadBoardPage } from "@/lib/opportunities/board";
import { parseBoardFilters, parsePaging } from "@/lib/opportunities/filters";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/opportunities?view=&group=&type=&remote=&country=&deadline=&effort=&q=&goal=&cursor=&limit=&counts=1
 * One page of the signed-in person's Scout board → { items, next, counts }.
 */
export const GET = withErrorCapture("/api/opportunities", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`opportunities:list:${session.userId}`, 120, 60);
  if (!rl.ok) return tooMany(rl);

  const params = new URL(req.url).searchParams;
  if ((params.get("q") ?? "").length > 500) return jsonError("That search is too long. Try a few words.", 400);
  const filters = parseBoardFilters(params);
  const paging = parsePaging(params);
  const page = await loadBoardPage(session.userId, filters, paging, { counts: params.get("counts") === "1" });
  return Response.json(page, { headers: NO_STORE });
});
