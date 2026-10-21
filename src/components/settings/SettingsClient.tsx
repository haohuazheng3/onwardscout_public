"use client";

import { Bell, ChartNoAxesColumn, Globe, Plug, ShieldCheck } from "lucide-react";
import { CookieSettingsButton } from "@/components/Consent";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { ButtonLink, Callout, Pane, Switch, Tag, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { switchLocaleHref } from "@/i18n/paths";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/routing";
import type { AutoSubmitGroup, NotificationPrefs } from "@/lib/authorizations";
import { DataSection } from "./DataSection";
import { radioKeys } from "@/components/radio-keys";

/*
 * /app/settings (P6). Every switch flips on press; the PATCH answers with the whole settings
 * state, which the page adopts only from the latest request (so quick double toggles never
 * flicker back). A failed write rolls back that one control and says so in a toast.
 */

export interface GroupInfo {
  id: AutoSubmitGroup;
  label: string;
  examples: string[];
  more: number;
  partial: boolean;
}

interface AuthView {
  autoSubmit: Record<string, boolean>;
  autoFollowup: boolean;
  weeklyDigest: boolean;
}

interface Props {
  locale: Locale;
  savedLocale: Locale;
  email: string;
  groups: GroupInfo[];
  initial: { authorizations: AuthView; prefs: NotificationPrefs };
  perks: { autoFollowUps: boolean; weeklyDigest: boolean };
  mailer: boolean;
  gmail: { status: string; email: string | null } | null;
}

type Change =
  | { type: "locale"; locale: Locale }
  | { type: "autoSubmit"; group: AutoSubmitGroup; enabled: boolean }
  | { type: "scope"; scope: "auto_followup" | "weekly_digest"; enabled: boolean }
  | { type: "pref"; key: keyof NotificationPrefs; enabled: boolean };

/** Same cookie the language switcher writes; the proxy reads it for /app without a prefix. */
function writeLocaleCookie(locale: Locale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

function SectionTitle({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-pine-soft text-pine" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="title text-[1.25rem] text-ink">{title}</h2>
        {children ? <div className="mt-1 text-[0.95rem] leading-relaxed text-ink-3">{children}</div> : null}
      </div>
    </div>
  );
}

export function SettingsClient({ locale, savedLocale, email, groups, initial, perks, mailer, gmail }: Props) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [auth, setAuth] = useState<AuthView>(initial.authorizations);
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial.prefs);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [langPending, setLangPending] = useState<Locale | null>(null);
  const seq = useRef(0);

  async function send(change: Change, key: string, rollback: () => void): Promise<boolean> {
    const mine = ++seq.current;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; authorizations?: AuthView; prefs?: NotificationPrefs } | null;
      if (!res.ok) throw new Error(data?.error ?? tc("errors.generic"));
      if (mine === seq.current && data?.authorizations && data.prefs) {
        setAuth({ autoSubmit: data.authorizations.autoSubmit, autoFollowup: data.authorizations.autoFollowup, weeklyDigest: data.authorizations.weeklyDigest });
        setPrefs(data.prefs);
      }
      return true;
    } catch (err) {
      rollback();
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
      return false;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  function toggleGroup(id: AutoSubmitGroup, enabled: boolean) {
    const prev = auth.autoSubmit[id] ?? false;
    setAuth((a) => ({ ...a, autoSubmit: { ...a.autoSubmit, [id]: enabled } }));
    void send({ type: "autoSubmit", group: id, enabled }, `group:${id}`, () => setAuth((a) => ({ ...a, autoSubmit: { ...a.autoSubmit, [id]: prev } })));
  }

  function toggleScope(scope: "auto_followup" | "weekly_digest", enabled: boolean) {
    const field = scope === "auto_followup" ? "autoFollowup" : "weeklyDigest";
    const prev = auth[field];
    setAuth((a) => ({ ...a, [field]: enabled }));
    void send({ type: "scope", scope, enabled }, scope, () => setAuth((a) => ({ ...a, [field]: prev })));
  }

  function togglePref(key: keyof NotificationPrefs, enabled: boolean) {
    const prev = prefs[key];
    setPrefs((p) => ({ ...p, [key]: enabled }));
    void send({ type: "pref", key, enabled }, `pref:${key}`, () => setPrefs((p) => ({ ...p, [key]: prev })));
  }

  async function chooseLanguage(target: Locale) {
    if (langPending) return;
    if (target === locale && target === savedLocale) return;
    setLangPending(target);
    const ok = await send({ type: "locale", locale: target }, "locale", () => setLangPending(null));
    if (!ok) return;
    writeLocaleCookie(target);
    if (target === locale) {
      setLangPending(null);
      toast.success(t("language.saved"));
      return;
    }
    // A full load on purpose: <html lang>, Clerk's language and every server string switch together.
    window.location.assign(switchLocaleHref(window.location.pathname, target, { hash: "#language" }).href);
  }

  const shownLocale = langPending ?? locale;
  const sections = [
    { id: "language", label: t("nav.language") },
    { id: "authorizations", label: t("nav.authorizations") },
    { id: "notifications", label: t("nav.notifications") },
    { id: "integrations", label: t("nav.integrations") },
    { id: "analytics", label: t("nav.analytics") },
    { id: "data", label: t("nav.data") },
  ];

  const gmailLine = !gmail
    ? t("integrations.gmailNone")
    : gmail.status === "active"
      ? gmail.email
        ? t("integrations.gmailConnected", { email: gmail.email })
        : t("integrations.gmailConnectedNoEmail")
      : gmail.status === "error"
        ? t("integrations.gmailError")
        : t("integrations.gmailRevoked");

  return (
    <div className="grid min-w-0 gap-4 pb-10">
      <nav aria-label={t("nav.label")} className="scroll-row -mx-4 gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="press inline-flex min-h-[38px] shrink-0 items-center rounded-full bg-pane-2 px-3.5 text-[0.88rem] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* ---------------------------------------------------------------- language */}
      <Pane as="section" id="language" pad="md" className="scroll-mt-28">
        <SectionTitle icon={<Globe size={19} />} title={t("language.title")}>
          {t("language.body")}
        </SectionTitle>
        <div role="radiogroup" aria-label={t("language.title")} className="mt-5 grid grid-cols-2 gap-2 sm:max-w-sm">
          {LOCALES.map((l, i) => {
            const selected = shownLocale === l;
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={selected}
                {...radioKeys(i, LOCALES.length, LOCALES.indexOf(shownLocale), null)}
                aria-busy={langPending === l || undefined}
                lang={l === "zh" ? "zh-CN" : "en"}
                onClick={() => void chooseLanguage(l)}
                className={cx(
                  "press flex min-h-[52px] items-center justify-center gap-2 rounded-[16px] px-4 text-[1rem] font-semibold transition-colors",
                  selected ? "bg-ink text-void" : "bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink",
                )}
              >
                {langPending === l ? <span className="spinner" aria-hidden="true" /> : null}
                {LOCALE_NAMES[l]}
              </button>
            );
          })}
        </div>
        {langPending && langPending !== locale ? (
          <p className="mt-3 text-[0.88rem] text-ink-3" role="status">
            {t("language.switching", { language: LOCALE_NAMES[langPending] })}
          </p>
        ) : null}
      </Pane>

      {/* ---------------------------------------------------------------- authorizations */}
      <Pane as="section" id="authorizations" pad="md" className="scroll-mt-28">
        <SectionTitle icon={<ShieldCheck size={19} />} title={t("authorizations.title")} />
        <Callout tone="accent" title={t("authorizations.calloutTitle")} className="mt-5">
          {t("authorizations.calloutBody")}
        </Callout>

        <h3 className="mt-7 text-[1rem] font-semibold text-ink">{t("authorizations.autoSubmitTitle")}</h3>
        <p className="mt-0.5 text-[0.9rem] text-ink-3">{t("authorizations.autoSubmitBody")}</p>
        <ul className="pane-inset mt-3 divide-y divide-[var(--line)] px-4 sm:px-5">
          {groups.map((g) => {
            const on = auth.autoSubmit[g.id] ?? false;
            const examples = g.examples.join(", ") + (g.more > 0 ? ` ${t("authorizations.moreTypes", { count: g.more })}` : "");
            return (
              <li key={g.id} className="py-2">
                <Switch
                  id={`auto-${g.id}`}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      {g.label}
                      {g.partial && !on ? <Tag tone="warn">{t("authorizations.partial")}</Tag> : null}
                    </span>
                  }
                  description={t("authorizations.examples", { list: examples })}
                  checked={on}
                  aria-busy={busy[`group:${g.id}`] || undefined}
                  onChange={(e) => toggleGroup(g.id, e.currentTarget.checked)}
                />
              </li>
            );
          })}
        </ul>

        <ul className="mt-5 divide-y divide-[var(--line)]">
          <li className="py-2">
            <Switch
              id="auto-followup"
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {t("authorizations.followupTitle")}
                  {!perks.autoFollowUps ? <Tag tone="accent">{t("authorizations.proTag")}</Tag> : null}
                </span>
              }
              description={
                <>
                  {t("authorizations.followupBody")}
                  {!perks.autoFollowUps ? <span className="mt-1 block text-ink-4">{t("authorizations.followupPro")}</span> : null}
                </>
              }
              checked={auth.autoFollowup}
              aria-busy={busy.auto_followup || undefined}
              onChange={(e) => toggleScope("auto_followup", e.currentTarget.checked)}
            />
          </li>
          <li className="py-2">
            <Switch
              id="weekly-digest"
              label={t("authorizations.digestTitle")}
              description={t("authorizations.digestBody")}
              checked={auth.weeklyDigest}
              aria-busy={busy.weekly_digest || undefined}
              onChange={(e) => toggleScope("weekly_digest", e.currentTarget.checked)}
            />
          </li>
        </ul>
      </Pane>

      {/* ---------------------------------------------------------------- notifications */}
      <Pane as="section" id="notifications" pad="md" className="scroll-mt-28">
        <SectionTitle icon={<Bell size={19} />} title={t("notifications.title")} />
        {!mailer ? (
          <Callout tone="info" className="mt-5">
            {t("notifications.mailerOff")}
          </Callout>
        ) : null}
        <ul className="mt-4 divide-y divide-[var(--line)]">
          <li className="py-2">
            <Switch id="notify-in-app" label={t("notifications.inAppTitle")} description={t("notifications.inAppBody")} checked disabled readOnly />
          </li>
          <li className="py-2">
            <Switch
              id="notify-email-updates"
              label={t("notifications.emailUpdatesTitle")}
              description={t("notifications.emailUpdatesBody")}
              checked={prefs.emailUpdates}
              aria-busy={busy["pref:emailUpdates"] || undefined}
              onChange={(e) => togglePref("emailUpdates", e.currentTarget.checked)}
            />
          </li>
          <li className="py-2">
            <Switch
              id="notify-email-digest"
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {t("notifications.emailDigestTitle")}
                  {!perks.weeklyDigest ? <Tag tone="accent">{t("authorizations.proTag")}</Tag> : null}
                </span>
              }
              description={t("notifications.emailDigestBody")}
              checked={prefs.emailDigest}
              aria-busy={busy["pref:emailDigest"] || undefined}
              onChange={(e) => togglePref("emailDigest", e.currentTarget.checked)}
            />
          </li>
        </ul>
        <p className="mt-3 break-words text-[0.86rem] text-ink-4">{t("notifications.sentTo", { email })}</p>
      </Pane>

      {/* ---------------------------------------------------------------- integrations */}
      <Pane as="section" id="integrations" pad="md" className="scroll-mt-28">
        <SectionTitle icon={<Plug size={19} />} title={t("integrations.title")} />
        <div className="pane-inset mt-5 flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", gmail?.status === "active" ? "bg-ok" : gmail?.status === "error" ? "bg-bad" : "bg-line-2")} aria-hidden="true" />
              {t("integrations.gmailName")}
            </p>
            <p className="mt-1 break-words text-[0.92rem] text-ink-3">{gmailLine}</p>
          </div>
          <ButtonLink href="/app/integrations" variant="ghost" size="sm" prefetch={false} className="shrink-0">
            {t("integrations.manage")}
          </ButtonLink>
        </div>
      </Pane>

      {/* ---------------------------------------------------------------- analytics */}
      <Pane as="section" id="analytics" pad="md" className="scroll-mt-28">
        <SectionTitle icon={<ChartNoAxesColumn size={19} />} title={t("analytics.title")}>
          {t("analytics.body")}
        </SectionTitle>
        <div className="mt-4">
          <CookieSettingsButton className="!bg-pane-2 !px-4 !text-ink-2 !no-underline shadow-[inset_0_0_0_1px_var(--line)]" />
        </div>
      </Pane>

      {/* ---------------------------------------------------------------- data */}
      <DataSection locale={locale} />
    </div>
  );
}
