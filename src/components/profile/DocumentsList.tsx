"use client";

import { Download, ExternalLink, FileText, Link2, RotateCw, StickyNote, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, EmptyState, ScoutDot, Tag, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { formatBytes } from "@/lib/profile/uploads";
import { api, type StatusDoc } from "@/components/onboarding/api";
import { useCountsPhrase } from "@/components/onboarding/CountsLine";

/*
 * The person's sources: uploaded files, links and notes, with what we read from each, a
 * signed download for files, "read again" and delete (the profile is rebuilt without it).
 */

export interface SourceItem {
  id: string;
  kind: string;
  filename: string | null;
  bytes: number;
  sourceUrl: string | null;
  status: string;
  error: string | null;
  hasFile: boolean;
  counts: Record<string, number>;
  warnings: string[];
  /** "linkedin" | "scholar" when the link is kept but can't be read automatically. */
  skipped: string | null;
  createdAt: string;
}

/** Fetches a short-lived signed link and downloads the file (the page stays where it is). */
export async function openSignedDownload(id: string, msgs: { network: string; generic: string }): Promise<void> {
  const res = await api<{ url: string }>(`/api/documents/${id}/download`, {}, msgs);
  window.location.assign(res.url);
}

export function DocumentsList({ items: initial, live, locale }: { items: SourceItem[]; live?: StatusDoc[]; locale: "en" | "zh" }) {
  const t = useTranslations("profile.documents");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const phrase = useCountsPhrase();
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setItems(initial);
  }
  const [deleting, setDeleting] = useState<SourceItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };
  const liveById = new Map((live ?? []).map((d) => [d.id, d]));

  async function remove(item: SourceItem) {
    setDeleting(null);
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    try {
      await api(`/api/documents?id=${item.id}&locale=${locale}`, { method: "DELETE" }, msgs);
      toast.success(t("removed"));
      router.refresh();
    } catch (err) {
      setItems((cur) => [...cur, item].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function reparse(item: SourceItem) {
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, status: "uploaded", error: null } : i)));
    try {
      await api(`/api/documents/${item.id}/reparse`, { method: "POST", json: { locale } }, msgs);
      router.refresh();
    } catch (err) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? item : i)));
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function download(item: SourceItem) {
    setBusy(item.id);
    try {
      await openSignedDownload(item.id, msgs);
    } catch (err) {
      toast.error(t("downloadFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return <EmptyState compact title={t("emptyTitle")} body={t("emptyBody")} />;

  return (
    <>
      <ul className="@container grid gap-2">
        {items.map((item) => {
          const l = liveById.get(item.id);
          const status = l?.status ?? item.status;
          const counts = l?.counts && Object.keys(l.counts).length ? l.counts : item.counts;
          const error = l?.error ?? item.error;
          const Icon = item.hasFile ? FileText : item.sourceUrl ? Link2 : StickyNote;
          const reading = status === "uploaded" || status === "parsing";
          const name = item.filename ?? item.sourceUrl ?? t("untitled");
          return (
            <li key={item.id} className="pane-inset flex min-w-0 flex-col gap-3 px-4 py-3.5 @lg:flex-row @lg:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-[14px]", status === "failed" ? "bg-bad-soft text-bad" : "bg-pane text-ink-3")}>
                  <Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.96rem] font-medium text-ink">{name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-ink-3">
                    <Tag>{item.hasFile || item.sourceUrl ? t(`kinds.${item.kind}`) : t("note")}</Tag>
                    {item.hasFile && item.bytes ? <span className="num">{formatBytes(item.bytes)}</span> : null}
                    <span>{format.dateTime(new Date(item.createdAt), { dateStyle: "medium" })}</span>
                  </p>
                  <p className={cx("mt-1 flex items-center gap-2 text-[0.85rem]", status === "failed" ? "text-bad" : "text-ink-3")}>
                    {reading ? (
                      <>
                        <ScoutDot live /> {t("reading")}
                      </>
                    ) : status === "failed" ? (
                      (error ?? t("failed"))
                    ) : item.skipped ? (
                      t(item.skipped === "linkedin" ? "skippedLinkedin" : "skippedScholar")
                    ) : (
                      (phrase(counts) ?? (item.hasFile ? item.warnings[0] : null) ?? t("readNothing"))
                    )}
                  </p>
                </div>
              </div>
              <div className="-ml-2 flex shrink-0 flex-wrap items-center gap-1.5 @lg:ml-0 @lg:justify-end">
                {item.hasFile ? (
                  <Button variant="quiet" size="sm" icon={<Download size={15} aria-hidden />} loading={busy === item.id} onClick={() => void download(item)}>
                    {tc("buttons.download")}
                  </Button>
                ) : item.sourceUrl ? (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet btn-sm">
                    <ExternalLink size={15} aria-hidden />
                    <span className="btn-label">{t("open")}</span>
                  </a>
                ) : null}
                {item.hasFile || item.sourceUrl ? (
                  <Button variant="quiet" size="sm" iconOnly aria-label={t("readAgain", { name })} icon={<RotateCw size={15} aria-hidden />} onClick={() => void reparse(item)} />
                ) : null}
                <Button variant="quiet" size="sm" iconOnly aria-label={t("remove", { name })} icon={<Trash2 size={15} aria-hidden />} onClick={() => setDeleting(item)} />
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t("removeTitle")}
        description={t("removeBody", { name: deleting?.filename ?? deleting?.sourceUrl ?? "" })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {tc("buttons.cancel")}
            </Button>
            <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
              {tc("buttons.remove")}
            </Button>
          </>
        }
      />
    </>
  );
}
