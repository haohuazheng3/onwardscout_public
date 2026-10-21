import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Compass } from "lucide-react";
import { ApplicationsBoard } from "@/components/applications/ApplicationsBoard";
import { ButtonLink, PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { goalFilters, listBoard } from "@/lib/applications";
import { BOARD_COLUMNS, type BoardColumn } from "@/lib/core/state-machine";
import { requireUser } from "@/lib/user";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "applications" });
  return { title: t("meta.title") };
}

export default async function ApplicationsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath("/app/applications", locale) });
  const sp = await searchParams;
  const goal = typeof sp.goal === "string" && /^gol_[0-9a-z]{6,40}$/.test(sp.goal) ? sp.goal : null;
  const status = typeof sp.status === "string" && (BOARD_COLUMNS as readonly string[]).includes(sp.status) ? (sp.status as BoardColumn) : null;

  const [t, cards, goals] = await Promise.all([getTranslations({ locale, namespace: "applications" }), listBoard(userId), goalFilters(userId)]);

  return (
    <>
      <PageHeader
        eyebrow={t("board.eyebrow")}
        title={t("board.title")}
        description={t("board.lede")}
        actions={
          cards.length ? (
            <ButtonLink href="/app/scout" variant="ghost" icon={<Compass size={16} aria-hidden />}>
              {t("board.findMore")}
            </ButtonLink>
          ) : null
        }
      />
      <ApplicationsBoard initial={cards} goals={goals} locale={locale} nowIso={new Date().toISOString()} initialGoal={goal} initialColumn={status} />
    </>
  );
}
