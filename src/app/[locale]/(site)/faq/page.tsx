import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, FaqList, PageHero } from "@/components/site/blocks";
import { FaqHashOpener } from "@/components/site/FaqHashOpener";
import { Section } from "@/components/ui";
import { FAQ_GROUPS, FAQ_GROUP_LABELS, faqsByGroup } from "@/content/faq";
import { pick } from "@/content/site-copy";
import { routing } from "@/i18n/routing";
import { faqLd, pageMetadata } from "@/lib/seo";
import { SITE, SITE_ZH } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.faq" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/faq", locale });
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };
  const groups = FAQ_GROUPS.map((g) => ({
    id: g,
    label: pick(FAQ_GROUP_LABELS[g], locale),
    items: faqsByGroup(g).map((f) => ({
      id: f.id,
      q: pick(f.q, locale),
      a: pick(f.a, locale),
      more: f.more ? { href: f.more.href, label: pick(f.more.label, locale) } : undefined,
    })),
  }));

  return (
    <>
      <JsonLd data={faqLd(groups.flatMap((g) => g.items.map((f) => ({ q: f.q, a: f.a }))))} />
      <FaqHashOpener />

      <PageHero
        crumbs={
          <Breadcrumbs
            locale={locale}
            label={t("shared.home")}
            items={[
              { name: t("shared.home"), path: "/" },
              { name: t("faq.eyebrow"), path: "/faq" },
            ]}
          />
        }
        eyebrow={t("faq.eyebrow")}
        title={t.rich("faq.title", em)}
        lede={t("faq.lede")}
      >
        <nav aria-label={t("faq.jump")} className="mt-8">
          <p className="eyebrow">{t("faq.jump")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`#${g.id}`} className="chip">
                  {g.label}
                  <span className="num text-[0.8em] text-ink-4">{g.items.length}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </PageHero>

      {groups.map((g) => (
        <Section key={g.id} id={g.id} size="sm" className="pt-14 sm:pt-16">
          <h2 className="headline mb-5 text-[1.6rem] text-ink sm:text-[2rem]">{g.label}</h2>
          <FaqList items={g.items} />
        </Section>
      ))}

      <Section size="sm" className="pt-14 sm:pt-16">
        <div className="pane flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-pine-soft text-pine">
            <Mail size={22} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="title text-[1.2rem] text-ink">{t("faq.moreTitle")}</p>
            <p className="mt-1 text-[0.96rem] leading-relaxed text-ink-3">
              {t("faq.moreBody", {
                email: SITE.email,
                replyTime: locale === "zh" ? SITE_ZH.replyTime : SITE.replyTime,
              })}
            </p>
          </div>
          <a href={`mailto:${SITE.email}`} className="btn btn-ghost shrink-0 sm:ml-auto">
            {SITE.email}
          </a>
        </div>
      </Section>
    </>
  );
}
