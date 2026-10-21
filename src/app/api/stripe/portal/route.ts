import { z } from "zod";
import { env, IS_PRODUCTION_DEPLOY } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { SITE } from "@/lib/site";
import { stripe, stripeLocale, stripeMode } from "@/lib/stripe";
import { ensureUser, isResponse, requireUserApi } from "@/lib/user";
import { localizePath } from "@/i18n/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const Body = z.object({ locale: z.enum(["en", "zh"]).optional().default("en") });

function fail(code: string, error: string, status: number): Response {
  return Response.json({ error, code }, { status, headers: NO_STORE });
}

/** POST /api/stripe/portal {locale?} → {url}: Stripe's billing portal (cancel Pro, invoices, card, billing email). */
export async function POST(req: Request) {
  const session = await requireUserApi();
  if (isResponse(session)) return session;

  try {
    const rl = await rateLimit(`portal:${session.userId}`, 10, 300);
    if (!rl.ok) return tooMany(rl);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const locale = parsed.success ? parsed.data.locale : "en";
    if (stripeMode() === "missing") return fail("not_configured", "Billing is not configured yet.", 503);

    const user = await ensureUser(session);
    if (!user.stripeCustomerId) {
      return fail("no_customer", "No billing history yet. The portal opens after your first purchase.", 409);
    }

    const origin = IS_PRODUCTION_DEPLOY ? SITE.url : new URL(req.url).origin;
    // The Onward Scout portal configuration (cancellation, invoices, our name and policy links) is
    // created by scripts/ops/stripe-bootstrap.mjs; without it Stripe's account default applies.
    const configuration = env("STRIPE_PORTAL_CONFIG");
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}${localizePath("/app/billing", locale)}`,
      locale: stripeLocale(locale),
      ...(configuration ? { configuration } : {}),
    });
    return Response.json({ url: portal.url }, { headers: NO_STORE });
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    // The stored customer belongs to another Stripe account (the project moved accounts) and has no history here.
    if (e.code === "resource_missing") return fail("no_customer", "No billing history on this account yet. The portal opens after your next purchase.", 409);
    await captureError(err, { route: "/api/stripe/portal", context: { userId: session.userId } });
    return fail("failed", "We couldn’t open the billing portal. Please try again in a moment.", 500);
  }
}
