import { Ban, Inbox, MailCheck, Send, ShieldCheck, Unplug } from "lucide-react";
import type { AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import { PageHeader, Pane } from "@/components/ui";
import { CopyButton } from "@/components/ui-client";
import { IntlProvider } from "@/i18n/IntlProvider";
import { TIME_ZONE } from "@/i18n/request";
import type { Locale } from "@/i18n/routing";
import { OUTREACH_LIMITS } from "@/lib/channels/outreach-policy";
import { integrationsMessages, integrationsTranslator } from "@/lib/integrations/i18n";
import { GmailPanel, type GmailState } from "./GmailPanel";

/** The integrations page body (server component): data comes from page.tsx. */

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3">
      <span className="mt-0.5 shrink-0 text-ink-3" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 text-[0.95rem] leading-relaxed text-ink-2">{children}</span>
    </li>
  );
}

export function IntegrationsView({
  locale,
  gmail,
  inbound,
  flash,
  common,
}: {
  locale: Locale;
  gmail: GmailState;
  inbound: string | null;
  flash: string | null;
  common: Record<string, AbstractIntlMessages>;
}) {
  const t = integrationsTranslator(locale);
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("lede")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <IntlProvider locale={locale} messages={{ ...common, integrations: integrationsMessages(locale) }} timeZone={TIME_ZONE}>
            <GmailPanel initial={gmail} flash={flash} locale={locale} />
          </IntlProvider>

          <Pane as="section" pad="md" className="min-w-0" aria-labelledby="dropbox-title">
            <div className="flex min-w-0 items-start gap-4">
              <span className="pane-inset grid size-12 shrink-0 place-items-center text-ink-2" aria-hidden>
                <Inbox size={22} />
              </span>
              <div className="min-w-0">
                <h2 id="dropbox-title" className="title text-[1.25rem] text-ink">
                  {t("dropbox.title")}
                </h2>
                <p className="mt-1 text-[0.98rem] leading-relaxed text-ink-2">{t("dropbox.body")}</p>
              </div>
            </div>
            {inbound ? (
              <div className="pane-inset mt-5 flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="eyebrow">{t("dropbox.addressLabel")}</p>
                  <p className="mt-1.5 break-all font-mono text-[0.95rem] text-ink">{inbound}</p>
                </div>
                <CopyButton text={inbound} label={t("dropbox.copy")} className="shrink-0 self-start sm:self-auto" />
              </div>
            ) : (
              <p className="pane-inset mt-5 p-4 text-[0.95rem] text-ink-3">{t("dropbox.unavailable")}</p>
            )}
            <h3 className="mt-6 text-[1rem] font-semibold text-ink">{t("dropbox.autoTitle")}</h3>
            <ol className="mt-3 grid list-decimal gap-2 pl-5 text-[0.95rem] leading-relaxed text-ink-2 marker:text-ink-4">
              <li>{t("dropbox.auto1")}</li>
              <li>{t("dropbox.auto2")}</li>
              <li>{t("dropbox.auto3")}</li>
            </ol>
            <p className="mt-5 text-[0.88rem] text-ink-4">{t("dropbox.privacy")}</p>
          </Pane>
        </div>

        <Pane as="section" pad="md" className="min-w-0" aria-labelledby="scope-title">
          <div className="flex items-center gap-3">
            <ShieldCheck size={22} className="shrink-0 text-pine" aria-hidden />
            <h2 id="scope-title" className="title text-[1.15rem] text-ink">
              {t("scope.title")}
            </h2>
          </div>
          <ul className="mt-5 grid gap-4">
            <Point icon={<Send size={18} />}>{t("scope.send")}</Point>
            <Point icon={<MailCheck size={18} />}>{t("scope.identity")}</Point>
            <Point icon={<Ban size={18} />}>{t("scope.noRead")}</Point>
            <Point icon={<ShieldCheck size={18} />}>{t("scope.noBulk", { perDay: OUTREACH_LIMITS.newContactsPerDay, days: OUTREACH_LIMITS.sameContactDays })}</Point>
            <Point icon={<Unplug size={18} />}>{t("scope.revoke")}</Point>
          </ul>
        </Pane>
      </div>
    </>
  );
}
