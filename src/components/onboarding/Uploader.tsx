"use client";

import { CircleAlert, FileText, FileUp, Image as ImageIcon, Link2, Plus, Presentation, RotateCw, StickyNote, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { track } from "@/components/Consent";
import { Button, Callout, Input, Progress, ScoutDot, Tag, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { checkUpload, formatBytes, isLinkedInUrl, splitLinks, UPLOAD_ACCEPT, UPLOAD_LIMITS, uploadContentType, type UploadRejection } from "@/lib/profile/uploads";
import { api, ApiError, ENDPOINTS, putFile, type ApiMode, type StatusDoc } from "./api";
import { CountsLine } from "./CountsLine";

/*
 * "Drop what you have": one big drop zone (drag and drop, or tap to pick; several files),
 * pasted links, and an optional line of text. Files go straight to the files worker with a
 * signed PUT (live progress), then the complete call creates the source and parsing starts.
 * Each row then follows the server's reading status (from the parent's polling).
 */

type Phase = "queued" | "signing" | "uploading" | "saving" | "done" | "error";

interface Item {
  key: string;
  file: File;
  name: string;
  size: number;
  phase: Phase;
  progress: number;
  error?: string;
  /** Refused before uploading (type, size, count): nothing to retry. */
  rejected?: boolean;
  documentId?: string;
}

interface LinkItem {
  key: string;
  url: string;
  state: "saving" | "saved" | "error";
  documentId?: string;
  hint?: string | null;
  error?: string;
}

const PARALLEL = 3;

function iconFor(name: string, type: string | null | undefined) {
  const ct = uploadContentType(name, type) ?? "";
  if (ct.startsWith("image/")) return ImageIcon;
  if (ct.includes("presentation")) return Presentation;
  return FileText;
}

export function Uploader({
  mode,
  locale,
  docs,
  onActivity,
  compact = false,
  showNote = true,
  showExisting = true,
}: {
  mode: ApiMode;
  locale: string;
  /** Sources the server knows (from the status polling). */
  docs: StatusDoc[];
  /** Called after each new source so the parent polls the reading status. */
  onActivity: () => void;
  compact?: boolean;
  showNote?: boolean;
  /** List sources added before this visit (off where another list already shows them). */
  showExisting?: boolean;
}) {
  const t = useTranslations("onboarding.upload");
  const tc = useTranslations("common");
  const msgs = useMemo(() => ({ network: tc("errors.network"), generic: tc("errors.generic") }), [tc]);
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [linkText, setLinkText] = useState("");
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving">("idle");
  const [dragging, setDragging] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const maxFiles = mode === "draft" ? UPLOAD_LIMITS.maxFiles : UPLOAD_LIMITS.maxFilesSignedIn;
  const ep = ENDPOINTS[mode];

  const update = useCallback((key: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i))), []);

  const rejectionText = useCallback(
    (r: UploadRejection) => (r === "type" ? t("rejectType") : r === "size" ? t("rejectSize") : r === "empty" ? t("rejectEmpty") : t("rejectCount", { max: maxFiles })),
    [t, maxFiles],
  );

  /* ---------- the upload queue: sign → PUT with progress → complete ---------- */

  const run = useCallback(
    async (item: Item) => {
      update(item.key, { phase: "signing", error: undefined, progress: 0 });
      try {
        const signed = await api<{ documentId: string; uploadUrl: string; contentType: string; ticket: string }>(ep.sign, { method: "POST", json: { filename: item.name, contentType: item.file.type || null, bytes: item.size, locale } }, msgs);
        update(item.key, { phase: "uploading" });
        try {
          await putFile(signed.uploadUrl, item.file, signed.contentType, (p) => update(item.key, { progress: p }), (xhr) => xhrs.current.set(item.key, xhr));
        } catch (err) {
          if (err instanceof ApiError && err.status === -1) return; // removed by the person
          throw new ApiError(t("uploadFailed"), 0);
        } finally {
          xhrs.current.delete(item.key);
        }
        update(item.key, { phase: "saving", progress: 1 });
        const done = await api<{ document: { id: string; kind: string } }>(ep.complete, { method: "POST", json: { ticket: signed.ticket, locale } }, msgs);
        update(item.key, { phase: "done", documentId: done.document.id });
        track("upload", { kind: done.document.kind, contentType: signed.contentType, bytes: item.size, signedIn: mode === "user" });
        onActivity();
      } catch (err) {
        const message = err instanceof Error ? err.message : tc("errors.generic");
        update(item.key, { phase: "error", error: message });
        if (err instanceof ApiError && err.status === 429 && err.data?.signIn) toast.warn(message);
      }
    },
    [ep, locale, msgs, mode, onActivity, t, tc, update],
  );

  // Start queued items, at most PARALLEL at a time.
  useEffect(() => {
    const active = items.filter((i) => i.phase === "signing" || i.phase === "uploading" || i.phase === "saving").length;
    const next = items.filter((i) => i.phase === "queued").slice(0, Math.max(0, PARALLEL - active));
    for (const i of next) void run(i);
  }, [items, run]);

  const serverFiles = docs.filter((d) => d.source === "file" && !removed.has(d.id));
  const localDocIds = new Set(items.map((i) => i.documentId).filter(Boolean) as string[]);
  const knownFiles = showExisting ? serverFiles.filter((d) => !localDocIds.has(d.id)) : [];

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      if (!files.length) return;
      let count = items.filter((i) => i.phase !== "error").length + knownFiles.length;
      const fresh: Item[] = [];
      for (const file of files) {
        const r = checkUpload({ name: file.name, type: file.type, size: file.size }, count, maxFiles);
        const key = `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 7)}`;
        if (r) fresh.push({ key, file, name: file.name, size: file.size, phase: "error", progress: 0, error: rejectionText(r), rejected: true });
        else {
          fresh.push({ key, file, name: file.name, size: file.size, phase: "queued", progress: 0 });
          count++;
        }
      }
      setItems((cur) => [...cur, ...fresh]);
    },
    [items, knownFiles.length, maxFiles, rejectionText],
  );

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  async function removeItem(item: Item) {
    xhrs.current.get(item.key)?.abort();
    setItems((cur) => cur.filter((i) => i.key !== item.key));
    if (item.documentId) await removeDoc(item.documentId, () => setItems((cur) => [...cur, item]));
  }

  async function removeDoc(id: string, rollback?: () => void) {
    setRemoved((cur) => new Set(cur).add(id));
    try {
      await api(`${ep.documents}?id=${encodeURIComponent(id)}&locale=${locale}`, { method: "DELETE" }, msgs);
      onActivity();
    } catch (err) {
      setRemoved((cur) => {
        const n = new Set(cur);
        n.delete(id);
        return n;
      });
      rollback?.();
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function reparse(id: string) {
    try {
      if (mode === "user") await api(`/api/documents/${id}/reparse`, { method: "POST", json: { locale } }, msgs);
      else await api(ep.documents, { method: "POST", json: { id, action: "reparse", locale } }, msgs);
      onActivity();
    } catch (err) {
      toast.error(t("reparseFailed"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  /* ---------- links ---------- */

  async function addLinks() {
    const urls = splitLinks(linkText);
    if (!urls.length) {
      toast.warn(t("linksInvalid"));
      return;
    }
    const fresh: LinkItem[] = urls.map((url) => ({ key: `${url}:${Math.random().toString(36).slice(2, 7)}`, url, state: "saving", hint: isLinkedInUrl(url) ? "linkedin" : null }));
    setLinks((cur) => [...cur, ...fresh]);
    setLinkText("");
    try {
      const res = await api<{ results: { url: string; ok: boolean; documentId?: string; hint?: string | null; error?: string }[] }>(ep.links, { method: "POST", json: { urls, locale } }, msgs);
      setLinks((cur) =>
        cur.map((l) => {
          const i = fresh.findIndex((f) => f.key === l.key);
          if (i < 0) return l;
          const r = res.results[i];
          return r?.ok ? { ...l, state: "saved", documentId: r.documentId, hint: r.hint ?? l.hint } : { ...l, state: "error", error: r?.error ?? tc("errors.generic") };
        }),
      );
      if (res.results.some((r) => r.ok)) onActivity();
    } catch (err) {
      setLinks((cur) => cur.map((l) => (fresh.some((f) => f.key === l.key) ? { ...l, state: "error", error: err instanceof Error ? err.message : tc("errors.generic") } : l)));
    }
  }

  const serverLinks = docs.filter((d) => d.source === "link" && !removed.has(d.id));
  const localLinkIds = new Set(links.map((l) => l.documentId).filter(Boolean) as string[]);
  const showLinkedInHelp = links.some((l) => l.hint === "linkedin") || (showExisting && serverLinks.some((d) => d.skipped === "linkedin")) || isLinkedInUrl(linkText);

  /* ---------- note ---------- */

  async function addNote() {
    const text = note.trim();
    if (!text) return;
    setNoteState("saving");
    try {
      await api(ep.note, { method: "POST", json: { text, locale } }, msgs);
      setNote("");
      onActivity();
    } catch (err) {
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setNoteState("idle");
    }
  }
  const notes = showExisting ? docs.filter((d) => d.source === "note" && !removed.has(d.id)) : [];

  const byId = new Map(docs.map((d) => [d.id, d]));

  return (
    <div className="grid gap-4">
      <section className={cx("pane min-w-0", compact ? "p-4 sm:p-5" : "p-4 sm:p-6")} aria-labelledby="upload-title">
        <h2 id="upload-title" className="sr-only">
          {t("dropTitle")}
        </h2>
        <label
          htmlFor="upload-input"
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
          data-drag={dragging ? "true" : undefined}
          className={cx(
            "press group flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed text-center transition-colors",
            compact ? "min-h-[150px] px-4 py-6" : "min-h-[220px] px-5 py-10 sm:min-h-[260px]",
            dragging ? "border-accent bg-accent-soft" : "border-line-2 bg-pane-2 hover:border-ink-4",
          )}
        >
          <span className={cx("grid h-14 w-14 place-items-center rounded-full transition-colors", dragging ? "bg-accent text-accent-ink" : "bg-pane text-ink shadow-[inset_0_0_0_1px_var(--line-2)]")}>
            <FileUp size={24} aria-hidden />
          </span>
          <span className={cx("title mt-4 text-ink", compact ? "text-[1.1rem]" : "text-[1.25rem] sm:text-[1.4rem]")}>{dragging ? t("dropNow") : t("dropTitle")}</span>
          <span className="mt-1.5 text-[0.95rem] text-ink-3">{t("dropOr")}</span>
          <span className="mt-3 max-w-md text-[0.82rem] leading-relaxed text-ink-4">{t("dropTypes", { max: maxFiles })}</span>
          <input
            ref={inputRef}
            id="upload-input"
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {items.length || knownFiles.length ? (
          <ul className="mt-4 grid gap-2" aria-live="polite">
            {items.map((item) => (
              <FileRow
                key={item.key}
                name={item.name}
                size={item.size}
                Icon={iconFor(item.name, item.file.type)}
                phase={item.phase}
                progress={item.progress}
                error={item.error}
                server={item.documentId ? byId.get(item.documentId) : undefined}
                onRemove={() => void removeItem(item)}
                onRetry={item.phase === "error" && !item.rejected ? () => update(item.key, { phase: "queued", error: undefined }) : undefined}
                onReparse={item.documentId ? () => void reparse(item.documentId!) : undefined}
              />
            ))}
            {knownFiles.map((d) => (
              <FileRow
                key={d.id}
                name={d.filename ?? t("untitled")}
                Icon={iconFor(d.filename ?? "", null)}
                phase="done"
                progress={1}
                server={d}
                onRemove={() => void removeDoc(d.id)}
                onReparse={() => void reparse(d.id)}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section className={cx("pane min-w-0", compact ? "p-4 sm:p-5" : "p-5 sm:p-6")} aria-labelledby="links-title">
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-pine" aria-hidden />
          <h2 id="links-title" className="text-[1.02rem] font-semibold text-ink">
            {t("linksTitle")}
          </h2>
        </div>
        <p className="mt-1 text-[0.9rem] text-ink-3">{t("linksHint")}</p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void addLinks();
          }}
        >
          <label htmlFor="links-input" className="sr-only">
            {t("linksLabel")}
          </label>
          <Input id="links-input" value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder={t("linksPlaceholder")} inputMode="url" autoCapitalize="none" autoCorrect="off" className="min-w-0 flex-1" />
          <Button type="submit" variant="ghost" icon={<Plus size={17} aria-hidden />} disabled={!linkText.trim()}>
            {t("linksAdd")}
          </Button>
        </form>
        {showLinkedInHelp ? (
          <Callout tone="accent" title={t("linkedinTitle")} className="mt-3">
            {t("linkedinBody")}
          </Callout>
        ) : null}
        {links.length || (showExisting && serverLinks.length) ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {links.map((l) => (
              <LinkChip key={l.key} url={l.url} state={l.state} error={l.error} server={l.documentId ? byId.get(l.documentId) : undefined} onRemove={l.documentId ? () => void removeDoc(l.documentId!) : () => setLinks((cur) => cur.filter((x) => x.key !== l.key))} />
            ))}
            {serverLinks
              .filter((d) => showExisting && !localLinkIds.has(d.id))
              .map((d) => (
                <LinkChip key={d.id} url={d.sourceUrl ?? d.filename ?? ""} state="saved" server={d} onRemove={() => void removeDoc(d.id)} />
              ))}
          </ul>
        ) : null}

        {showNote ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <StickyNote size={17} className="text-pine" aria-hidden />
              <label htmlFor="note-input" className="text-[1.02rem] font-semibold text-ink">
                {t("noteTitle")}
              </label>
              <span className="text-[0.85rem] text-ink-4">{t("optional")}</span>
            </div>
            <form
              className="mt-2 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                void addNote();
              }}
            >
              <Input id="note-input" value={note} maxLength={UPLOAD_LIMITS.maxNoteChars} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} className="min-w-0 flex-1" />
              <Button type="submit" variant="ghost" loading={noteState === "saving"} disabled={!note.trim()}>
                {t("noteAdd")}
              </Button>
            </form>
            {notes.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {notes.map((d) => (
                  <li key={d.id}>
                    <Tag tone="pine" className="max-w-full">
                      <StickyNote size={13} aria-hidden />
                      <span className="truncate">{t("noteSaved")}</span>
                    </Tag>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FileRow({
  name,
  size,
  Icon,
  phase,
  progress,
  error,
  server,
  onRemove,
  onRetry,
  onReparse,
}: {
  name: string;
  size?: number;
  Icon: typeof FileText;
  phase: Phase;
  progress: number;
  error?: string;
  server?: StatusDoc;
  onRemove: () => void;
  onRetry?: () => void;
  onReparse?: () => void;
}) {
  const t = useTranslations("onboarding.upload");
  const reading = phase === "done" && (!server || server.status === "uploaded" || server.status === "parsing");
  const failed = phase === "error" || server?.status === "failed";
  const parsed = phase === "done" && server?.status === "parsed";
  const message = phase === "error" ? error : server?.status === "failed" ? (server.error ?? t("readFailed")) : null;
  return (
    <li className="pane-inset flex min-w-0 items-start gap-3 px-3 py-3 animate-pop sm:px-4">
      <span className={cx("mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px]", failed ? "bg-bad-soft text-bad" : parsed ? "bg-pine-soft text-pine" : "bg-pane text-ink-3")}>
        {failed ? <CircleAlert size={19} aria-hidden /> : <Icon size={19} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-ink">{name}</p>
          {size ? <span className="num shrink-0 text-[0.8rem] text-ink-4">{formatBytes(size)}</span> : null}
        </div>
        {phase === "uploading" || phase === "signing" || phase === "queued" ? (
          <div className="mt-2">
            <Progress value={Math.round(progress * 100)} label={t("uploading", { name })} />
            <p className="mt-1.5 text-[0.8rem] text-ink-4">{phase === "queued" ? t("queued") : t("uploadingPct", { pct: Math.round(progress * 100) })}</p>
          </div>
        ) : phase === "saving" ? (
          <p className="mt-1 flex items-center gap-2 text-[0.85rem] text-ink-3">
            <ScoutDot live /> {t("saving")}
          </p>
        ) : reading ? (
          <p className="mt-1 flex items-center gap-2 text-[0.85rem] text-ink-3">
            <ScoutDot live /> {t("reading")}
          </p>
        ) : parsed ? (
          <div className="mt-1 text-[0.85rem] text-ink-3">
            <CountsLine counts={server?.counts ?? {}} fallback={server?.warnings?.[0] ?? t("readDone")} />
          </div>
        ) : null}
        {message ? (
          <p className="mt-1 text-[0.85rem] text-bad" role="alert">
            {message}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onRetry || (server?.status === "failed" && onReparse) ? (
          <Button variant="quiet" size="sm" iconOnly aria-label={t("retry", { name })} icon={<RotateCw size={16} aria-hidden />} onClick={onRetry ?? onReparse} />
        ) : null}
        <Button variant="quiet" size="sm" iconOnly aria-label={t("remove", { name })} icon={<X size={16} aria-hidden />} onClick={onRemove} />
      </div>
    </li>
  );
}

function LinkChip({ url, state, error, server, onRemove }: { url: string; state: LinkItem["state"]; error?: string; server?: StatusDoc; onRemove: () => void }) {
  const t = useTranslations("onboarding.upload");
  const label = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const reading = state === "saving" || server?.status === "uploaded" || server?.status === "parsing";
  const failed = state === "error" || server?.status === "failed";
  const note = state === "error" ? error : server?.status === "failed" ? server.error : server?.skipped ? t("linkSavedOnly") : null;
  return (
    <li className="min-w-0 max-w-full">
      <span className={cx("inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-full py-1 pl-3 pr-1 text-[0.88rem]", failed ? "bg-bad-soft text-ink" : "bg-pane-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]")}>
        {reading ? <ScoutDot live /> : failed ? <CircleAlert size={15} className="text-bad" aria-hidden /> : <Link2 size={15} className="text-pine" aria-hidden />}
        <span className="min-w-0 truncate">{label}</span>
        <button type="button" onClick={onRemove} aria-label={t("remove", { name: label })} className="press grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-pane-3 hover:text-ink">
          <X size={14} aria-hidden />
        </button>
      </span>
      {note ? <span className={cx("mt-1 block px-3 text-[0.8rem]", failed ? "text-bad" : "text-ink-4")}>{note}</span> : null}
    </li>
  );
}
