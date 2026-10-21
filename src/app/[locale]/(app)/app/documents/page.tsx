import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GeneratedList } from "@/components/profile/GeneratedList";
import { SourcesPanel } from "@/components/profile/SourcesPanel";
import { PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { db } from "@/lib/db";
import { generatedDocuments } from "@/lib/db/schema";
import { listDocuments } from "@/lib/profile/pipeline";
import { draftStatus } from "@/lib/profile/status";
import { requireUser } from "@/lib/user";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "profile.documents" });
  return { title: t("metaTitle") };
}

/** /app/documents — what the person gave us (with reading status) and what we drafted for them. */
export default async function DocumentsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { userId } = await requireUser({ locale, returnTo: localizePath("/app/documents", locale) });
  const [t, docs, status, generated] = await Promise.all([
    getTranslations({ locale, namespace: "profile.documents" }),
    listDocuments(userId),
    draftStatus(userId, { locale }),
    db
      .select({
        id: generatedDocuments.id,
        kind: generatedDocuments.kind,
        title: generatedDocuments.title,
        language: generatedDocuments.language,
        applicationId: generatedDocuments.applicationId,
        version: generatedDocuments.version,
        createdAt: generatedDocuments.createdAt,
        objectKey: generatedDocuments.objectKey,
      })
      .from(generatedDocuments)
      .where(eq(generatedDocuments.userId, userId))
      .orderBy(desc(generatedDocuments.createdAt))
      .limit(100),
  ]);

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("lede")} />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <SourcesPanel
          locale={locale}
          title={t("sourcesTitle")}
          status={JSON.parse(JSON.stringify(status))}
          items={docs.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, bytes: d.bytes, sourceUrl: d.sourceUrl, status: d.status, error: d.error, hasFile: d.hasFile, counts: d.extraction?.counts ?? {}, warnings: d.extraction?.warnings ?? [], skipped: d.extraction?.meta?.skipped ?? null, createdAt: new Date(d.createdAt).toISOString() }))}
        />
        <section className="grid min-w-0 content-start gap-4" aria-labelledby="generated-title">
          <div className="px-1">
            <h2 id="generated-title" className="title text-[1.2rem] text-ink">
              {t("generatedTitle")}
            </h2>
            <p className="mt-1 text-[0.9rem] text-ink-3">{t("generatedLede")}</p>
          </div>
          <div className="pane min-w-0 p-4 sm:p-6">
            <GeneratedList
              items={generated.map(({ objectKey, ...g }) => ({ ...g, createdAt: new Date(g.createdAt).toISOString(), downloadable: Boolean(objectKey) }))}
            />
          </div>
        </section>
      </div>
    </>
  );
}
