import { z } from "zod";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { importFromUrl } from "@/lib/opportunities/import";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Fetching the page (≤ 10 s) plus normalising and scoring it. */
export const maxDuration = 60;

const Body = z.object({ url: z.string().trim().min(4).max(2000) });

/**
 * POST /api/opportunities/import { url } → { opportunity, match, created, missing, typeGuessed }.
 * Adds a link the person found as a private opportunity pinned on their board.
 * 10 per hour and 40 per day per person.
 */
export const POST = withErrorCapture("/api/opportunities/import", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const hour = await rateLimit(`opportunities:import:h:${session.userId}`, 10, 3600);
  if (!hour.ok) return tooMany(hour);
  const day = await rateLimit(`opportunities:import:d:${session.userId}`, 40, 86_400);
  if (!day.ok) return tooMany(day);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Paste the full link to the opportunity, starting with https://.", 400);

  const result = await importFromUrl(session.userId, parsed.data.url);
  if (!result.ok) return jsonError(result.error, result.status);
  const body = { created: result.created, opportunity: result.opportunity, match: result.match, missing: result.missing, typeGuessed: result.typeGuessed };
  return Response.json(body, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
});
