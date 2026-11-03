import { z } from "zod";
import { applicationFor, applyPreview, applyTarget, hasMaterial, isClosedRound, startFromListing } from "@/lib/applications/apply";
import { fromError, ok, readJson } from "@/lib/applications/http";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { anonWriteLimit, resolveDraftOwner } from "@/lib/profile/anon";
import { trackEvent } from "@/lib/profile/http";
import { rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Apply from a listing (/app/apply/<id>), signed in or not: POST starts the owner's
 * application for the opportunity (its preparation drafts the materials right away); GET is
 * what the page polls while they are drafted. The owner is the signed-in person, else the
 * anonymous draft named by the `os_anon` cookie (created by the first upload).
 */

const OPP_ID = /^opp_[0-9a-z]{6,40}$/;
const Body = z.object({ opportunityId: z.string().trim().regex(OPP_ID) });

const NEEDS_SOURCE = "Add your résumé (or a link to your profile) first, so the materials are drafted from your own experience.";
const CLOSED = "This round has closed, so there is nothing to apply to right now.";

export const POST = withErrorCapture("/api/drafts/apply", async (req: Request) => {
  const owner = await resolveDraftOwner({ create: false });
  if (owner instanceof Response) return owner;
  if (!owner) return jsonError(NEEDS_SOURCE, 409);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("That request isn't valid. Reload the page and try again.", 400);
  const { opportunityId } = parsed.data;

  const opp = await applyTarget(opportunityId);
  if (!opp) return jsonError("We couldn't find that opportunity. It may have closed.", 404);
  const existing = await applicationFor(owner.ownerId, opportunityId);
  if (!existing) {
    if (isClosedRound(opp)) return jsonError(CLOSED, 409);
    if (!(await hasMaterial(owner.ownerId))) return jsonError(NEEDS_SOURCE, 409);
    // Each new application drafts several documents: a few a day signed out, more signed in.
    if (owner.anonymous) {
      const limited = await anonWriteLimit("apply", 8, 24 * 3600);
      if (limited) return limited;
      const rl = await rateLimit(`drafts:apply:${owner.ownerId}`, 3, 24 * 3600);
      if (!rl.ok) return Response.json({ error: "You've started a few applications already. Sign in to keep going — it takes one email code.", signIn: true }, { status: 429, headers: { "Cache-Control": "no-store" } });
    } else {
      const rl = await rateLimit(`applications:create:${owner.ownerId}`, 30, 600);
      if (!rl.ok) return tooMany(rl);
    }
  }
  try {
    const r = await startFromListing(owner.ownerId, opportunityId);
    if (r.created) await trackEvent(owner.ownerId, "apply_from_listing", { opportunityId });
    return ok({ applicationId: r.applicationId, created: r.created, signedIn: !owner.anonymous }, r.created ? 201 : 200);
  } catch (err) {
    return fromError(err);
  }
});

export const GET = withErrorCapture("/api/drafts/apply", async (req: Request) => {
  const owner = await resolveDraftOwner({ create: false });
  if (owner instanceof Response) return owner;
  const opportunityId = new URL(req.url).searchParams.get("opportunityId") ?? "";
  if (!OPP_ID.test(opportunityId)) return jsonError("That request isn't valid. Reload the page and try again.", 400);
  if (!owner) return ok({ application: null, signedIn: false });
  const app = await applicationFor(owner.ownerId, opportunityId);
  const preview = app ? await applyPreview(owner.ownerId, app.id) : null;
  return ok({ application: preview, signedIn: !owner.anonymous });
});
