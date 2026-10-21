import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { matchFeedbackSchema } from "@/lib/core/types";
import { db } from "@/lib/db";
import { matches } from "@/lib/db/schema";
import { captureError, jsonError, withErrorCapture } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { recordEvent } from "@/lib/notifications";
import { getDetailForUser } from "@/lib/opportunities/queries";
import { FEEDBACK_REASONS } from "@/lib/opportunities/types";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  feedback: matchFeedbackSchema.nullable(),
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(),
});

const MATCH_ID = /^mat_[0-9a-z]{4,40}$/;
const OPP_ID = /^opp_[0-9a-z]{4,40}$/;

/**
 * POST /api/matches/<matchId | opportunityId>/feedback { feedback: "interested"|"later"|"not_interested"|null, reason? }
 * Saves the person's reaction to a pick ("Later", "Not interested" + why, or undo with null).
 * An opportunity id is accepted for catalog results that have no match row yet.
 */
export const POST = withErrorCapture("/api/matches/[id]/feedback", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`matches:feedback:${session.userId}`, 120, 60);
  if (!rl.ok) return tooMany(rl);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("That choice isn't valid. Reload the page and try again.", 400);
  const { id } = await ctx.params;
  const feedback = parsed.data.feedback;
  const reason = feedback === "not_interested" ? (parsed.data.reason ?? null) : null;
  const { userId } = session;

  let row: { id: string; opportunityId: string; feedback: string | null; feedbackReason: string | null } | undefined;
  if (MATCH_ID.test(id)) {
    [row] = await db
      .update(matches)
      .set({ feedback, feedbackReason: reason, updatedAt: sql`now()` })
      .where(and(eq(matches.id, id), eq(matches.userId, userId)))
      .returning({ id: matches.id, opportunityId: matches.opportunityId, feedback: matches.feedback, feedbackReason: matches.feedbackReason });
  } else if (OPP_ID.test(id)) {
    const detail = await getDetailForUser(userId, id);
    if (!detail) return jsonError("We couldn't find that opportunity.", 404);
    [row] = await db
      .insert(matches)
      .values({ id: newId("mat"), userId, opportunityId: id, fit: 0, rank: null, feedback, feedbackReason: reason })
      .onConflictDoUpdate({ target: [matches.userId, matches.opportunityId], set: { feedback, feedbackReason: reason, updatedAt: sql`now()` } })
      .returning({ id: matches.id, opportunityId: matches.opportunityId, feedback: matches.feedback, feedbackReason: matches.feedbackReason });
  }
  if (!row) return jsonError("We couldn't find that pick. Reload the board and try again.", 404);

  try {
    await recordEvent({ userId, kind: "match_feedback", opportunityId: row.opportunityId, data: { feedback, reason } });
  } catch (err) {
    await captureError(err, { route: "/api/matches/[id]/feedback (event)", severity: "warn" });
  }
  return Response.json({ match: row }, { headers: { "Cache-Control": "no-store" } });
});
