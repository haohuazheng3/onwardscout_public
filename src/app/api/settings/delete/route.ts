import { z } from "zod";
import { blockingSubscription, deleteUserData } from "@/lib/data-export";
import { captureError, jsonError, withErrorCapture } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ confirm: z.literal("DELETE") });

/*
 * Account deletion, scoped to the requesting person only (the user id comes from the session,
 * never from the request). Order: files in R2 → every row of this user → the Clerk user.
 * Refused while a Pro subscription would keep renewing (cancel it in Billing first), so nobody
 * is charged for an account that no longer exists.
 */
export const POST = withErrorCapture("/api/settings/delete", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`settings:delete:${session.userId}`, 5, 3600);
  if (!rl.ok) return tooMany(rl);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Type DELETE in capital letters to confirm.", 400);

  const sub = await blockingSubscription(session.userId);
  if (sub) {
    return jsonError("Your Pro subscription is still set to renew. Cancel it in Billing first, then delete your account, so you are never charged for an account that no longer exists.", 409);
  }

  try {
    const report = await deleteUserData(session.userId, { clerk: true });
    await notifyOwner({
      subject: "Account deleted",
      text: `A user deleted their account.\nObjects removed: ${report.objects}\nApplications: ${report.applications}\nDocuments: ${report.documents}\nClerk: ${report.clerk}`,
    });
    return Response.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/settings/delete", context: { stage: "delete" } });
    return jsonError("We could not finish deleting your account. Try again in a minute: it picks up where it stopped. If it keeps failing, write to support@onwardscout.com and we will complete it by hand.", 500);
  }
});
