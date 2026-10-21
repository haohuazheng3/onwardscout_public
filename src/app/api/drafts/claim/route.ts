import { after } from "next/server";
import { z } from "zod";
import { captureError, withErrorCapture } from "@/lib/errors";
import { refreshMatchesSoon } from "@/lib/opportunities";
import { claimAnonymousDraft } from "@/lib/profile";
import { clearAnonCookie, readAnonId } from "@/lib/profile/anon";
import { listGoals } from "@/lib/profile/goals";
import { localeSchema, ok, readBody, trackEvent } from "@/lib/profile/http";
import { relocateClaimedFiles } from "@/lib/profile/pipeline";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ locale: localeSchema });

/**
 * After sign-in: the anonymous draft (cookie) becomes the person's — documents, profile,
 * goals. Idempotent; clears the cookie; starts matching; moves the files to the person's own
 * storage prefix after the response.
 */
export const POST = withErrorCapture("/api/drafts/claim", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`drafts:claim:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, Body);
  if ("error" in body) return body.error;
  const anonId = await readAnonId();
  let moved = 0;
  if (anonId) {
    moved = (await claimAnonymousDraft(anonId, session.userId, { email: session.email, locale: body.data.locale })).moved;
    await clearAnonCookie();
    if (moved > 0) await trackEvent(session.userId, "draft_claimed", { moved });
    // The page may already have claimed the rows while rendering; the files move either way.
    after(async () => {
      try {
        await relocateClaimedFiles(session.userId);
      } catch (err) {
        await captureError(err, { route: "/api/drafts/claim (relocate)", severity: "warn" });
      }
    });
  }
  const goals = await listGoals(session.userId, { onlyActive: true });
  if (goals.length) await refreshMatchesSoon(session.userId);
  return ok({ moved, goals: goals.map((g) => ({ id: g.id, family: g.family, sub: g.sub })) });
});
