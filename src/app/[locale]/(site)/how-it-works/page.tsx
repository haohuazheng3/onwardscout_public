import type { Metadata } from "next";
import { ArrowUpRight, Bot, CircleCheck, Clock3, PenLine, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, CheckList, CtaPane, DotList, PageHero, StepNumber } from "@/components/site/blocks";
import { ButtonLink, Section, SectionHeading, cx } from "@/components/ui";
import { CHANNEL_PLAIN, DRAFT_LABELS, HANDOFF, SAFETY_RULES, STEPS, pick } from "@/content/site-copy";
import { routing } from "@/i18n/routing";
import { CHANNELS } from "@/lib/core/channels";
import { howToLd, localizedPath, pageMetadata } from "@/lib/seo";
import { features } from "@/lib/env";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.howItWorks" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/how-it-works", locale });
}

export default async function HowItWorksPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const browserAgent = features().browserAgent;

  const t = await getTranslations({ locale, namespace: "site" });
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };
  const path = localizedPath(locale, "/how-it-works");

  return (
    <>
      <JsonLd
        data={howToLd({
          name: t("howItWorks.metaTitle"),
          description: t("howItWorks.metaDescription"),
          path,
          locale,
          steps: STEPS.map((s) => ({ name: pick(s.title, locale), text: `${pick(s.body, locale)} ${pick(s.we, locale)}` })),
        })}
      />

      <PageHero
        crumbs={
          <Breadcrumbs
            locale={locale}
            label={t("shared.home")}
            items={[
              { name: t("shared.home"), path: "/" },
              { name: t("howItWorks.metaTitle"), path: "/how-it-works" },
            ]}
          />
        }
        eyebrow={t("howItWorks.eyebrow")}
        title={t.rich("howItWorks.title", em)}
        lede={t("howItWorks.lede")}
        actions={
          <>
            <ButtonLink href="/app/start" prefetch={false} size="lg" iconRight={<ArrowUpRight size={18} aria-hidden />}>
              {t("shared.startFree")}
            </ButtonLink>
            <ButtonLink href="/pricing" variant="ghost" size="lg">
              {t("shared.seePricing")}
            </ButtonLink>
          </>
        }
      />

      {/* ---------- The six steps, deep ---------- */}
      <Section className="pt-14 sm:pt-20">
        <ol className="grid gap-4">
          {STEPS.map((s, i) => (
            <li key={s.id} id={`step-${i + 1}`} className="pane scroll-mt-28 p-6 sm:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <StepNumber n={i + 1} />
                    <span className="eyebrow">{t("howItWorks.stepLabel", { n: i + 1 })}</span>
                  </div>
                  <h2 className="headline mt-4 text-[1.65rem] text-ink sm:text-[2rem]">{pick(s.title, locale)}</h2>
                  <p className="mt-3 text-[1.02rem] leading-relaxed text-ink-3">{pick(s.body, locale)}</p>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="pane-inset min-w-0 p-5">
                    <p className="eyebrow flex items-center gap-2">
                      <UserRound size={14} className="text-accent-text" aria-hidden />
                      {t("howItWorks.youDo")}
                    </p>
                    <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-2">{pick(s.you, locale)}</p>
                  </div>
                  <div className="pane-inset min-w-0 p-5">
                    <p className="eyebrow flex items-center gap-2">
                      <Bot size={14} className="text-pine" aria-hidden />
                      {t("howItWorks.weDo")}
                    </p>
                    <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-2">{pick(s.we, locale)}</p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---------- Seven channels in plain words ---------- */}
      <Section id="channels">
        <SectionHeading eyebrow={t("howItWorks.channels.eyebrow")} title={t("howItWorks.channels.title")} lede={t("howItWorks.channels.lede")} />
        <ul className="grid gap-4 md:grid-cols-2">
          {CHANNELS.map((c) => {
            // The browser agent (CH3, and CH1's submission through it) is off until BROWSER_AGENT_ENABLED=1:
            // those channels prepare everything for you to paste meanwhile (read at build time; the page is static).
            const browserOff = !browserAgent && (c.id === "CH3" || c.id === "CH1");
            const live = c.status === "live" && !browserOff;
            return (
              <li key={c.id} className={cx("pane flex min-w-0 flex-col p-6 sm:p-7", !live && "opacity-90")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <span className="num rounded-full bg-pane-2 px-2.5 py-1 text-[0.76rem] font-semibold text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                      {c.id}
                    </span>
                    <h3 className="title text-[1.18rem] text-ink">{pick(c.label, locale)}</h3>
                  </span>
                  <span className={cx("tag", live ? "tag-ok" : "tag-warn")}>
                    {live ? t("howItWorks.channels.live") : browserOff ? t("howItWorks.channels.handoffForNow") : t("howItWorks.channels.notYet")}
                  </span>
                </div>
                <p className="mt-3 text-[0.96rem] leading-relaxed text-ink-3">{pick(CHANNEL_PLAIN[c.id], locale)}</p>
                <div className="mt-auto pt-4">
                  <p className="rounded-[var(--radius-field)] bg-pane-2 px-4 py-3 text-[0.9rem] leading-relaxed text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
                    <span className="font-semibold text-ink">{t("howItWorks.channels.youDo")}: </span>
                    {pick(c.userAction, locale)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ---------- The handoff ---------- */}
      <Section id="handoff">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="pane-ink min-w-0 p-7 sm:p-10">
            <p className="eyebrow eyebrow-dot eyebrow-accent">{t("howItWorks.handoff.eyebrow")}</p>
            <h2 className="headline mt-4 text-[1.9rem] text-ink sm:text-[2.4rem]">{t("howItWorks.handoff.title")}</h2>
            <p className="mt-4 text-[1rem] leading-relaxed text-ink-2">{pick(HANDOFF.why, locale)}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--radius-inner)] bg-pane-2 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
                <Clock3 size={18} className="text-accent-text" aria-hidden />
                <p className="mt-2 text-[0.93rem] leading-relaxed text-ink-2">{pick(HANDOFF.short, locale)}</p>
              </div>
              <div className="rounded-[var(--radius-inner)] bg-pane-2 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
                <CircleCheck size={18} className="text-pine" aria-hidden />
                <p className="mt-2 text-[0.93rem] leading-relaxed text-ink-2">{pick(HANDOFF.long, locale)}</p>
              </div>
            </div>
          </div>
          <div className="grid min-w-0 gap-4">
            <div className="pane min-w-0 p-6 sm:p-7">
              <h3 className="eyebrow">{t("howItWorks.handoff.containsTitle")}</h3>
              <CheckList className="mt-4" items={HANDOFF.contains.map((l) => pick(l, locale))} />
            </div>
            <div className="pane min-w-0 p-6 sm:p-7">
              <h3 className="eyebrow">{t("howItWorks.handoff.whereTitle")}</h3>
              <DotList className="mt-4" items={HANDOFF.where.map((l) => pick(l, locale))} />
            </div>
          </div>
        </div>
      </Section>

      {/* ---------- How drafts are labelled ---------- */}
      <Section id="labels">
        <SectionHeading eyebrow={t("howItWorks.drafts.eyebrow")} title={t("howItWorks.drafts.title")} />
        <div className="grid gap-4 md:grid-cols-2">
          {([DRAFT_LABELS.local, DRAFT_LABELS.ai] as const).map((l, i) => (
            <div key={i} className="pane min-w-0 p-6 sm:p-7">
              <span className={cx("tag gap-1.5", i === 0 ? "tag-pine" : "tag-accent")}>
                {i === 0 ? <PenLine size={13} aria-hidden /> : <Bot size={13} aria-hidden />}
                {pick(l.label, locale)}
              </span>
              <p className="mt-4 text-[0.97rem] leading-relaxed text-ink-3">{pick(l.body, locale)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- Safety and honesty rules ---------- */}
      <Section id="safety">
        <SectionHeading eyebrow={t("howItWorks.safety.eyebrow")} title={t("howItWorks.safety.title")} />
        <ul className="grid gap-4 sm:grid-cols-2">
          {SAFETY_RULES.map((r) => (
            <li key={r.title.en} className="pane min-w-0 p-6">
              <p className="flex items-center gap-2.5 text-[1.04rem] font-semibold text-ink">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-pine" />
                {pick(r.title, locale)}
              </p>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-3">{pick(r.body, locale)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <CtaPane
          title={t("howItWorks.cta.title")}
          body={t("howItWorks.cta.body")}
          primary={{ label: t("shared.startFree"), href: "/app/start" }}
          secondary={{ label: t("shared.seePricing"), href: "/pricing" }}
        />
      </Section>
    </>
  );
}
