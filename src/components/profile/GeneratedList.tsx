"use client";

import { ArrowRight, Download, FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, EmptyState, Tag } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { openSignedDownload } from "./DocumentsList";

/*
 * Documents Onward Scout drafted for the person's applications (cover letters, résumé
 * variants, emails…). Rendered ones download through a short-lived signed link; the rest
 * open in their application, where they are rendered.
 */

export interface GeneratedItem {
  id: string;
  kind: string;
  title: string;
  language: string;
  applicationId: string | null;
  version: number;
  createdAt: string;
  downloadable: boolean;
}

export function GeneratedList({ items }: { items: GeneratedItem[] }) {
  const t = useTranslations("profile.documents");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(item: GeneratedItem) {
    setBusy(item.id);
    try {
      await openSignedDownload(item.id, { network: tc("errors.network"), generic: tc("errors.generic") });
    } catch (err) {
      toast.error(t("downloadFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return <EmptyState compact title={t("generatedEmptyTitle")} body={t("generatedEmptyBody")} action={<ButtonLink href="/app/scout" variant="ghost">{t("toScout")}</ButtonLink>} />;

  return (
    <ul className="@container grid gap-2">
      {items.map((d) => (
        <li key={d.id} className="pane-inset flex min-w-0 flex-col gap-3 px-4 py-3.5 @lg:flex-row @lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-pane text-ink-3">
              <FileText size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.96rem] font-medium text-ink">{d.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-ink-3">
                <Tag>{t(`generatedKinds.${d.kind}`)}</Tag>
                <span className="uppercase">{d.language}</span>
                {d.version > 1 ? <span>{t("versionN", { n: d.version })}</span> : null}
                <span>{format.dateTime(new Date(d.createdAt), { dateStyle: "medium" })}</span>
              </p>
            </div>
          </div>
          <div className="-ml-2 flex shrink-0 flex-wrap gap-1.5 @lg:ml-0 @lg:justify-end">
            {d.downloadable ? (
              <Button variant="quiet" size="sm" icon={<Download size={15} aria-hidden />} loading={busy === d.id} onClick={() => void download(d)}>
                {tc("buttons.download")}
              </Button>
            ) : (
              <span className="self-center text-[0.82rem] text-ink-4">{t("notRendered")}</span>
            )}
            {d.applicationId ? (
              <ButtonLink href={`/app/applications/${d.applicationId}`} variant="quiet" size="sm" prefetch={false} iconRight={<ArrowRight size={15} aria-hidden />}>
                {t("openApplication")}
              </ButtonLink>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
