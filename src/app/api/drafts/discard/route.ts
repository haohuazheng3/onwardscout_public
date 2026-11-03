import { paidApplicationOf } from "@/lib/applications/unlock";
import { deleteAnonymousDraft } from "@/lib/data-export";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { anonWriteLimit, clearAnonCookie, resolveDraftOwner } from "@/lib/profile/anon";
import { ok } from "@/lib/profile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * "Delete this draft": a visitor who never signed in removes everything their browser started —
 * files, profile, plan, drafted applications — and the cookie that named it, so nobody who signs
 * in on that browser later inherits it (a shared computer). Signed-in people delete their data in
 * Settings instead.
 */
export const POST = withErrorCapture("/api/drafts/discard", async () => {
  const owner = await resolveDraftOwner({ create: false });
  if (owner instanceof Response) return owner;
  if (!owner) return ok({ deleted: false });
  if (!owner.anonymous) return jsonError("You're signed in: delete your data from Settings.", 409);
  const limited = await anonWriteLimit("discard", 10, 3600);
  if (limited) return limited;
  // A draft with an application the visitor paid for is theirs by the email they paid with.
  const paid = await paidApplicationOf(owner.ownerId);
  if (paid) {
    return jsonError(
      paid.email
        ? `This draft holds an application you paid for, so it can't be deleted here. Sign in with ${paid.email} to keep it or remove it from Settings.`
        : "This draft holds an application you paid for, so it can't be deleted here. Sign in with the email you paid with to keep it or remove it from Settings.",
      409,
    );
  }
  await deleteAnonymousDraft(owner.ownerId);
  await clearAnonCookie();
  return ok({ deleted: true });
});
