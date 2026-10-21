"use client";

import { FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import type { DraftStatusView } from "@/components/onboarding/api";
import { ParseStatus } from "@/components/onboarding/ParseStatus";
import { Uploader } from "@/components/onboarding/Uploader";
import { useDraftStatus } from "@/components/onboarding/useDraftStatus";
import { DocumentsList, type SourceItem } from "./DocumentsList";

/*
 * Sources on the profile and documents pages: the list (live reading status) and the same
 * uploader as /app/start for adding more files, links or a note. When a new source has been
 * read and the profile rebuilt, the page reloads its data.
 */

export function SourcesPanel({ items, status: initial, locale, title, showList = true }: { items: SourceItem[]; status: DraftStatusView; locale: "en" | "zh"; title?: string; showList?: boolean }) {
  const t = useTranslations("profile.documents");
  const router = useRouter();
  const { status, kick } = useDraftStatus("user", locale, initial);
  const lastKey = useRef(`${initial.profile?.version ?? 0}:${initial.documents.length}`);

  useEffect(() => {
    if (!status || status.phase === "reading" || status.phase === "building") return;
    const key = `${status.profile?.version ?? 0}:${status.documents.length}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      router.refresh();
    }
  }, [status, router]);

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="sources-title">
      <div className="flex items-center gap-2.5 px-1">
        <FolderOpen size={18} className="text-pine" aria-hidden />
        <h2 id="sources-title" className="title text-[1.2rem] text-ink">
          {title ?? t("sourcesTitle")}
        </h2>
      </div>
      {showList ? (
        <div className="pane min-w-0 p-4 sm:p-6">
          <DocumentsList items={items} live={status?.documents} locale={locale} />
        </div>
      ) : null}
      {status && (status.phase === "reading" || status.phase === "building") ? <ParseStatus status={status} /> : null}
      <Uploader mode="user" locale={locale} docs={status?.documents ?? []} onActivity={kick} compact showExisting={false} />
    </section>
  );
}
