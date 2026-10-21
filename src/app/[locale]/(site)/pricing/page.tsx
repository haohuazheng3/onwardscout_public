import type { Metadata } from "next";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { BillingIntl } from "@/components/billing/BillingIntl";
import { CheckoutButton, CheckoutNotice, ResumePurchase } from "@/components/billing/CheckoutButton";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, CheckList, CtaPane, DotList, FaqList, PageHero } from "@/components/site/blocks";
import { compareRows, perCreditLabel, type CompareCell } from "@/components/site/pricing";
import { ButtonLink, Container, Section, SectionHeading, cx } from "@/components/ui";
import { faqsByGroup } from "@/content/faq";
import { CREDIT_RULES, PACKS, PLANS, TRIAL, formatPrice, type Offer, type Sku } from "@/content/plans";
import { FREE_INCLUDES, pick } from "@/content/site-copy";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { faqLd, pageMetadata, softwareApplicationLd } from "@/lib/seo";
import { features } from "@/lib/env";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.pricing" });
  return pageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription", {
      proPrice: formatPrice(PLANS.pro.priceUsd),
      proCredits: PLANS.pro.credits,
      smallCredits: PACKS.pack10.credits,
      smallPrice: formatPrice(PACKS.pack10.priceUsd),
      largeCredits: PACKS.pack40.credits,
      largePrice: formatPrice(PACKS.pack40.priceUsd),
    }),
    path: "/pricing",
    locale,
  });
}

/**
 * P4's CheckoutButton: instant pressed state, signed-out → sign-in and back to /pricing?buy=<sku>,
 * where the purchase resumes once (ResumePurchase shows it), signed-in → Stripe Checkout.
 */
function BuyButton({ sku, label, variant = "primary" }: { sku: Sku; label: string; variant?: "primary" | "ghost" | "ink" }) {
  return (
    <CheckoutButton sku={sku} variant={variant} size="lg" block from="pricing">
      {label}
    </CheckoutButton>
  );
}

function Cell({ cell, yes, no }: { cell: CompareCell; yes: string; no: string }) {
  if (cell.kind === "yes") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-pine-soft text-pine">
          <Check size={14} strokeWidth={2.6} aria-hidden />
        </span>
        <span className="sr-only">{yes}</span>
      </span>
    );
  }
  if (cell.kind === "no") {
    return (
      <span className="inline-flex items-center text-ink-4">
        <Minus size={16} aria-hidden />
        <span className="sr-only">{no}</span>
      </span>
    );
  }
  return <span className="text-[0.92rem] leading-snug text-ink-2">{cell.text}</span>;
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });
  const tp = await getTranslations({ locale, namespace: "site.pricing" });
  const tcmp = await getTranslations({ locale, namespace: "site.pricing.compare" });
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };

  const pro = PLANS.pro;
  const packs: Offer[] = [PACKS.pack10, PACKS.pack40];
  // Read at build time (the page is static): the email brief shows "coming soon" until product email is on.
  const rows = compareRows((key, values) => tcmp(key, values), { mailer: features().mailer });
  const billingFaqs = faqsByGroup("billing").map((f) => ({
    id: f.id,
    q: pick(f.q, locale),
    a: pick(f.a, locale),
    more: f.more ? { href: f.more.href, label: pick(f.more.label, locale) } : undefined,
  }));
  const yesLabel = tcmp("included");
  const noLabel = tcmp("notIncluded");
  const plans = [
    { key: "free" as const, name: tcmp("free") },
    { key: "packs" as const, name: tcmp("packs") },
    { key: "pro" as const, name: tcmp("pro") },
  ];

  return (
    // Client components on this page (buy buttons, resume, cancelled notice) need the `billing` wording.
    <BillingIntl locale={locale}>
      <JsonLd
        data={[
          softwareApplicationLd(
            [pro, ...packs].map((o) => ({
              sku: o.sku,
              name: o.name[locale],
              priceUsd: o.priceUsd,
              interval: o.interval === "month" ? "month" : "once",
              description: o.blurb[locale],
            })),
            locale,
          ),
          faqLd(billingFaqs.map((f) => ({ q: f.q, a: f.a }))),
        ]}
      />

      <PageHero
        crumbs={
          <Breadcrumbs
            locale={locale}
            label={t("shared.home")}
            items={[
              { name: t("shared.home"), path: "/" },
              { name: tp("metaTitle"), path: "/pricing" },
            ]}
          />
        }
        eyebrow={tp("eyebrow")}
        title={tp.rich("title", em)}
        lede={tp("lede")}
      />
      <Container className="mt-6 grid gap-3 empty:hidden">
        <ResumePurchase className="max-w-xl" />
        <CheckoutNotice className="max-w-xl" />
      </Container>

      {/* ---------- Free, Pro, packs ---------- */}
      <Section className="pt-12 sm:pt-16" size="lg">
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Free */}
          <div className="pane flex min-w-0 flex-col p-6 sm:p-8">
            <p className="eyebrow">{tp("free.name")}</p>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="num font-display text-[3rem] font-semibold leading-none text-ink">{tp("free.price")}</span>
              <span className="text-[0.92rem] text-ink-4">{tp("free.period")}</span>
            </p>
            <p className="mt-3 text-[0.96rem] leading-relaxed text-ink-3">{tp("free.blurb")}</p>
            <CheckList
              className="mt-6"
              items={[...FREE_INCLUDES.map((l) => pick(l, locale)), tp("free.trial", { credits: TRIAL.credits, days: TRIAL.expiryDays })]}
            />
            <div className="mt-auto pt-8">
              <ButtonLink href="/app/start" prefetch={false} variant="ghost" size="lg" block iconRight={<ArrowUpRight size={18} aria-hidden />}>
                {tp("free.cta")}
              </ButtonLink>
            </div>
          </div>

          {/* Pro */}
          <div id="buy-pro" className="pane-ink flex min-w-0 scroll-mt-28 flex-col p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="eyebrow eyebrow-accent">{pro.name[locale]}</p>
              <span className="tag tag-accent">{tp("recommended")}</span>
            </div>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="num font-display text-[3rem] font-semibold leading-none text-ink">{formatPrice(pro.priceUsd)}</span>
              <span className="text-[0.92rem] text-ink-4">{tp("perMonth")}</span>
            </p>
            <p className="mt-3 text-[0.96rem] text-ink-2">
              <strong className="font-semibold text-ink">{tp("creditsPerMonth", { credits: pro.credits })}</strong>
              <span className="text-ink-4"> · {tp("perCredit", { price: perCreditLabel(pro) })}</span>
            </p>
            <p className="mt-1.5 text-[0.94rem] leading-relaxed text-ink-3">{pro.blurb[locale]}</p>
            <CheckList className="mt-6" tone="accent" items={[...pro.features[locale]]} />
            <div className="mt-auto pt-8">
              <BuyButton sku="pro" label={tp("subscribe", { name: pro.name[locale] })} variant="primary" />
            </div>
          </div>

          {/* Packs */}
          <div className="pane flex min-w-0 flex-col p-6 sm:p-8">
            <p className="eyebrow">{tp("packsTitle")}</p>
            <p className="mt-3 text-[0.96rem] leading-relaxed text-ink-3">{tp("packsLede")}</p>
            <div className="mt-5 grid gap-3">
              {packs.map((o) => (
                <div key={o.sku} id={`buy-${o.sku}`} className="pane-inset min-w-0 scroll-mt-28 p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-[1.08rem] font-semibold text-ink">{tp("credits", { credits: o.credits })}</p>
                    <p className="flex items-baseline gap-1">
                      <span className="num font-display text-[1.9rem] font-semibold leading-none text-ink">{formatPrice(o.priceUsd)}</span>
                      <span className="text-[0.84rem] text-ink-4">{tp("once")}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-[0.88rem] text-ink-3">
                    {tp("perCredit", { price: perCreditLabel(o) })} · {o.blurb[locale]}
                  </p>
                  <div className="mt-4">
                    <BuyButton sku={o.sku} label={tp("buy", { credits: o.credits })} variant="ink" />
                  </div>
                </div>
              ))}
            </div>
            <DotList className="mt-5" items={PACKS.pack10.features[locale].slice(1)} />
          </div>
        </div>

        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.88rem] text-ink-3">
          {[tp("trust1"), tp("trust2"), tp("trust3"), tp("trust4")].map((line) => (
            <li key={line} className="flex items-center gap-2">
              <Check size={14} className="text-pine" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------- Credit rules ---------- */}
      <Section id="credits">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
          <SectionHeading eyebrow={tp("rules.eyebrow")} title={tp("rules.title")} className="mb-0 sm:mb-0" />
          <div className="pane min-w-0 p-6 sm:p-8">
            <DotList items={[...CREDIT_RULES.lines[locale]]} />
          </div>
        </div>
      </Section>

      {/* ---------- Comparison ---------- */}
      <Section id="compare">
        <SectionHeading eyebrow={tcmp("eyebrow")} title={tcmp("title")} />
        {/* Phones: one pane per plan. */}
        <div className="grid gap-4 md:hidden">
          {plans.map((p) => (
            <div key={p.key} className={cx("min-w-0 p-5", p.key === "pro" ? "pane-ink" : "pane")}>
              <p className={cx("eyebrow", p.key === "pro" && "eyebrow-accent")}>{p.name}</p>
              <dl className="mt-3 divide-y divide-[var(--line)]">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-4 py-2.5">
                    <dt className="min-w-0 text-[0.9rem] text-ink-3">{r.label}</dt>
                    <dd className="shrink-0 text-right">
                      <Cell cell={r[p.key]} yes={yesLabel} no={noLabel} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        {/* Wide screens: one table. */}
        <div className="pane hidden overflow-hidden md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="eyebrow w-[40%] px-7 pb-4 pt-6">
                  {tcmp("feature")}
                </th>
                {plans.map((p) => (
                  <th key={p.key} scope="col" className={cx("px-5 pb-4 pt-6 text-[1rem] font-semibold", p.key === "pro" ? "text-accent-text" : "text-ink")}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="px-7 py-4 text-[0.95rem] font-medium text-ink-2">
                    {r.label}
                  </th>
                  {plans.map((p) => (
                    <td key={p.key} className={cx("px-5 py-4 align-middle", p.key === "pro" && "bg-accent-soft/40")}>
                      <Cell cell={r[p.key]} yes={yesLabel} no={noLabel} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---------- Paying ---------- */}
      <Section id="billing">
        <SectionHeading eyebrow={tp("billing.eyebrow")} title={tp("billing.title")} />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="pane min-w-0 p-6">
            <p className="text-[1.04rem] font-semibold text-ink">{tp("billing.refundsTitle")}</p>
            <p className="mt-2 text-[0.94rem] leading-relaxed text-ink-3">{tp("billing.refundsBody")}</p>
            <Link href="/refund-policy" className="link mt-3 inline-block text-[0.92rem]">
              {tp("billing.refundsLink")}
            </Link>
          </div>
          <div className="pane min-w-0 p-6">
            <p className="text-[1.04rem] font-semibold text-ink">{tp("billing.checkoutTitle")}</p>
            <p className="mt-2 text-[0.94rem] leading-relaxed text-ink-3">{tp("billing.checkoutBody")}</p>
          </div>
          <div className="pane min-w-0 p-6">
            <p className="text-[1.04rem] font-semibold text-ink">{tp("billing.changeTitle")}</p>
            <p className="mt-2 text-[0.94rem] leading-relaxed text-ink-3">{tp("billing.changeBody")}</p>
          </div>
        </div>
      </Section>

      {/* ---------- Billing FAQ ---------- */}
      <Section id="faq" size="sm">
        <SectionHeading
          eyebrow={tp("faq.eyebrow")}
          title={tp("faq.title")}
          action={
            <ButtonLink href="/faq" variant="ghost">
              {t("shared.readAllFaq")}
            </ButtonLink>
          }
        />
        <FaqList items={billingFaqs} />
      </Section>

      <Section>
        <CtaPane
          title={tp.rich("cta.title", em)}
          body={tp("cta.body", { credits: TRIAL.credits })}
          primary={{ label: t("shared.startFree"), href: "/app/start" }}
          secondary={{ label: t("shared.seeHowItWorks"), href: "/how-it-works" }}
        />
      </Section>
    </BillingIntl>
  );
}
