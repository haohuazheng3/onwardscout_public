import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScoutBoard } from "@/components/scout/ScoutBoard";
import { PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { features } from "@/lib/env";
import { refreshMatchesSoon, refreshState } from "@/lib/opportunities";
import { loadBoardPage } from "@/lib/opportunities/board";
import { PAGE_SIZE, parseBoardFilters } from "@/lib/opportunities/filters";
import { boardRegions, hasAnyMatch, lastRefreshedAt } from "@/lib/opportunities/queries";
import { activeGoals, getProfile } from "@/lib/profile";
import { requireUser } from "@/lib/user";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "scout" });
  return { title: t("meta.title") };
}

export default async function ScoutPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath("/app/scout", locale) });
  const filters = parseBoardFilters(await searchParams);

  const [t, goals, profile, page, regions, refresh, matched, lastMatchedAt] = await Promise.all([
    getTranslations({ locale, namespace: "scout" }),
    activeGoals(userId),
    getProfile(userId),
    loadBoardPage(userId, filters, { offset: 0, limit: PAGE_SIZE }, { counts: true }),
    boardRegions(userId),
    refreshState(userId),
    hasAnyMatch(userId),
    lastRefreshedAt(userId),
  ]);

  // First visit: the scout has never run for this person → send it out now (enqueue + kick).
  let initialRefresh = { ...refresh, finishedAt: refresh.finishedAt ?? (refresh.refreshing ? null : lastMatchedAt) };
  if (!matched && !refresh.refreshing && !refresh.finishedAt) {
    await refreshMatchesSoon(userId);
    initialRefresh = { refreshing: true, finishedAt: null, failed: false };
  }

  const profileState = !profile || profile.status === "empty" ? "empty" : profile.status === "confirmed" ? "ready" : "draft";

  return (
    <>
      <PageHeader eyebrow={t("header.eyebrow")} title={t("header.title")} description={t("header.lede")} />
      <ScoutBoard
        initialFilters={filters}
        initial={{ items: page.items, next: page.next, counts: page.counts, newThisWeek: page.newThisWeek ?? 0 }}
        goals={goals.map((g) => ({ id: g.id, label: g.label }))}
        regions={regions}
        initialRefresh={initialRefresh}
        hasMatches={matched}
        profileState={profileState}
        scoring={features().llmProvider === "anthropic" ? "ai" : "local"}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}
