"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type MouseEvent } from "react";
import { usePathname } from "@/i18n/navigation";
import { isEnglishOnlyPath, switchLocaleHref } from "@/i18n/paths";
import { HTML_LANG, LOCALE_COOKIE, LOCALE_NAMES, LOCALE_SHORT, LOCALES, isLocale, type Locale } from "@/i18n/routing";
import { cx } from "./ui";

/*
 * Language switcher. Keeps the current path and query, swaps the prefix (English has none,
 * Chinese is /zh), and stores the choice in the NEXT_LOCALE cookie (the proxy uses it for
 * /app without a prefix). English-only pages (opportunities, careers, organizations,
 * guides, blog) have no Chinese version: there, Chinese opens the Chinese home page and
 * the switcher says so.
 *
 * Navigation is a full page load on purpose: <html lang>, fonts, Clerk's localization and
 * every server-rendered string switch together, with no half-translated frame.
 */

function writeLocaleCookie(locale: Locale) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}

function useSwitcher() {
  const current = useLocale();
  const pathname = usePathname();
  const [pending, setPending] = useState<Locale | null>(null);
  const englishOnly = isEnglishOnlyPath(pathname);

  const hrefFor = (target: Locale) => switchLocaleHref(current === "en" ? pathname : `/${current}${pathname}`, target).href;

  const go = (target: Locale) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab etc.: let the browser handle it
    e.preventDefault();
    writeLocaleCookie(target);
    if (target === current) return;
    setPending(target);
    const { href } = switchLocaleHref(window.location.pathname, target, {
      search: window.location.search,
      hash: window.location.hash,
    });
    window.location.assign(href);
  };

  return { current: isLocale(current) ? current : "en", pending, englishOnly, hrefFor, go };
}

/** Compact two-way pill: EN | 中. For the header and the footer. */
export function LocaleSwitcher({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const t = useTranslations("common.language");
  const { current, pending, englishOnly, hrefFor, go } = useSwitcher();
  const shown = pending ?? current;

  return (
    <nav
      aria-label={t("label")}
      className={cx("inline-flex items-center gap-0.5 rounded-full bg-pane-2 p-1 shadow-[inset_0_0_0_1px_var(--line)]", className)}
    >
      {LOCALES.map((l) => {
        const active = shown === l;
        const hint = englishOnly && l !== "en" ? t("englishOnlyNote") : undefined;
        return (
          <a
            key={l}
            href={hrefFor(l)}
            hrefLang={HTML_LANG[l]}
            lang={HTML_LANG[l]}
            onClick={go(l)}
            aria-current={current === l ? "true" : undefined}
            aria-label={current === l ? t("current", { language: LOCALE_NAMES[l] }) : t("switchTo", { language: LOCALE_NAMES[l] })}
            title={hint}
            className={cx(
              "press inline-flex items-center justify-center rounded-full font-semibold transition-colors",
              size === "sm" ? "min-h-[30px] min-w-[34px] px-2.5 text-[0.78rem]" : "min-h-[34px] min-w-[40px] px-3 text-[0.82rem]",
              active ? "bg-pane text-ink shadow-[0_0_0_1px_var(--line-2),0_2px_6px_-3px_rgba(18,22,20,0.25)]" : "text-ink-3 hover:text-ink",
            )}
          >
            {pending === l ? <span className="spinner text-[0.7rem]" aria-hidden /> : LOCALE_SHORT[l]}
          </a>
        );
      })}
    </nav>
  );
}

/** Full-width list for sheets and menus: language names, a check on the current one. */
export function LocaleList({ className }: { className?: string }) {
  const t = useTranslations("common.language");
  const { current, pending, englishOnly, hrefFor, go } = useSwitcher();

  return (
    <nav aria-label={t("label")} className={cx("min-w-0", className)}>
      <p className="eyebrow mb-2 px-1">
        <Languages size={13} aria-hidden /> {t("label")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {LOCALES.map((l) => {
          const active = (pending ?? current) === l;
          return (
            <a
              key={l}
              href={hrefFor(l)}
              hrefLang={HTML_LANG[l]}
              lang={HTML_LANG[l]}
              onClick={go(l)}
              aria-current={current === l ? "true" : undefined}
              className={cx(
                "press flex min-h-[52px] items-center justify-between gap-2 rounded-[18px] px-4 text-[1rem] font-medium",
                active ? "bg-ink text-void" : "bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]",
              )}
            >
              <span>{LOCALE_NAMES[l]}</span>
              {pending === l ? <span className="spinner text-[0.8rem]" aria-hidden /> : current === l ? <Check size={16} aria-hidden /> : null}
            </a>
          );
        })}
      </div>
      {englishOnly ? (
        <p className="mt-2 px-1 text-[0.82rem] leading-snug text-ink-3">{t("englishOnlyNote")}</p>
      ) : null}
    </nav>
  );
}
