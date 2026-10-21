import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight, Info } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs, CheckList, CtaPane, DotList, FaqList, PageHero } from "@/components/site/blocks";
import { TypeIcon } from "@/components/site/TypeIcon";
import { ButtonLink, Callout, Section, SectionHeading, Tag } from "@/components/ui";
import { audienceContent } from "@/content/audiences";
import { pick } from "@/content/site-copy";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { getOpportunityType, opportunityTypeLabel } from "@/lib/core/opportunity-types";
import { pageMetadata } from "@/lib/seo";

type Props = { params: Promise<{ locale: string; audience: string }> };

/** Exactly the six audiences; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams(): { audience: string }[] {
  return AUDIENCES.map((audience) => ({ audience }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, audience } = await params;
  const content = audienceContent(audience);
  if (!hasLocale(routing.locales, locale) || !content) return {};
  return pageMetadata({
    title: pick(content.metaTitle, locale),
    description: pick(content.metaDescription, locale),
    path: `/for/${content.slug}`,
    locale,
  });
}

export default async function AudiencePage({ params }: Props) {
  const { locale, audience } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const c = audienceContent(audience);
  if (!c) notFound();

  const [t, tc] = await Promise.all([getTranslations({ locale, namespace: "site" }), getTranslations({ locale, namespace: "common" })]);
  const name = tc(`audiences.${audienceKey(c.slug)}`);
  const others = AUDIENCES.filter((a) => a !== c.slug);
  const faqs = c.faqs.map((f, i) => ({ id: `q-${i + 1}`, q: pick(f.q, locale), a: pick(f.a, locale) }));

  return (
    <>
      <PageHero
        crumbs={
          <Breadcrumbs
            locale={locale}
            label={t("shared.home")}
            items={[
              { name: t("shared.home"), path: "/" },
              { name: name, path: `/for/${c.slug}` },
            ]}
          />
        }
        eyebrow={pick(c.eyebrow, locale)}
        title={pick(c.title, locale)}
        lede={pick(c.lede, locale)}
        actions={
          <>
            <ButtonLink href="/app/start" prefetch={false} size="lg" iconRight={<ArrowUpRight size={18} aria-hidden />}>
              {t("shared.startFree")}
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="ghost" size="lg">
              {t("shared.seeHowItWorks")}
            </ButtonLink>
          </>
        }
      />

      {/* ---------- Goals ---------- */}
      <Section className="pt-14 sm:pt-20">
        <SectionHeading eyebrow={t("audience.goalsEyebrow")} title={t("audience.goalsTitle")} />
        <div className="grid gap-4 md:grid-cols-2">
          {c.goals.map((g) => (
            <div key={g.title.en} className="pane flex min-w-0 flex-col p-6 sm:p-7">
              <h3 className="title text-[1.3rem] text-ink">{pick(g.title, locale)}</h3>
              <p className="mt-2 text-[0.97rem] leading-relaxed text-ink-3">{pick(g.body, locale)}</p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
                {g.types.map((id) => (
                  <span key={id} className="tag gap-1.5">
                    <TypeIcon type={id} size={13} className="text-pine" />
                    {opportunityTypeLabel(id, locale, true)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- Opportunity types ---------- */}
      <Section id="types">
        <SectionHeading eyebrow={t("audience.typesEyebrow")} title={t("audience.typesTitle")} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {c.types.map(({ id, why }) => {
            const def = getOpportunityType(id);
            return (
              <li key={id} className="min-w-0">
                <Link
                  href={def.publicSeo ? `/opportunities/${def.slug}` : "/opportunities"}
                  locale="en"
                  className="pane pane-hover group flex h-full min-w-0 gap-3.5 p-5"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-pine-soft text-pine">
                    <TypeIcon type={id} size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[1rem] font-semibold text-ink">
                      {opportunityTypeLabel(id, locale, true)}
                      <ArrowRight size={14} className="shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <span className="mt-1 block text-[0.9rem] leading-relaxed text-ink-3">{pick(why, locale)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ---------- Worked example ---------- */}
      <Section id="example">
        <div className="pane-ink overflow-hidden p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <p className="eyebrow eyebrow-dot eyebrow-accent">{t("audience.exampleEyebrow")}</p>
            <Tag tone="accent">{t("shared.example")}</Tag>
          </div>
          <h2 className="headline mt-4 max-w-3xl text-[1.8rem] text-ink sm:text-[2.3rem]">{pick(c.example.persona, locale)}</h2>
          <p className="mt-2 text-[0.88rem] text-ink-4">{t("shared.exampleNote")}</p>
          <ol className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {c.example.steps.map((s, i) => (
              <li key={i} className="min-w-0 rounded-[var(--radius-inner)] bg-pane-2 p-5 shadow-[inset_0_0_0_1px_var(--line)]">
                <p className="flex items-center gap-2.5">
                  <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.8rem] font-semibold text-accent-text">
                    {i + 1}
                  </span>
                  <span className="text-[0.82rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{pick(s.label, locale)}</span>
                </p>
                <p className="mt-3 text-[0.97rem] leading-relaxed text-ink-2">{pick(s.text, locale)}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* ---------- Uploads and the weekly loop ---------- */}
      <Section id="uploads">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="pane min-w-0 p-6 sm:p-8">
            <p className="eyebrow eyebrow-dot">{t("audience.uploadsEyebrow")}</p>
            <h2 className="headline mt-3 text-[1.6rem] text-ink sm:text-[1.9rem]">{t("audience.uploadsTitle")}</h2>
            <ul className="mt-6 grid gap-3">
              {c.uploads.map((u) => (
                <li key={u.title.en} className="pane-inset min-w-0 px-4 py-3.5">
                  <p className="text-[0.98rem] font-semibold text-ink">{pick(u.title, locale)}</p>
                  <p className="mt-0.5 text-[0.9rem] leading-relaxed text-ink-3">{pick(u.note, locale)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid min-w-0 gap-4">
            <div className="pane min-w-0 p-6 sm:p-8">
              <p className="eyebrow eyebrow-dot">{t("audience.weeklyEyebrow")}</p>
              <h2 className="headline mt-3 text-[1.6rem] text-ink sm:text-[1.9rem]">{t("audience.weeklyTitle")}</h2>
              <CheckList className="mt-6" items={c.weekly.map((l) => pick(l, locale))} />
            </div>
            <div className="pane min-w-0 p-6 sm:p-8">
              <p className="eyebrow eyebrow-dot">{t("audience.yoursEyebrow")}</p>
              <h2 className="headline mt-3 text-[1.6rem] text-ink sm:text-[1.9rem]">{t("audience.yoursTitle")}</h2>
              <DotList className="mt-6" items={c.yours.map((l) => pick(l, locale))} />
            </div>
          </div>
        </div>
        {c.note ? (
          <Callout tone="info" icon={<Info size={18} className="text-pine" aria-hidden />} className="mt-4">
            {pick(c.note, locale)}
          </Callout>
        ) : null}
      </Section>

      {/* ---------- Questions ---------- */}
      <Section id="faq" size="sm">
        <SectionHeading
          eyebrow={t("audience.faqEyebrow")}
          title={t("audience.faqTitle")}
          action={
            <ButtonLink href="/faq" variant="ghost">
              {t("shared.readAllFaq")}
            </ButtonLink>
          }
        />
        <FaqList items={faqs} />
      </Section>

      {/* ---------- The other audiences ---------- */}
      <Section>
        <p className="eyebrow">{t("audience.otherAudiences")}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((a) => (
            <li key={a}>
              <Link href={`/for/${a}`} className="chip">
                {tc(`audiences.${audienceKey(a)}`)}
                <ArrowRight size={14} className="text-ink-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section className="pt-10 sm:pt-14">
        <CtaPane
          title={t("audience.ctaTitle")}
          body={t("audience.ctaBody")}
          primary={{ label: t("shared.startFree"), href: "/app/start" }}
          secondary={{ label: t("shared.seePricing"), href: "/pricing" }}
        />
      </Section>
    </>
  );
}
