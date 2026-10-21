import { ArrowUpRight, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { CookieSettingsButton } from "./Consent";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { LogoLink, LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

/*
 * The public footer: one wide floating pane. Isomorphic (no async, no server-only
 * imports), so the client-rendered 404 can reuse it.
 */

export const CONTACT_EMAIL = "contact@onwardscout.com";

type Col = { title: string; links: { href: string; label: string; englishOnly?: boolean; prefetch?: false }[] };

export function Footer() {
  const t = useTranslations("common");

  const cols: Col[] = [
    {
      title: t("footer.product"),
      links: [
        { href: "/how-it-works", label: t("nav.howItWorks") },
        { href: "/pricing", label: t("nav.pricing") },
        { href: "/faq", label: t("footer.faq") },
        { href: "/about", label: t("footer.aboutUs") },
        { href: "/contact", label: t("footer.contact") },
        { href: "/app/start", label: t("nav.startFree"), prefetch: false },
      ],
    },
    {
      title: t("footer.opportunities"),
      links: [
        { href: "/opportunities", label: t("footer.allOpportunities"), englishOnly: true },
        { href: "/careers", label: t("footer.careers"), englishOnly: true },
        { href: "/guides", label: t("footer.guides"), englishOnly: true },
        { href: "/blog", label: t("footer.blog"), englishOnly: true },
      ],
    },
    {
      title: t("nav.for"),
      links: AUDIENCES.map((a) => ({ href: `/for/${a}`, label: t(`audiences.${audienceKey(a)}`) })),
    },
    {
      title: t("footer.legal"),
      links: [
        { href: "/privacy", label: t("footer.privacy") },
        { href: "/terms", label: t("footer.terms") },
        { href: "/acceptable-use", label: t("footer.acceptableUse") },
        { href: "/cookie-policy", label: t("footer.cookiePolicy") },
        { href: "/refund-policy", label: t("footer.refundPolicy") },
      ],
    },
  ];

  return (
    <footer className="safe-x pb-[calc(env(safe-area-inset-bottom)+16px)] pt-20 sm:px-6 sm:pt-28">
      <div className="pane mx-auto max-w-[1180px] px-6 py-10 sm:px-10 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_2.2fr] lg:gap-14">
          <div className="min-w-0">
            <LogoLink />
            <p className="dek mt-4 max-w-sm text-[1.12rem] text-ink">{t("brand.tagline")}</p>
            <p className="mt-3 max-w-sm text-[0.95rem] leading-relaxed text-ink-3">{t("footer.about")}</p>
            <div className="mt-6">
              <p className="eyebrow">{t("footer.writeToUs")}</p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="press mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-pane-2 px-4 text-[0.95rem] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-pane-3"
              >
                <Mail size={16} className="text-pine" aria-hidden />
                {CONTACT_EMAIL}
              </a>
              <p className="mt-2 text-[0.84rem] text-ink-3">{t("footer.replyTime")}</p>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-4">
            {cols.map((c) => (
              <div key={c.title} className="min-w-0">
                <p className="eyebrow">{c.title}</p>
                <ul className="mt-3 space-y-0.5">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        locale={l.englishOnly ? "en" : undefined}
                        prefetch={l.prefetch}
                        className="group inline-flex min-h-[36px] items-center gap-1 text-[0.93rem] text-ink-2 transition-colors hover:text-ink"
                      >
                        <span>{l.label}</span>
                        {l.englishOnly ? (
                          <span className="sr-only">({t("footer.englishOnlyNote")})</span>
                        ) : null}
                        {l.href === "/app/start" ? (
                          <ArrowUpRight size={14} className="text-accent-text transition-transform group-hover:translate-x-0.5" aria-hidden />
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex items-start gap-3 rounded-[var(--radius-inner)] bg-pane-2 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)] sm:px-5">
          <LogoMark size={18} className="mt-[3px] shrink-0" />
          <p className="text-[0.88rem] leading-relaxed text-ink-2">{t("footer.honesty")}</p>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.85rem] text-ink-3">{t("footer.copyright")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CookieSettingsButton />
            <ThemeToggle compact />
            <LocaleSwitcher size="sm" />
          </div>
        </div>
      </div>
    </footer>
  );
}
