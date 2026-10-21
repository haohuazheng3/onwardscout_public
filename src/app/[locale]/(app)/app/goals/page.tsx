import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GoalsBoard } from "@/components/profile/GoalsBoard";
import { PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { emptyProfile } from "@/lib/core/types";
import { listGoals } from "@/lib/profile/goals";
import { getProfile, profileOf } from "@/lib/profile/store";
import { requireUser } from "@/lib/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "profile.goals" });
  return { title: t("metaTitle") };
}

/** /app/goals — success definitions, milestone progress, pause / resume / achieved, add a goal. */
export default async function GoalsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath("/app/goals", locale) });
  const [t, goals, row] = await Promise.all([getTranslations({ locale, namespace: "profile.goals" }), listGoals(userId), getProfile(userId)]);
  const profile = row ? profileOf(row) : emptyProfile();

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("lede")} />
      <GoalsBoard
        locale={locale}
        codes={profile.roles.map((r) => r.code)}
        profile={profile}
        goals={goals.map((g) => ({
          id: g.id,
          family: g.family,
          sub: g.sub,
          label: g.label,
          successDefinition: g.successDefinition,
          horizonMonths: g.horizonMonths,
          intensity: g.constraints.intensity ?? null,
          status: g.status,
          milestones: g.milestones.map((m) => ({ id: m.id, title: m.title, target: m.target, progress: m.progress, dueAt: m.dueAt ? new Date(m.dueAt).toISOString() : null, status: m.status })),
        }))}
      />
    </>
  );
}
