import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LiveProfileCard } from "@/components/profile/LiveProfileCard";
import { ConfirmProfileButton } from "@/components/profile/ConfirmProfileButton";
import { ProfileRecord } from "@/components/profile/ProfileRecord";
import { SourcesPanel } from "@/components/profile/SourcesPanel";
import { VersionsPanel } from "@/components/profile/VersionsPanel";
import { ButtonLink, PageHeader, Progress, Tag } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { completenessNext } from "@/lib/profile/completeness";
import { openGaps, roleHintsOf } from "@/lib/profile/actions";
import { listDocuments } from "@/lib/profile/pipeline";
import { draftStatus } from "@/lib/profile/status";
import { ensureProfile, getFacts, profileHistory, profileOf } from "@/lib/profile/store";
import { requireUser } from "@/lib/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "profile.page" });
  return { title: t("metaTitle") };
}

/** /app/profile — the sourced digital profile: the card, the record with sources, sources, versions. */
export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath("/app/profile", locale) });
  const t = await getTranslations({ locale, namespace: "profile.page" });

  const row = await ensureProfile(userId);
  const [facts, docs, status, gaps, versions] = await Promise.all([getFacts(userId), listDocuments(userId), draftStatus(userId, { locale }), openGaps(userId), profileHistory(row.id, 10)]);
  const profile = profileOf(row);
  const next = completenessNext(profile);
  const building = row.status === "parsing" || status.phase === "reading" || status.phase === "building";

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={profile.identity.name ?? t("title")}
        description={t("lede")}
        actions={
          <ButtonLink href="/app/start?step=2" variant="ghost" size="sm" prefetch={false}>
            {t("rerun")}
          </ButtonLink>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="grid content-start gap-4">
          <section className="pane p-5 sm:p-7" aria-labelledby="completeness-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="completeness-title" className="title text-[1.15rem] text-ink">
                {t("completeness", { pct: row.completeness })}
              </h2>
              <div className="flex items-center gap-2">
                <Tag tone={row.status === "confirmed" ? "pine" : row.status === "parsing" ? "accent" : "default"} dot>
                  {t(`status.${row.status}`)}
                </Tag>
                {row.status === "draft" ? <ConfirmProfileButton locale={locale} /> : null}
              </div>
            </div>
            <Progress className="mt-4" value={row.completeness} label={t("completenessLabel")} />
            {next.length ? (
              <p className="mt-3 text-[0.9rem] text-ink-3">
                {t("next", { list: next.map((k) => t(`parts.${k}`)).join(locale === "zh" ? "、" : ", ") })}
              </p>
            ) : (
              <p className="mt-3 text-[0.9rem] text-ink-3">{t("complete")}</p>
            )}
          </section>

          <LiveProfileCard mode="user" locale={locale} profile={profile} roleHints={roleHintsOf(facts)} gaps={gaps} building={building} />

          <div className="px-1 pt-2">
            <h2 className="title text-[1.2rem] text-ink">{t("recordTitle")}</h2>
            <p className="mt-1 text-[0.92rem] text-ink-3">{t("recordLede")}</p>
          </div>
          <ProfileRecord
            profile={profile}
            locale={locale}
            facts={facts.map((f) => ({ id: f.id, path: f.path, claim: f.claim, value: f.value, sourceDocId: f.sourceDocId, quote: f.quote, confidence: f.confidence, confirmedByUser: f.confirmedByUser }))}
            docs={docs.map((d) => ({ id: d.id, filename: d.filename ?? d.sourceUrl }))}
          />
        </div>
        <div className="grid content-start gap-4">
          <SourcesPanel
            locale={locale}
            status={JSON.parse(JSON.stringify(status))}
            items={docs.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, bytes: d.bytes, sourceUrl: d.sourceUrl, status: d.status, error: d.error, hasFile: d.hasFile, counts: d.extraction?.counts ?? {}, warnings: d.extraction?.warnings ?? [], skipped: d.extraction?.meta?.skipped ?? null, createdAt: new Date(d.createdAt).toISOString() }))}
          />
          <VersionsPanel
            current={row.version}
            versions={versions.map((v) => ({
              version: v.version,
              createdAt: new Date(v.createdAt).toISOString(),
              counts: { experience: v.snapshot.experience?.length ?? 0, education: v.snapshot.education?.length ?? 0, skills: v.snapshot.skills?.length ?? 0, roles: v.snapshot.roles?.length ?? 0 },
            }))}
          />
        </div>
      </div>
    </>
  );
}
