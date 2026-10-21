import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { LogoMark } from "@/components/Logo";
import { Breadcrumbs, CtaPane, PageHero } from "@/components/site/blocks";
import { Section, SectionHeading } from "@/components/ui";
import { ABOUT, pick } from "@/content/site-copy";
import { routing } from "@/i18n/routing";
import { absoluteUrl, htmlLang, localizedPath, pageMetadata } from "@/lib/seo";
import { SITE, SITE_ZH } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.about" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/about", locale });
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };
  const replyTime = locale === "zh" ? SITE_ZH.replyTime : SITE.replyTime;

  return (
    <>
      {/* The Organization node itself is emitted by the (site) layout; this page is about it. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: t("about.metaTitle"),
          description: t("about.metaDescription"),
          url: absoluteUrl(localizedPath(locale, "/about")),
          inLanguage: htmlLang(locale),
          mainEntity: { "@id": `${SITE.url}/#organization` },
          isPartOf: { "@id": `${SITE.url}/#website` },
        }}
      />

      <PageHero
        crumbs={
          <Breadcrumbs
            locale={locale}
            label={t("shared.home")}
            items={[
              { name: t("shared.home"), path: "/" },
              { name: t("about.eyebrow"), path: "/about" },
            ]}
          />
        }
        eyebrow={t("about.eyebrow")}
        title={t.rich("about.title", em)}
      />

      {/* ---------- The name ---------- */}
      <Section className="pt-12 sm:pt-16">
        <div className="pane-ink overflow-hidden p-7 sm:p-12">
          <div className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-14">
            <div className="flex items-start">
              <LogoMark size={88} tone="light" className="shrink-0" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow eyebrow-dot eyebrow-accent">{t("about.nameEyebrow")}</p>
              <h2 className="headline mt-4 text-[1.9rem] text-ink sm:text-[2.5rem]">{t("about.nameTitle")}</h2>
              <div className="mt-6 space-y-4 text-[1.06rem] leading-relaxed text-ink-2">
                {ABOUT.story.map((p, i) => (
                  <p key={i}>{pick(p, locale)}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------- Beliefs ---------- */}
      <Section id="beliefs">
        <SectionHeading eyebrow={t("about.beliefsEyebrow")} title={t("about.beliefsTitle")} />
        <div className="grid gap-4 md:grid-cols-2">
          {ABOUT.beliefs.map((b, i) => (
            <div key={i} className="pane min-w-0 p-6 sm:p-8">
              <span className="num font-display text-[1.4rem] font-semibold text-accent-text">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="title mt-3 text-[1.32rem] text-ink">{pick(b.title, locale)}</h3>
              <p className="mt-3 text-[0.98rem] leading-relaxed text-ink-3">{pick(b.body, locale)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- How we work ---------- */}
      <Section id="how-we-work">
        <SectionHeading eyebrow={t("about.howEyebrow")} title={t("about.howTitle")} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ABOUT.howWeWork.map((h, i) => (
            <li key={i} className="pane min-w-0 p-6">
              <p className="flex items-center gap-2.5 text-[1.04rem] font-semibold text-ink">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-pine" />
                {pick(h.title, locale)}
              </p>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-3">{pick(h.body, locale)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------- The company ---------- */}
      <Section id="company">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="pane min-w-0 p-6 sm:p-8">
            <p className="eyebrow eyebrow-dot">{t("about.companyEyebrow")}</p>
            <h2 className="headline mt-3 text-[1.7rem] text-ink sm:text-[2.1rem]">{t("about.companyTitle")}</h2>
            <div className="mt-5 space-y-4 text-[1rem] leading-relaxed text-ink-3">
              {ABOUT.company.map((p, i) => (
                <p key={i}>{pick(p, locale)}</p>
              ))}
            </div>
          </div>
          <div className="pane flex min-w-0 flex-col p-6 sm:p-8">
            <span className="grid h-12 w-12 place-items-center rounded-[16px] bg-pine-soft text-pine">
              <Mail size={22} aria-hidden />
            </span>
            <p className="title mt-5 text-[1.25rem] text-ink">{t("about.contactTitle")}</p>
            <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-3">{t("about.contactBody", { email: SITE.email, replyTime })}</p>
            <div className="mt-auto pt-6">
              <a href={`mailto:${SITE.email}`} className="btn btn-ghost">
                {SITE.email}
              </a>
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <CtaPane
          title={t.rich("home.final.title", em)}
          body={t("home.final.body")}
          primary={{ label: t("shared.startFree"), href: "/app/start" }}
          secondary={{ label: t("shared.seeHowItWorks"), href: "/how-it-works" }}
        />
      </Section>
    </>
  );
}
