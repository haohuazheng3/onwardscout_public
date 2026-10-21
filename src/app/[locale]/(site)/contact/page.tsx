import type { Metadata } from "next";
import { Clock3, Mail } from "lucide-react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ContactForm, type ContactFormCopy } from "@/components/ContactForm";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, DotList, PageHero } from "@/components/site/blocks";
import { Section } from "@/components/ui";
import { CONTACT_TOPICS } from "@/content/contact";
import { pick } from "@/content/site-copy";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { absoluteUrl, htmlLang, localizedPath, pageMetadata } from "@/lib/seo";
import { SITE, SITE_ZH } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.contact" });
  return pageMetadata({ title: t("metaTitle"), description: t("metaDescription"), path: "/contact", locale });
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "site" });
  const f = (k: string, v?: Record<string, string>) => t(`contact.form.${k}`, v);
  const em = { em: (chunks: ReactNode) => <em>{chunks}</em> };
  const replyTime = locale === "zh" ? SITE_ZH.replyTime : SITE.replyTime;

  const copy: ContactFormCopy = {
    name: f("name"),
    optional: f("optional"),
    namePlaceholder: f("namePlaceholder"),
    email: f("email"),
    emailPlaceholder: f("emailPlaceholder"),
    topic: f("topic"),
    message: f("message"),
    messagePlaceholder: f("messagePlaceholder"),
    send: f("send"),
    sending: f("sending"),
    sentTag: f("sentTag"),
    sentTitle: f("sentTitle"),
    // `{email}` is filled in by the form with the address the visitor typed.
    sentBody: t.raw("contact.form.sentBody") as string,
    sendAnother: f("sendAnother"),
    failedTitle: f("failedTitle"),
    errors: {
      invalid_email: f("errorInvalidEmail"),
      message_short: f("errorMessageShort"),
      message_long: f("errorMessageLong"),
      invalid: f("errorInvalid"),
      rate_limited: f("errorRateLimited"),
      server: f("errorServer", { email: SITE.email }),
      network: f("errorNetwork", { email: SITE.email }),
    },
  };
  const privacyNote = t.rich("contact.form.privacyNote", {
    privacy: (chunks) => (
      <Link href="/privacy" className="link text-ink-3">
        {chunks}
      </Link>
    ),
  });

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: t("contact.metaTitle"),
          description: t("contact.metaDescription"),
          url: absoluteUrl(localizedPath(locale, "/contact")),
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
              { name: t("contact.metaTitle"), path: "/contact" },
            ]}
          />
        }
        eyebrow={t("contact.eyebrow")}
        title={t.rich("contact.title", em)}
        lede={t("contact.lede")}
      />

      <Section className="pt-10 sm:pt-14">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:items-start">
          <ContactForm
            copy={copy}
            locale={locale}
            privacyNote={privacyNote}
            topics={CONTACT_TOPICS.map((tp) => ({ value: tp.value, label: pick(tp.label, locale) }))}
          />
          <aside className="grid min-w-0 gap-4">
            <div className="pane min-w-0 p-6">
              <p className="eyebrow">{t("contact.emailLabel")}</p>
              <a
                href={`mailto:${SITE.email}`}
                className="press mt-3 flex min-h-[48px] min-w-0 items-center gap-2.5 rounded-[var(--radius-field)] bg-pane-2 px-4 text-[0.98rem] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-pane-3"
              >
                <Mail size={18} className="shrink-0 text-pine" aria-hidden />
                <span className="truncate">{SITE.email}</span>
              </a>
              <p className="mt-3 flex items-start gap-2 text-[0.9rem] leading-relaxed text-ink-3">
                <Clock3 size={16} className="mt-[3px] shrink-0 text-ink-4" aria-hidden />
                {replyTime}
              </p>
            </div>
            <div className="pane min-w-0 p-6">
              <p className="eyebrow">{t("contact.tipsTitle")}</p>
              <DotList className="mt-4" items={[t("contact.tip1"), t("contact.tip2"), t("contact.tip3")]} />
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
