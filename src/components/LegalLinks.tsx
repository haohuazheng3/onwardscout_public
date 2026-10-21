"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SITE } from "@/lib/site";
import { CookieSettingsButton } from "./Consent";
import { cx } from "./ui";

/**
 * The legal minimum on every page that has no site footer (the app shell, checkout, admin):
 * the policies, the contact address and "Cookie settings" — the policies promise that choice
 * is reachable everywhere.
 */
export function LegalLinks({ className }: { className?: string }) {
  const t = useTranslations("common.footer");
  const link = "press inline-flex min-h-[32px] items-center rounded-full px-1.5 text-[0.8rem] text-ink-3 underline-offset-4 hover:text-ink hover:underline";
  return (
    <nav aria-label={t("legal")} className={cx("flex flex-wrap items-center gap-x-1 gap-y-0.5", className)}>
      <Link href="/privacy" className={link}>
        {t("privacy")}
      </Link>
      <Link href="/terms" className={link}>
        {t("terms")}
      </Link>
      <Link href="/cookie-policy" className={link}>
        {t("cookiePolicy")}
      </Link>
      <Link href="/refund-policy" className={link}>
        {t("refundPolicy")}
      </Link>
      <a href={`mailto:${SITE.email}`} className={link}>
        {SITE.email}
      </a>
      <CookieSettingsButton className="!min-h-[32px] !px-1.5 !text-[0.8rem]" />
    </nav>
  );
}
