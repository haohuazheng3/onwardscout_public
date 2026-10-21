import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type Stripe from "stripe";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/billing/AutoRefresh";
import { PurchaseEvents } from "@/components/billing/PurchaseEvents";
import { ButtonLink, Container, Pane, Skeleton, StatPane, Tag } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { localizePath } from "@/i18n/paths";
import { routing, type Locale } from "@/i18n/routing";
import { orderOwner } from "@/lib/account";
import { checkoutRef, grantFromCheckoutSession, isCheckoutSessionId } from "@/lib/billing";
import { getBalance } from "@/lib/credits";
import { captureError } from "@/lib/errors";
import { shortRef } from "@/lib/ids";
import { rateLimit } from "@/lib/ratelimit";
import { SITE } from "@/lib/site";
import { stripe } from "@/lib/stripe";
import { requireUser } from "@/lib/user";
import { isPlanSku, OFFERS, offerName } from "@/content/plans";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "billing.success" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Container size="sm" className="pb-16 pt-8 sm:pt-14">
      {children}
    </Container>
  );
}

/** A full-width message pane for the states that are not "granted". */
function Notice({
  title,
  body,
  tag,
  role = "alert",
  actions,
  children,
}: {
  title: string;
  body: ReactNode;
  tag?: ReactNode;
  role?: "alert" | "status";
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Shell>
      <Pane pad="lg" role={role}>
        {tag}
        <h1 className="headline mt-4 text-[1.7rem] text-ink sm:text-[2rem]">{title}</h1>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-3">{body}</p>
        {children}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">{actions}</div>
      </Pane>
    </Shell>
  );
}

const mailTag = (chunks: ReactNode) => (
  <a href={`mailto:${SITE.supportEmail}`} className="link">
    {chunks}
  </a>
);

/**
 * Primary grant path: verify the Checkout Session with Stripe right here, add the credits on the
 * spot (idempotent per session for packs, per invoice period for Pro) and show the new balance.
 * The webhook and the daily reconcile cron are the fallbacks.
 */
export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  if (!hasLocale(routing.locales, raw)) notFound();
  const locale: Locale = raw;
  setRequestLocale(locale);

  const sp = await searchParams;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : "";
  const here = `${localizePath("/checkout/success", locale)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`;
  const { userId } = await requireUser({ locale, returnTo: here });
  if (!isCheckoutSessionId(sessionId)) redirect({ href: "/app/billing", locale });

  const [t, format] = await Promise.all([getTranslations({ locale, namespace: "billing.success" }), getFormatter({ locale })]);
  const ref = checkoutRef(sessionId);
  const support = { mail: mailTag, email: SITE.supportEmail };
  const homeLink = (variant: "primary" | "ghost" = "ghost") => (
    <ButtonLink href="/app" variant={variant} size="lg" prefetch={false}>
      {t("ctaHome")}
    </ButtonLink>
  );
  const writeLink = (
    <ButtonLink href={`mailto:${SITE.supportEmail}?subject=${encodeURIComponent(`Checkout ${ref}`)}`} variant="primary" size="lg">
      {t("contact")}
    </ButtonLink>
  );

  // A session already recorded for another account is refused before Stripe is asked anything.
  const known = await orderOwner(sessionId);
  if (known && known !== userId) {
    return <Notice title={t("otherTitle")} body={t.rich("otherBody", support)} actions={<>{homeLink("primary")}</>} />;
  }
  // One account may only confirm so many sessions per window: the page is not a Stripe proxy.
  const rl = await rateLimit(`success:${userId}`, 30, 600);
  if (!rl.ok) {
    return <Notice title={t("rateTitle")} body={t("rateBody")} actions={<>{homeLink("primary")}</>} />;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.latest_invoice", "subscription.latest_invoice.payments", "payment_intent.latest_charge"],
    });
  } catch (err) {
    await captureError(err, { route: "/checkout/success", context: { sessionId, userId } });
    return (
      <Notice
        title={t("errorTitle")}
        body={t.rich("errorBody", { ...support, ref })}
        actions={
          <>
            {writeLink}
            {homeLink()}
          </>
        }
      />
    );
  }

  // A session link is not a bearer token: only the account that started the checkout may claim it.
  if (session.client_reference_id !== userId) {
    await captureError(new Error("checkout session opened by another account"), {
      route: "/checkout/success",
      severity: "warn",
      context: { sessionId, userId, owner: session.client_reference_id },
    });
    return <Notice title={t("otherTitle")} body={t.rich("otherBody", support)} actions={<>{homeLink("primary")}</>} />;
  }

  if (session.status === "expired") {
    return (
      <Notice
        title={t("expiredTitle")}
        body={t("expiredBody")}
        actions={
          <ButtonLink href="/pricing" variant="primary" size="lg" prefetch={false}>
            {t("backToPricing")}
          </ButtonLink>
        }
      />
    );
  }

  if (session.status === "open" || session.payment_status === "unpaid") {
    return (
      <Notice
        role="status"
        tag={<Tag tone="accent" dot>{t("confirmingTag")}</Tag>}
        title={t("confirmingTitle")}
        body={t("confirmingBody")}
        actions={homeLink()}
      >
        <AutoRefresh seconds={4} max={30} />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" aria-hidden="true">
          <Skeleton className="h-24 rounded-[20px]" />
          <Skeleton className="h-24 rounded-[20px]" />
        </div>
        <p className="mt-5 text-[0.9rem] leading-relaxed text-ink-4">{t("confirmingLeave")}</p>
      </Notice>
    );
  }

  const grant = await grantFromCheckoutSession(session, "success_page");
  if (!grant.ok) {
    await captureError(new Error(`success page could not grant: ${grant.reason}`), {
      route: "/checkout/success",
      context: { sessionId, userId, reason: grant.reason },
    });
    return (
      <Notice
        title={t("mismatchTitle")}
        body={t.rich("mismatchBody", { ...support, ref })}
        actions={
          <>
            {writeLink}
            {homeLink()}
          </>
        }
      />
    );
  }

  const balance = await getBalance(userId);
  const offer = OFFERS[grant.sku];
  const plan = isPlanSku(grant.sku);
  const name = offerName(grant.sku, locale);
  const paid =
    grant.amountTotal > 0
      ? t("paid", { amount: format.number(grant.amountTotal / 100, { style: "currency", currency: grant.currency.toUpperCase() }) })
      : t("promo");

  return (
    <Shell>
      <PurchaseEvents sessionId={session.id} sku={grant.sku} amount={grant.amountTotal} currency={grant.currency} />
      <Pane pad="lg">
        <Tag tone="ok" dot>
          {t("paidTag", { ref: grant.orderId ? shortRef(grant.orderId) : ref })}
        </Tag>
        <h1 className="display mt-4 text-[2.2rem] text-ink sm:text-[2.7rem]">{plan ? t("titlePlan") : t("titlePack")}</h1>
        <p className="mt-3 max-w-xl text-[1.02rem] leading-relaxed text-ink-3">
          {plan ? t("bodyPlan", { credits: offer.credits }) : t("bodyPack", { name, credits: offer.credits })}
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <StatPane label={t("added")} value={grant.credits} tone="accent" hint={t("addedHint", { date: grant.expiresAt })} />
          <StatPane
            label={t("balance")}
            value={balance.available}
            tone="pine"
            hint={balance.reserved > 0 ? t("balanceHintHeld", { count: balance.reserved }) : t("balanceHintIdle")}
          />
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/app/scout" variant="primary" size="lg" prefetch={false}>
            {t("ctaScout")}
          </ButtonLink>
          {homeLink()}
        </div>

        <div className="pane-inset mt-6 px-5 py-4 text-[0.92rem] leading-relaxed text-ink-3">
          <p>
            <strong className="text-ink">{paid}</strong> {t("receipt")}
          </p>
          <p className="mt-2">
            {plan ? `${t("manage")} ` : null}
            <Link href="/app/billing" prefetch={false} className="link">
              {t("ctaBilling")}
            </Link>
          </p>
        </div>
      </Pane>
    </Shell>
  );
}
