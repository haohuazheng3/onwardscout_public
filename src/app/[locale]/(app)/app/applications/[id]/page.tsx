import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationRoom } from "@/components/applications/ApplicationRoom";
import { ButtonLink, EmptyState } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { applicationView } from "@/lib/applications";
import { getBalance } from "@/lib/credits";
import { captureError } from "@/lib/errors";
import { requireUser } from "@/lib/user";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "applications" });
  return { title: t("meta.title") };
}

export default async function ApplicationRoomPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath(`/app/applications/${id}`, locale) });
  const valid = /^app_[0-9a-hjkmnp-tv-z]{6,40}$/.test(id);
  const [t, view, balance] = await Promise.all([
    getTranslations({ locale, namespace: "applications" }),
    valid ? applicationView(userId, id) : Promise.resolve(null),
    getBalance(userId).catch(async (err: unknown) => {
      await captureError(err, { route: "/app/applications/[id] (balance)", severity: "warn" });
      return null;
    }),
  ]);
  if (!view) {
    return (
      <EmptyState
        title={t("room.notFoundTitle")}
        body={t("room.notFoundBody")}
        action={<ButtonLink href="/app/applications">{t("room.back")}</ButtonLink>}
      />
    );
  }
  return <ApplicationRoom initial={view} balance={balance ? { available: balance.available, reserved: balance.reserved } : null} locale={locale} nowIso={new Date().toISOString()} />;
}
