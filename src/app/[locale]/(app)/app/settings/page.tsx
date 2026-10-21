import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SettingsClient, type GroupInfo } from "@/components/settings/SettingsClient";
import { PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { AUTO_SUBMIT_GROUPS, getAuthorizationState, getNotificationPrefs, planPerks, typesInGroup } from "@/lib/authorizations";
import { localize, OPPORTUNITY_GROUP_LABELS, opportunityTypeLabel } from "@/lib/core";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { features } from "@/lib/env";
import { ensureUser, requireUser } from "@/lib/user";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "settings" });
  return { title: t("metaTitle") };
}

const EXAMPLES = 4;

export default async function SettingsPage({ params }: { params: Params }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await requireUser({ locale, returnTo: localizePath("/app/settings", locale) });
  const row = await ensureUser(session, { locale });

  const [t, authorizations, prefs, perks, gmailRows] = await Promise.all([
    getTranslations({ locale, namespace: "settings" }),
    getAuthorizationState(session.userId),
    getNotificationPrefs(session.userId),
    planPerks(session.userId),
    db
      .select({ status: integrations.status, accountEmail: integrations.accountEmail })
      .from(integrations)
      .where(eq(integrations.userId, session.userId))
      .limit(1),
  ]);

  const groups: GroupInfo[] = AUTO_SUBMIT_GROUPS.map((g) => {
    const types = typesInGroup(g);
    return {
      id: g,
      label: localize(OPPORTUNITY_GROUP_LABELS[g], locale),
      examples: types.slice(0, EXAMPLES).map((type) => opportunityTypeLabel(type, locale)),
      more: Math.max(0, types.length - EXAMPLES),
      partial: !authorizations.autoSubmit[g] && types.some((type) => authorizations.autoSubmitTypes.includes(type)),
    };
  });
  const gmail = gmailRows[0] ? { status: gmailRows[0].status, email: gmailRows[0].accountEmail } : null;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("lede")} />
      <SettingsClient
        locale={locale}
        savedLocale={row.locale === "zh" ? "zh" : "en"}
        email={session.email}
        groups={groups}
        initial={{
          authorizations: { autoSubmit: authorizations.autoSubmit, autoFollowup: authorizations.autoFollowup, weeklyDigest: authorizations.weeklyDigest },
          prefs,
        }}
        perks={{ autoFollowUps: perks.autoFollowUps, weeklyDigest: perks.weeklyDigest }}
        mailer={features().mailer}
        gmail={gmail}
      />
    </>
  );
}
