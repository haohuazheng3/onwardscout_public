import { z } from "zod";
import { applicationView } from "@/lib/applications";
import { applyPreview } from "@/lib/applications/apply";
import { loadApplication } from "@/lib/applications/engine";
import { fromError, ok, readJson } from "@/lib/applications/http";
import { isUnlocked, unlockWithCredit } from "@/lib/applications/unlock";
import { ensureStripeCustomer } from "@/lib/billing";
import { getBalance, roomBalance } from "@/lib/credits";
import { IS_PRODUCTION_DEPLOY, isAdminEmail } from "@/lib/env";
import { captureError, jsonError, withErrorCapture } from "@/lib/errors";
import { localizePath } from "@/i18n/paths";
import { getOpportunity } from "@/lib/opportunities";
import { anonWriteLimit, resolveDraftOwner } from "@/lib/profile/anon";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { applyPath, SITE } from "@/lib/site";
import { CHECKOUT_BRAND, checkoutMetadata, paymentsEnabled, priceIdFor, statementSuffix, stripe, stripeLocale } from "@/lib/stripe";
import { ensureUser, getUserRow } from "@/lib/user";
import { SINGLE } from "@/content/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/*
 * Unlocking one application (owner decision 2026-11-03): the preview is free, paying opens it —
 * Claude writes everything in full, downloads and copy-ready answers appear, it can be confirmed.
 *
 *   POST { applicationId, method: "pay", nonce, locale }   → { url }  Stripe Checkout for $19.
 *       Works signed out: the owner is the anonymous draft from the `os_anon` cookie, and the
 *       success page is the apply page, which settles the session and starts the full run.
 *   POST { applicationId, method: "credit" }               → { application, balance }
 *       Signed in only: a season pass covering this type, or an older pack, pays for it.
 *
 * Lives under /api/drafts (not a personal prefix) so a visitor can pay before signing in.
 */

const Body = z.discriminatedUnion("method", [
  z.object({ method: z.literal("pay"), applicationId: z.string().regex(/^app_[0-9a-hjkmnp-tv-z]{6,40}$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), locale: z.enum(["en", "zh"]).optional().default("en") }),
  z.object({ method: z.literal("credit"), applicationId: z.string().regex(/^app_[0-9a-hjkmnp-tv-z]{6,40}$/) }),
]);

function fail(code: string, error: string, status: number): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE });
}

function isIdempotencyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "StripeIdempotencyError";
}

export const POST = withErrorCapture("/api/drafts/unlock", async (req: Request) => {
  const owner = await resolveDraftOwner({ create: false });
  if (owner instanceof Response) return owner;
  if (!owner) return jsonError("Please sign in, or start from the application you want to unlock.", 401);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("That request isn't valid. Reload the page and try again.", 400);
  const body = parsed.data;

  const [byOwner, byIp] = await Promise.all([rateLimit(`unlock:${owner.ownerId}`, 20, 600), rateLimit(`unlock:ip:${ipHash(clientIp(req.headers))}`, 40, 600)]);
  if (!byOwner.ok) return tooMany(byOwner);
  if (!byIp.ok) return tooMany(byIp);
  if (owner.anonymous) {
    const limited = await anonWriteLimit("unlock", 30, 3600);
    if (limited) return limited;
  }

  const app = await loadApplication(body.applicationId, owner.ownerId);
  if (!app) return jsonError("We couldn't find that application.", 404);
  if (app.practice) return jsonError("Practice applications are free: there is nothing to unlock.", 400);
  if (app.submittedAt) return jsonError("This application was already submitted.", 409);
  const opp = await getOpportunity(app.opportunityId);

  const answer = async () => {
    if (owner.anonymous) return ok({ application: await applyPreview(owner.ownerId, app.id) });
    const view = await applicationView(owner.ownerId, app.id);
    const balance = await getBalance(owner.ownerId, { opportunityType: opp?.type ?? null }).catch(() => null);
    return ok({ application: view, balance: balance ? roomBalance(balance) : null });
  };
  if (isUnlocked(app)) return answer();

  if (body.method === "credit") {
    if (owner.anonymous) return fail("sign_in", "Sign in to use a credit; or unlock this one application without an account.", 401);
    try {
      await unlockWithCredit(owner.ownerId, app.id, opp?.type ?? null);
      return answer();
    } catch (err) {
      return fromError(err);
    }
  }

  // Pay once: Stripe Checkout, back to this application afterwards.
  try {
    const payments = paymentsEnabled("single", { adminTester: Boolean(owner.email && isAdminEmail(owner.email)) });
    if (!payments.ok) return fail(payments.code, payments.reason, 503);
    const price = priceIdFor("single");
    if (!price) return fail("price_missing", "Unlocking isn't available yet. Please try again in a few minutes.", 503);

    let customer: string | undefined;
    if (!owner.anonymous) {
      const user = (await getUserRow(owner.ownerId)) ?? (await ensureUser());
      customer = await ensureStripeCustomer(user);
    }
    const origin = IS_PRODUCTION_DEPLOY ? SITE.url : new URL(req.url).origin;
    const metadata = { ...checkoutMetadata(owner.ownerId, "single"), applicationId: app.id };
    // A signed-out buyer returns to the apply page (it settles the session); an account to its room.
    const back = owner.anonymous ? localizePath(applyPath(app.opportunityId), body.locale) : localizePath(`/app/applications/${app.id}`, body.locale);
    const suffix = statementSuffix();
    const target = opp ? (opp.orgName && !opp.name.includes(opp.orgName) ? `${opp.name} (${opp.orgName})` : opp.name) : "your application";

    const checkout = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        ...(customer ? { customer } : {}),
        client_reference_id: owner.ownerId,
        line_items: [{ price, quantity: 1 }],
        metadata,
        locale: stripeLocale(body.locale),
        payment_intent_data: {
          metadata,
          description: `${CHECKOUT_BRAND.displayName}: ${SINGLE.name.en} — ${target}`.slice(0, 1000),
          ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
        },
        allow_promotion_codes: true,
        success_url: `${origin}${back}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${back}?checkout=cancelled`,
        branding_settings: {
          display_name: CHECKOUT_BRAND.displayName,
          button_color: CHECKOUT_BRAND.buttonColor,
          border_style: "rounded",
          icon: { type: "url", url: CHECKOUT_BRAND.iconUrl },
        },
        custom_text: { submit: { message: CHECKOUT_BRAND.unlockNote } },
      },
      // Same owner + same application + same attempt → the same open session, however often the button is pressed.
      { idempotencyKey: `os-unlock-${owner.ownerId}-${app.id}-${body.nonce}` },
    );
    if (!checkout.url) throw new Error("Stripe returned a Checkout Session without a URL");
    return Response.json({ url: checkout.url }, { headers: NO_STORE });
  } catch (err) {
    if (isIdempotencyError(err)) return fail("stale", "That checkout attempt expired. Please press the button again.", 409);
    await captureError(err, { route: "/api/drafts/unlock", context: { ownerId: owner.ownerId, applicationId: app.id } });
    return fail("failed", "We couldn’t open checkout. Please try again in a moment.", 500);
  }
});
