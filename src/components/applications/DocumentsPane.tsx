"use client";

import { Check, Download, FileText, History, Lock, PenLine, RefreshCw, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Callout, Chip, Pane, Skeleton, SkeletonText, Tag, Textarea, cx } from "@/components/ui";
import { Tabs, toast } from "@/components/ui-client";
import type { DocumentBlockView, DocumentVersionView, DocumentView, FactView } from "@/lib/applications/types";
import { DeckPreview } from "./DeckPreview";
import type { RoomApi } from "./useApplication";

/*
 * Documents, block by block. Tap a sentence: its sources open beneath it (the fact's claim, the
 * quote from the person's own file) and it can be edited in place — the person's edit is saved
 * as their own words. Gap blocks are the spots only the person can write. Downloads render on
 * demand (PDF / DOCX, pitch notes also PPTX).
 */

export function SourceList({ ids, facts, notes = [] }: { ids: string[]; facts: Record<string, FactView>; notes?: string[] }) {
  const t = useTranslations("applications.documents");
  const items = ids.filter((id) => id !== "user:confirmed");
  const mine = ids.includes("user:confirmed");
  if (!items.length && !mine) return <p className="text-[0.86rem] text-ink-3">{t("noSource")}</p>;
  return (
    <ul className="grid gap-2" aria-label={t("sources")}>
      {mine ? (
        <li className="flex items-center gap-2 text-[0.88rem] text-ink-2">
          <Tag tone="pine" dot>
            {t("yourWords")}
          </Tag>
        </li>
      ) : null}
      {items.map((id) => {
        const noteN = /^answer:note_(\d+)$/.exec(id);
        if (noteN) {
          const note = notes[Number(noteN[1]) - 1];
          return (
            <li key={id} className="grid gap-1 text-[0.88rem] text-ink-2">
              <Tag tone="pine" dot>
                {t("fromNote")}
              </Tag>
              {note ? <span className="text-ink-3">{t("quote", { quote: note })}</span> : null}
            </li>
          );
        }
        if (id.startsWith("answer:")) {
          return (
            <li key={id} className="text-[0.88rem] text-ink-2">
              <Tag tone="pine" dot>
                {t("yourAnswer")}
              </Tag>
            </li>
          );
        }
        const f = facts[id];
        if (!f) return null;
        return (
          <li key={id} className="rounded-[14px] bg-pane px-3 py-2.5 text-[0.88rem] leading-snug shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="text-ink">{f.claim}</p>
            {f.quote ? <p className="mt-1 text-ink-3">{t("quote", { quote: f.quote })}</p> : null}
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8rem] text-ink-4">
              <FileText size={13} aria-hidden />
              {f.source ? t("fromFile", { file: f.source }) : null}
              {f.confirmedByUser ? <Tag tone="ok">{t("confirmedByYou")}</Tag> : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** A block the free preview hides: the same shape, blurred, never the text (the API masked it). */
export function MaskedBlock({ b, kind }: { b: DocumentBlockView; kind: string }) {
  return (
    <div aria-hidden className="select-none blur-[5px] opacity-70" data-masked>
      <BlockText b={b} kind={kind} />
    </div>
  );
}

export function BlockText({ b, kind }: { b: DocumentBlockView; kind: string }) {
  if (b.type === "heading") return <p className={cx("font-semibold text-ink", kind === "resume_variant" ? "text-[0.8rem] uppercase tracking-[0.08em] text-pine" : "text-[1.02rem]")}>{b.text}</p>;
  if (b.type === "bullet")
    return (
      <p className="flex gap-2.5">
        <span aria-hidden className="text-ink-4">
          •
        </span>
        <span className="min-w-0">{b.text}</span>
      </p>
    );
  if (b.type === "field")
    return (
      <div className={cx(kind === "resume_variant" ? "flex flex-wrap items-baseline justify-between gap-x-4" : "")}>
        {b.label ? <p className={cx(kind === "resume_variant" ? "font-semibold text-ink" : "text-[0.8rem] font-semibold uppercase tracking-[0.06em] text-ink-3")}>{b.label}</p> : null}
        {b.text ? <p className={cx(kind === "resume_variant" ? "text-[0.86rem] text-ink-3" : "mt-0.5")}>{b.text}</p> : null}
      </div>
    );
  return <p className="whitespace-pre-line">{b.text}</p>;
}

function DocumentBody({ doc, facts, room, editable }: { doc: DocumentVersionView; facts: Record<string, FactView>; room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.documents");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (i: number, b: DocumentBlockView) => {
    setEditing(i);
    setSelected(i);
    setDraft(b.role === "gap" ? "" : b.text);
  };
  const save = async (i: number) => {
    const text = draft;
    setEditing(null);
    const r = await room.editBlock(doc.id, i, text);
    if (!r) setEditing(i);
  };

  const firstMasked = doc.blocks.findIndex((b) => b.flags.includes("masked"));
  return (
    <div className="pane-inset min-w-0 px-4 py-5 text-[0.98rem] leading-relaxed text-ink-2 sm:px-7 sm:py-7">
      <div className="mx-auto grid max-w-[680px] gap-3">
        {doc.blocks.map((b, i) => {
          const gap = b.role === "gap";
          const isSel = selected === i;
          if (b.flags.includes("masked")) {
            return (
              <div key={i} className="relative">
                {i === firstMasked ? (
                  <p className="pointer-events-none absolute inset-x-0 top-6 z-10 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-pane px-3.5 py-1.5 text-[0.84rem] font-medium text-ink shadow-[0_8px_30px_-10px_rgba(18,22,20,.35),0_0_0_1px_var(--line-2)]">
                    <Lock size={13} aria-hidden /> {t("maskedHint")}
                  </p>
                ) : null}
                <MaskedBlock b={b} kind={doc.kind} />
              </div>
            );
          }
          if (editing === i) {
            return (
              <div key={i} className="grid gap-2">
                {gap && b.label ? <p className="text-[0.9rem] font-medium text-ink">{b.label}</p> : null}
                <Textarea
                  value={draft}
                  autoFocus
                  rows={Math.min(10, Math.max(3, Math.ceil(draft.length / 70)))}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={t("editLabel")}
                  placeholder={gap ? b.text : undefined}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => save(i)} loading={room.busy === `block:${doc.id}:${i}`} disabled={gap && !draft.trim()}>
                    {t("save")}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setEditing(null)}>
                    {t("cancel")}
                  </Button>
                </div>
              </div>
            );
          }
          if (gap) {
            return (
              <div key={i} className="rounded-[16px] border border-dashed border-[var(--accent)] bg-accent-soft px-4 py-3">
                <p className="text-[0.8rem] font-semibold uppercase tracking-[0.06em] text-accent-text">{t("gap")}</p>
                <p className="mt-1 text-ink">{b.label ?? b.text}</p>
                {editable ? (
                  <Button size="sm" variant="ghost" className="mt-2.5" icon={<PenLine size={15} aria-hidden />} onClick={() => startEdit(i, b)}>
                    {t("fillGap")}
                  </Button>
                ) : null}
              </div>
            );
          }
          return (
            <div key={i} className={cx("rounded-[14px] transition-colors", isSel ? "bg-pane px-3 py-2.5 shadow-[0_0_0_1px_var(--line-2)]" : "-mx-3 px-3 py-0.5 hover:bg-pane/60")}>
              <button type="button" className="press block w-full text-left" aria-expanded={isSel} onClick={() => setSelected(isSel ? null : i)}>
                <BlockText b={b} kind={doc.kind} />
              </button>
              {isSel ? (
                <div className="mt-3 grid gap-3 border-t border-line pt-3" aria-label={t("sources")}>
                  <SourceList ids={b.factIds} facts={facts} notes={doc.revisions.filter((r) => !r.restore).map((r) => r.note)} />
                  {editable ? (
                    <div>
                      <Button size="sm" variant="ghost" icon={<PenLine size={15} aria-hidden />} onClick={() => startEdit(i, b)}>
                        {t("edit")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LABEL_TONE = { drafted_from_profile: "pine", written_with_ai: "accent", edited_by_you: "ok" } as const;

type ChipKey = "shorter" | "confident" | "specific" | "toZh" | "toEn" | "deckTraction" | "deckProblem" | "deckCompetition" | "deckFewer" | "resumeRole" | "resumeNumbers" | "resumeOnePage" | "letterProject" | "letterWarm";
type Group = "deck" | "resume" | "letter" | "general";

const CHIPS: Record<Group, ChipKey[]> = {
  deck: ["deckTraction", "deckProblem", "deckFewer", "deckCompetition"],
  resume: ["resumeRole", "resumeNumbers", "resumeOnePage"],
  letter: ["shorter", "letterProject", "confident", "letterWarm"],
  general: ["shorter", "specific", "confident"],
};

function groupOf(kind: string): Group {
  if (kind === "pitch_notes") return "deck";
  if (kind === "resume_variant") return "resume";
  if (kind === "cover_letter" || kind === "email") return "letter";
  return "general";
}

/** One tab per document slot: the first email and its follow-up are separate documents of one kind. */
function slotOf(d: DocumentView): string {
  return `${d.kind}:${d.composer === "email_follow_up" ? "follow_up" : ""}`;
}

/**
 * "Tell the AI what to change": a note in the person's words, or one tap on a suggestion. The
 * current version stays on screen (dimmed) until the new one is ready; what changed is shown on
 * the new version.
 */
function ReviseBox({ doc, room }: { doc: DocumentView; room: RoomApi }) {
  const t = useTranslations("applications.documents");
  const tk = useTranslations("applications.kinds");
  const [note, setNote] = useState("");
  const busy = room.busy === `revise:${doc.id}`;
  const other = room.busy !== null && !busy;
  const group = groupOf(doc.kind);
  const chips: ChipKey[] = [...CHIPS[group], doc.language.startsWith("zh") ? "toEn" : "toZh"];

  const send = async (text: string, fromBox: boolean) => {
    const clean = text.trim();
    if (clean.length < 2 || busy) return;
    const r = await room.reviseDocument(doc.id, clean);
    if (!r) return;
    if (fromBox) setNote("");
    const fresh = r.application?.documents.find((d) => d.id === r.documentId);
    toast.success(t("revise.done", { n: fresh?.version ?? doc.version + 1 }));
  };

  return (
    <section className="rounded-[20px] bg-pane-2 p-4 shadow-[inset_0_0_0_1px_var(--line)] sm:p-5" aria-labelledby={`revise-${doc.id}`}>
      <h3 id={`revise-${doc.id}`} className="flex items-center gap-2 font-semibold text-ink">
        <Wand2 size={17} className="text-accent-text" aria-hidden />
        {t("revise.title")}
      </h3>
      <p className="mt-1 text-[0.86rem] leading-relaxed text-ink-3">{t("revise.hint")}</p>
      <p className="sr-only">{t("revise.suggestions")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Chip key={c} size="sm" disabled={busy || other} onClick={() => send(t(`revise.chips.${c}`), false)}>
            {t(`revise.chips.${c}`)}
          </Chip>
        ))}
      </div>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(note, true);
        }}
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder={t(`revise.placeholder.${group}`)} aria-label={t("revise.title")} disabled={busy} />
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-[0.8rem] text-ink-4" aria-live="polite">
            {busy ? t("revise.working", { kind: tk.has(doc.kind) ? tk(doc.kind) : doc.title }) : null}
          </p>
          <Button type="submit" size="sm" loading={busy} disabled={note.trim().length < 2 || other} icon={<Sparkles size={15} aria-hidden />}>
            {t("revise.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function DocumentPanel({ doc, room, editable }: { doc: DocumentView; room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.documents");
  const tk = useTranslations("applications.kinds");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"slides" | "text">("slides");
  const viewing = viewingId ? (doc.versions.find((v) => v.id === viewingId) ?? null) : null;
  const shown: DocumentVersionView = viewing ?? doc;
  const locked = room.view.access.locked;
  // A locked deck reads as text: its slides would show the masked stand-ins unblurred.
  const deck = doc.kind === "pitch_notes" && !locked;
  const revising = room.busy === `revise:${doc.id}`;
  const regenerating = room.busy === `regen:${doc.id}`;
  const restoring = viewing ? room.busy === `restore:${viewing.id}` : false;
  const last = doc.revisions[doc.revisions.length - 1];
  const changed = !viewing && last && !last.restore ? last : null;

  const restore = async () => {
    if (!viewing) return;
    const r = await room.restoreDocument(viewing.id);
    if (!r) return;
    setViewingId(null);
    toast.success(t("versions.restored", { n: viewing.version }));
  };

  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium text-ink">{shown.title}</p>
        <Tag tone={LABEL_TONE[shown.label]} dot>
          {shown.label === "written_with_ai" ? <Sparkles size={13} aria-hidden /> : null}
          {t(`labels.${shown.label}`)}
        </Tag>
      </div>

      {doc.versions.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("versions.title")}>
          <History size={15} className="mr-0.5 text-ink-4" aria-hidden />
          <Chip size="sm" selected={!viewing} onClick={() => setViewingId(null)}>
            {t("versions.current", { n: doc.version })}
          </Chip>
          {doc.versions.map((v) => (
            <Chip key={v.id} size="sm" selected={viewingId === v.id} onClick={() => setViewingId(v.id)}>
              {t("versions.older", { n: v.version })}
            </Chip>
          ))}
        </div>
      ) : null}

      {viewing ? (
        <Callout tone="info" title={t("versions.viewing", { n: viewing.version })}>
          {(() => {
            const note = [...viewing.revisions].reverse().find((r) => !r.restore);
            return note ? <span className="block">{t("versions.noteLabel", { note: note.note })}</span> : null;
          })()}
          {editable ? (
            <span className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" onClick={restore} loading={restoring} icon={<RotateCcw size={15} aria-hidden />}>
                {t("versions.restore")}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setViewingId(null)}>
                {t("versions.back")}
              </Button>
            </span>
          ) : null}
        </Callout>
      ) : null}

      {changed ? (
        <Callout tone="ok" title={t("revise.changed", { n: doc.version })}>
          {changed.changes.length ? (
            <ul className="grid gap-1">
              {changed.changes.map((c) => (
                <li key={c} className="flex gap-2">
                  <Check size={15} className="mt-[3px] shrink-0" aria-hidden />
                  <span className="min-w-0">{c}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="mt-1.5 block text-ink-3">{t("versions.noteLabel", { note: changed.note })}</span>
        </Callout>
      ) : null}

      {shown.notes.map((n) => (
        <Callout key={n} tone="info" title={t("notes")}>
          {n}
        </Callout>
      ))}

      {deck ? (
        <Tabs
          size="sm"
          label={t("view.label")}
          value={mode}
          onChange={(v) => setMode(v === "text" ? "text" : "slides")}
          items={[
            { id: "slides", label: t("view.slides") },
            { id: "text", label: t("view.text") },
          ]}
        />
      ) : null}

      {regenerating ? (
        <div className="pane-inset px-5 py-6" aria-busy="true">
          <p className="mb-4 text-[0.9rem] text-ink-3">{t("regenerating")}</p>
          <Skeleton className="block h-4 w-1/3 rounded-full" />
          <SkeletonText lines={6} className="mt-4" />
        </div>
      ) : (
        <div className="relative min-w-0" aria-busy={revising}>
          <div className={cx("min-w-0 transition-opacity duration-300", revising && "pointer-events-none opacity-35")}>
            {deck && mode === "slides" ? (
              <DeckPreview blocks={shown.blocks} onFillGap={editable && !viewing ? () => setMode("text") : undefined} />
            ) : (
              <DocumentBody key={shown.id} doc={shown} facts={room.view.facts} room={room} editable={editable && !viewing} />
            )}
          </div>
          {revising ? (
            <div className="absolute inset-x-0 top-6 z-10 mx-auto w-[min(92%,420px)] rounded-[20px] bg-pane p-5 shadow-[0_12px_40px_-12px_rgba(18,22,20,.35),0_0_0_1px_var(--line-2)]" role="status">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Sparkles size={16} className="text-accent-text" aria-hidden />
                {t("revise.working", { kind: tk.has(doc.kind) ? tk(doc.kind) : doc.title })}
              </p>
              <p className="mt-1 text-[0.86rem] text-ink-3">{t("revise.workingBody")}</p>
              <SkeletonText lines={3} className="mt-4" />
            </div>
          ) : null}
        </div>
      )}

      {editable && !viewing ? <ReviseBox doc={doc} room={room} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {locked ? (
          <p className="flex items-center gap-1.5 text-[0.86rem] text-ink-3">
            <Lock size={14} aria-hidden /> {t("lockedDownloads")}
          </p>
        ) : null}
        {shown.formats.map((f) => (
          <Button key={f} size="sm" variant="ghost" icon={<Download size={15} aria-hidden />} loading={room.busy === `download:${shown.id}:${f}`} onClick={() => room.download(shown.id, f)}>
            {room.busy === `download:${shown.id}:${f}` ? t("downloading", { format: f.toUpperCase() }) : t("download", { format: f.toUpperCase() })}
          </Button>
        ))}
        {editable && !viewing ? (
          <Button size="sm" variant="quiet" icon={<RefreshCw size={15} aria-hidden />} loading={regenerating} disabled={revising} onClick={() => room.regenerateDocument(doc.id)} className="ml-auto">
            {t("regenerate")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DocumentsPane({ room, editable }: { room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.documents");
  const tk = useTranslations("applications.kinds");
  const docs = room.view.documents;
  const [active, setActive] = useState<string | null>(null);
  const current = docs.find((d) => slotOf(d) === active) ?? docs[0] ?? null;

  if (!docs.length) {
    return (
      <Pane pad="md" className="min-w-0">
        <h2 className="title text-[1.2rem] text-ink">{t("title")}</h2>
        <p className="mt-2 text-[0.95rem] text-ink-3">{t("empty")}</p>
      </Pane>
    );
  }

  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="docs-title">
      <div className="flex flex-col gap-1">
        <h2 id="docs-title" className="title text-[1.2rem] text-ink">
          {t("title")}
        </h2>
        <p className="text-[0.92rem] leading-relaxed text-ink-3">{t("lede")}</p>
      </div>
      {docs.length > 1 ? (
        <Tabs
          className="mt-4"
          size="sm"
          label={t("tabs")}
          value={current ? slotOf(current) : undefined}
          onChange={setActive}
          items={docs.map((d) => ({ id: slotOf(d), label: tk.has(d.kind) ? tk(d.kind) : d.title, count: d.gaps.length || undefined }))}
        />
      ) : null}
      {current ? <DocumentPanel key={slotOf(current)} doc={current} room={room} editable={editable} /> : null}
    </Pane>
  );
}
