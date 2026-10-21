import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight, Hand, Lock, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { LogoMark } from "@/components/Logo";
import { BoundaryTable } from "@/components/site/BoundaryTable";
import { CheckList, CtaPane, FaqList, StepNumber } from "@/components/site/blocks";
import { HeroDemo, type HeroDemoCopy } from "@/components/site/HeroDemo";
import { TypeIcon } from "@/components/site/TypeIcon";
import { ButtonLink, Container, Section, SectionHeading } from "@/components/ui";
import { AUDIENCE_CONTENT } from "@/content/audiences";
import { HOME_FAQ_IDS, faqsById } from "@/content/faq";
import { PACKS, PLANS, TRIAL, formatPrice } from "@/content/plans";
import { FREE_INCLUDES, HOME_TYPES, PRINCIPLES, STEPS, pick, type PrincipleId } from "@/content/site-copy";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { OPPORTUNITY_TYPES, getOpportunityType, opportunityTypeLabel } from "@/lib/core/opportunity-types";
import { pageMetadata, softwareApplicationLd } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.home" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/", locale, absoluteTitle: true });
}

const PRINCIPLE_ICONS: Record<PrincipleId, typeof ShieldCheck> = {
  "true-facts": ShieldCheck,
  "your-tap": Hand,
  "your-data": Lock,
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "site" }), getTranslations({ locale, namespace: "common" })]);
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };

  const d = (k: string) => t(`home.demo.${k}`);
  const demo: HeroDemoCopy = {
    example: d("example"),
    exampleNote: d("exampleNote"),
    summary: d("summary"),
    dropTitle: d("dropTitle"),
    dropHint: d("dropHint"),
    fileName: d("fileName"),
    fileMeta: d("fileMeta"),
    reading: d("reading"),
    found: d("found"),
    profileTitle: d("profileTitle"),
    profileNote: d("profileNote"),
    chips: [d("chip1"), d("chip2"), d("chip3"), d("chip4"), d("chip5"), d("chip6")],
    picksTitle: d("picksTitle"),
    cards: [
      { type: d("card1Type"), title: d("card1Title"), meta: d("card1Meta"), fit: t("home.demo.fit", { score: 86 }) },
      { type: d("card2Type"), title: d("card2Title"), meta: d("card2Meta"), fit: t("home.demo.fit", { score: 74 }) },
      { type: d("card3Type"), title: d("card3Title"), meta: d("card3Meta"), fit: t("home.demo.fit", { score: 69 }) },
    ],
    prepared: d("prepared"),
    submit: d("submit"),
    yourTap: d("yourTap"),
    submitted: d("submitted"),
    evidence: d("evidence"),
    handoff: d("handoff"),
    handoffWhy: d("handoffWhy"),
    drafting: d("drafting"),
    pause: d("pause"),
    play: d("play"),
  };

  const allTypes = OPPORTUNITY_TYPES.filter((o) => o.group !== "system").length;
  const faqs = faqsById(HOME_FAQ_IDS).map((f) => ({
    id: f.id,
    q: pick(f.q, locale),
    a: pick(f.a, locale),
    more: f.more ? { href: f.more.href, label: pick(f.more.label, locale) } : undefined,
  }));
  const pro = PLANS.pro;

  return (
    <>
      <JsonLd
        data={softwareApplicationLd(
          [pro, PACKS.pack10, PACKS.pack40].map((o) => ({
            sku: o.sku,
            name: o.name[locale],
            priceUsd: o.priceUsd,
            interval: o.interval === "month" ? "month" : "once",
            description: o.blurb[locale],
          })),
          locale,
        )}
      />

      {/* ---------- Hero: the promise in the field, the example floating below it ---------- */}
      <Container className="pt-10 sm:pt-16 lg:pt-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="eyebrow eyebrow-dot eyebrow-accent justify-center">{t("home.hero.eyebrow")}</p>
          <h1 className="display mt-5 text-[2.9rem] text-ink sm:text-[4.4rem] lg:text-[5.2rem]">{t.rich("home.hero.title", em)}</h1>
          <p className="dek mx-auto mt-6 max-w-2xl text-[1.14rem] sm:text-[1.3rem]">{t("home.hero.lede")}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/app/start" prefetch={false} size="lg" iconRight={<ArrowUpRight size={18} aria-hidden />}>
              {t("home.hero.primary")}
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="ghost" size="lg">
              {t("home.hero.secondary")}
            </ButtonLink>
          </div>
          <p className="mx-auto mt-5 max-w-md text-[0.88rem] leading-relaxed text-ink-4">{t("shared.freeLine", { credits: TRIAL.credits })}</p>
        </div>
        <HeroDemo copy={demo} className="mx-auto mt-12 max-w-[1100px] sm:mt-16" />
      </Container>

      {/* ---------- Early access: the honest social-proof slot ---------- */}
      <Section className="pt-16 sm:pt-20">
        <div className="pane-glass flex flex-col gap-4 rounded-[var(--radius-pane)] px-6 py-6 sm:flex-row sm:items-center sm:gap-6 sm:px-8">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-pane-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <LogoMark size={26} />
          </span>
          <div className="min-w-0">
            <p className="title text-[1.2rem] text-ink">{t("home.early.title")}</p>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-3">{t("home.early.body")}</p>
          </div>
        </div>
      </Section>

      {/* ---------- Who it's for ---------- */}
      <Section id="who">
        <SectionHeading eyebrow={t("home.audiences.eyebrow")} title={t("home.audiences.title")} lede={t("home.audiences.lede")} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => {
            const key = audienceKey(a);
            return (
              <li key={a} className="min-w-0">
                <Link href={`/for/${a}`} className="pane pane-hover group flex h-full min-w-0 flex-col p-6 sm:p-7">
                  <span className="flex items-center justify-between gap-3">
                    <span className="title text-[1.3rem] text-ink">{tc(`audiences.${key}`)}</span>
                    <ArrowRight size={18} className="shrink-0 text-ink-4 transition-transform group-hover:translate-x-1" aria-hidden />
                  </span>
                  <span className="mt-2 text-[0.96rem] leading-relaxed text-ink-3">{tc(`audiences.${key}Blurb`)}</span>
                  <span className="mt-auto pt-5 text-[0.82rem] font-medium text-accent-text">{pick(AUDIENCE_CONTENT[a].teaser, locale)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ---------- What it finds ---------- */}
      <Section id="finds">
        <SectionHeading eyebrow={t("home.finds.eyebrow")} title={t("home.finds.title")} lede={t("home.finds.lede")} />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {HOME_TYPES.map((id) => {
            const def = getOpportunityType(id);
            return (
              <li key={id} className="min-w-0">
                <Link
                  href={def.publicSeo ? `/opportunities/${def.slug}` : "/opportunities"}
                  locale="en"
                  className="pane pane-hover flex h-full min-h-[64px] min-w-0 items-center gap-3 rounded-[22px] px-3.5 py-3 sm:px-4"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-pine-soft text-pine">
                    <TypeIcon type={id} size={18} />
                  </span>
                  <span className="min-w-0 text-[0.92rem] font-medium leading-snug text-ink-2">{opportunityTypeLabel(id, locale, true)}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <Link
              href="/opportunities"
              locale="en"
              className="pane-ink press flex h-full min-h-[64px] min-w-0 items-center justify-between gap-2 rounded-[22px] px-4 py-3"
            >
              <span className="min-w-0 text-[0.92rem] font-semibold leading-snug text-ink">{t("home.finds.more", { count: allTypes })}</span>
              <ArrowRight size={17} className="shrink-0 text-accent-text" aria-hidden />
            </Link>
          </li>
        </ul>
      </Section>

      {/* ---------- How it works ---------- */}
      <Section id="how">
        <SectionHeading
          eyebrow={t("home.steps.eyebrow")}
          title={t("home.steps.title")}
          lede={t("home.steps.lede")}
          action={
            <ButtonLink href="/how-it-works" variant="ghost" iconRight={<ArrowRight size={17} aria-hidden />}>
              {t("home.steps.more")}
            </ButtonLink>
          }
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.id} className="pane flex min-w-0 flex-col p-6 sm:p-7">
              <StepNumber n={i + 1} />
              <p className="title mt-4 text-[1.2rem] text-ink">{pick(s.title, locale)}</p>
              <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-3">{pick(s.body, locale)}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---------- The honest boundary ---------- */}
      <Section id="boundary">
        <SectionHeading eyebrow={t("home.boundary.eyebrow")} title={t("home.boundary.title")} lede={t("home.boundary.lede")} />
        <BoundaryTable
          locale={locale}
          labels={{ step: t("home.boundary.colStep"), who: t("home.boundary.colWho"), how: t("home.boundary.colHow") }}
        />
      </Section>

      {/* ---------- Principles ---------- */}
      <Section id="principles">
        <SectionHeading eyebrow={t("home.principles.eyebrow")} title={t("home.principles.title")} />
        <div className="grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((p) => {
            const Icon = PRINCIPLE_ICONS[p.id];
            return (
              <div key={p.id} className="pane min-w-0 p-6 sm:p-7">
                <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-accent-soft text-accent-text">
                  <Icon size={21} aria-hidden />
                </span>
                <p className="title mt-5 text-[1.3rem] text-ink">{pick(p.title, locale)}</p>
                <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-3">{pick(p.body, locale)}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---------- Pricing teaser ---------- */}
      <Section id="pricing">
        <SectionHeading
          eyebrow={t("home.pricing.eyebrow")}
          title={t("home.pricing.title")}
          lede={t("home.pricing.lede")}
          action={
            <ButtonLink href="/pricing" variant="ghost" iconRight={<ArrowRight size={17} aria-hidden />}>
              {t("home.pricing.cta")}
            </ButtonLink>
          }
        />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="pane flex min-w-0 flex-col p-6 sm:p-7">
            <p className="eyebrow">{t("home.pricing.freeName")}</p>
            <p className="num mt-3 font-display text-[2.6rem] font-semibold leading-none text-ink">{t("home.pricing.freePrice")}</p>
            <p className="mt-2 text-[0.92rem] text-ink-3">{t("home.pricing.freeNote", { credits: TRIAL.credits, days: TRIAL.expiryDays })}</p>
            <CheckList className="mt-5" items={FREE_INCLUDES.slice(0, 4).map((l) => pick(l, locale))} />
          </div>
          <div className="pane-ink flex min-w-0 flex-col p-6 sm:p-7">
            <p className="eyebrow eyebrow-accent">{pro.name[locale]}</p>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="num font-display text-[2.6rem] font-semibold leading-none text-ink">{formatPrice(pro.priceUsd)}</span>
              <span className="text-[0.92rem] text-ink-4">{t("home.pricing.perMonth")}</span>
            </p>
            <p className="mt-2 text-[0.92rem] text-ink-3">{t("home.pricing.proNote", { credits: pro.credits })}</p>
            <CheckList className="mt-5" tone="accent" items={pro.features[locale].slice(1, 5)} />
          </div>
          <div className="pane flex min-w-0 flex-col p-6 sm:p-7">
            <p className="eyebrow">{t("home.pricing.packsName")}</p>
            <p className="num mt-3 font-display text-[2.6rem] font-semibold leading-none text-ink">{formatPrice(PACKS.pack10.priceUsd)}+</p>
            <p className="mt-2 text-[0.92rem] text-ink-3">
              {t("home.pricing.packsNote", {
                small: PACKS.pack10.credits,
                smallPrice: formatPrice(PACKS.pack10.priceUsd),
                large: PACKS.pack40.credits,
                largePrice: formatPrice(PACKS.pack40.priceUsd),
              })}
            </p>
            <CheckList
              className="mt-5"
              items={[t("home.pricing.packsValid", { days: PACKS.pack10.rolloverDays }), ...PACKS.pack10.features[locale].slice(1)]}
            />
          </div>
        </div>
      </Section>

      {/* ---------- FAQ teaser ---------- */}
      <Section id="faq" size="sm">
        <SectionHeading
          eyebrow={t("home.faq.eyebrow")}
          title={t("home.faq.title")}
          action={
            <ButtonLink href="/faq" variant="ghost" iconRight={<ArrowRight size={17} aria-hidden />}>
              {t("shared.readAllFaq")}
            </ButtonLink>
          }
        />
        <FaqList items={faqs} />
      </Section>

      {/* ---------- Final call to action ---------- */}
      <Section>
        <CtaPane
          title={t.rich("home.final.title", em)}
          body={t("home.final.body")}
          primary={{ label: t("home.final.primary"), href: "/app/start" }}
          secondary={{ label: t("home.final.secondary"), href: "/pricing" }}
        />
      </Section>
    </>
  );
}
