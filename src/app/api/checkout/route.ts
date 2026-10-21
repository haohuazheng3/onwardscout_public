import { z } from "zod";
import { ensureStripeCustomer } from "@/lib/billing";
import { currentPlan } from "@/lib/account";
import { IS_PRODUCTION_DEPLOY } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { SITE } from "@/lib/site";
import { CHECKOUT_BRAND, checkoutMetadata, paymentsEnabled, priceIdFor, statementSuffix, stripe, stripeLocale } from "@/lib/stripe";
import { ensureUser, isResponse, requireUserApi } from "@/lib/user";
import { localizePath } from "@/i18n/paths";
import { OFFERS, SKUS } from "@/content/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * `nonce` is minted by the browser once per purchase attempt: double taps, retries and a refresh
 * of the same attempt reuse one Checkout Session through Stripe's idempotency key. `from` decides
 * where Stripe's back link returns to; `locale` localizes the return pages and Stripe's own page.
 */
const Body = z.object({
  sku: z.enum(SKUS as [string, ...string[]]),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  locale: z.enum(["en", "zh"]).optional().default("en"),
  from: z.enum(["pricing", "billing"]).optional().default("pricing"),
});

function fail(code: string, error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, code, ...extra }, { status, headers: NO_STORE });
}

function isIdempotencyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "StripeIdempotencyError";
}

/** POST /api/checkout {sku, nonce, locale?, from?} → {url}. Signed-in people only; one Stripe customer per user. */
export async function POST(req: Request) {
  const session = await requireUserApi();
  if (isResponse(session)) return session;

  try {
    const [byUser, byIp] = await Promise.all([
      rateLimit(`checkout:u:${session.userId}`, 10, 300),
      rateLimit(`checkout:ip:${ipHash(clientIp(req.headers))}`, 20, 300),
    ]);
    if (!byUser.ok) return tooMany(byUser);
    if (!byIp.ok) return tooMany(byIp);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("invalid", "Pick Pro or a credit pack to continue.", 400);
    const { nonce, locale, from } = parsed.data;
    const sku = parsed.data.sku as (typeof SKUS)[number];
    const offer = OFFERS[sku];

    const payments = paymentsEnabled(sku);
    if (!payments.ok) return fail(payments.code, payments.reason, 503);
    const price = priceIdFor(sku);
    if (!price) return fail("price_missing", `The ${offer.name.en} price is not configured yet.`, 503);

    const user = await ensureUser(session);

    // Plan changes and cancellation go through the billing portal; a second Checkout would create a second subscription.
    if (offer.interval === "month") {
      const plan = await currentPlan(session.userId);
      if (plan.sku) {
        return fail("has_plan", "You already have Pro. Manage or cancel it from Billing.", 409, { portal: true });
      }
    }

    const customer = await ensureStripeCustomer(user);
    const origin = IS_PRODUCTION_DEPLOY ? SITE.url : new URL(req.url).origin;
    const metadata = checkoutMetadata(session.userId, sku);
    const back = localizePath(from === "billing" ? "/app/billing" : "/pricing", locale);
    const suffix = statementSuffix();

    const checkout = await stripe().checkout.sessions.create(
      {
        mode: offer.interval === "month" ? "subscription" : "payment",
        customer,
        client_reference_id: session.userId,
        line_items: [{ price, quantity: 1 }],
        metadata,
        locale: stripeLocale(locale),
        ...(offer.interval === "month"
          ? { subscription_data: { metadata, description: `${CHECKOUT_BRAND.displayName} ${offer.name.en}` } }
          : {
              payment_intent_data: {
                metadata,
                description: `${CHECKOUT_BRAND.displayName}: ${offer.name.en}`,
                ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
              },
            }),
        allow_promotion_codes: true,
        success_url: `${origin}${localizePath("/checkout/success", locale)}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}${back}?checkout=cancelled`,
        // No `expires_at`: it would change every second and clash with the idempotency key below.
        branding_settings: {
          display_name: CHECKOUT_BRAND.displayName,
          button_color: CHECKOUT_BRAND.buttonColor,
          border_style: "rounded",
          icon: { type: "url", url: CHECKOUT_BRAND.iconUrl },
        },
        custom_text: { submit: { message: CHECKOUT_BRAND.submitNote } },
      },
      // Same person + same offer + same attempt → the same open session, however often the button is pressed.
      { idempotencyKey: `os-co-${session.userId}-${sku}-${nonce}` },
    );

    if (!checkout.url) throw new Error("Stripe returned a Checkout Session without a URL");
    return Response.json({ url: checkout.url }, { headers: NO_STORE });
  } catch (err) {
    // The same attempt sent with a different body (a deploy or a language switch changed it mid-attempt).
    if (isIdempotencyError(err)) return fail("stale", "That checkout attempt expired. Please press the button again.", 409, { stale: true });
    await captureError(err, { route: "/api/checkout", context: { userId: session.userId } });
    return fail("failed", "We couldn’t open checkout. Please try again in a moment.", 500);
  }
}
