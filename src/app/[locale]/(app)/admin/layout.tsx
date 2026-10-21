import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminNav } from "@/components/admin/AdminClient";
import { IntlProvider } from "@/i18n/IntlProvider";
import { loadMessages } from "@/i18n/messages";
import { APP_NAMESPACES } from "@/i18n/namespaces";
import { TIME_ZONE } from "@/i18n/request";
import { SlimHeader } from "@/components/Header";
import { Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { VERCEL_ENV } from "@/lib/env";
import { requireAdminOnce } from "./_lib/data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "admin" });
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } };
}

/**
 * The owner's cockpit. The proxy already answers 404 to anyone who is not a verified
 * ADMIN_EMAILS address; `requireAdmin` repeats the check here, on every page and in every action.
 * /admin sits inside (app) but outside /app, so it brings its own slim chrome and <main>, and
 * its own message provider: the (app) layout leaves the `admin` namespace out for everyone else
 * (a nested provider replaces the outer one, so it carries every app namespace).
 */
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { email } = await requireAdminOnce();
  const [t, messages] = await Promise.all([getTranslations({ locale, namespace: "admin" }), loadMessages(locale, APP_NAMESPACES)]);

  return (
    <IntlProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
      <div className="min-h-screen-d">
        <SlimHeader />
        <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
            <div className="flex items-center gap-3">
              <p className="eyebrow eyebrow-accent">{t("area")}</p>
              <Tag>{VERCEL_ENV}</Tag>
            </div>
            <p className="min-w-0 truncate text-[0.85rem] text-ink-4">
              {t("signedInAs", { email })} ·{" "}
              <Link href="/app" prefetch={false} className="text-accent-text underline-offset-2 hover:underline">
                {t("nav.backToApp")}
              </Link>
            </p>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-10">
            <AdminNav />
            <div className="min-w-0">{children}</div>
          </div>
        </main>
      </div>
    </IntlProvider>
  );
}
