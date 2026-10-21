import { withErrorCapture } from "@/lib/errors";
import { refreshMatchesSoon, refreshState, topMatches } from "@/lib/opportunities";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/matches?limit=10 → { matches: MatchCard[], refresh: { refreshing, finishedAt, failed } }
 * GET /api/matches?state=1  → { refresh } only (the board polls this while the scout is out looking).
 */
export const GET = withErrorCapture("/api/matches", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`matches:read:${session.userId}`, 120, 60);
  if (!rl.ok) return tooMany(rl);
  const params = new URL(req.url).searchParams;
  const refresh = await refreshState(session.userId);
  if (params.get("state") === "1") return Response.json({ refresh }, { headers: NO_STORE });
  const limit = Math.max(1, Math.min(50, Number.parseInt(params.get("limit") ?? "10", 10) || 10));
  const matches = await topMatches(session.userId, limit);
  return Response.json({ matches, refresh }, { headers: NO_STORE });
});

/** POST /api/matches → re-score the person's board now (6 per 10 minutes) → 202 { refresh }. */
export const POST = withErrorCapture("/api/matches", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`matches:refresh:${session.userId}`, 6, 600);
  if (!rl.ok) return tooMany(rl);
  await refreshMatchesSoon(session.userId);
  const refresh = await refreshState(session.userId);
  return Response.json({ refresh }, { status: 202, headers: NO_STORE });
});
