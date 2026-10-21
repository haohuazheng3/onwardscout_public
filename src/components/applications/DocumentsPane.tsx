"use client";

import { Download, FileText, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Callout, Pane, Skeleton, SkeletonText, Tag, Textarea, cx } from "@/components/ui";
import { Tabs } from "@/components/ui-client";
import type { DocumentBlockView, DocumentView, FactView } from "@/lib/applications/types";
import type { RoomApi } from "./useApplication";

/*
 * Documents, block by block. Tap a sentence: its sources open beneath it (the fact's claim, the
 * quote from the person's own file) and it can be edited in place — the person's edit is saved
 * as their own words. Gap blocks are the spots only the person can write. Downloads render on
 * demand (PDF / DOCX, pitch notes also PPTX).
 */

export function SourceList({ ids, facts }: { ids: string[]; facts: Record<string, FactView> }) {
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

function BlockText({ b, kind }: { b: DocumentBlockView; kind: string }) {
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

function DocumentBody({ doc, facts, room, editable }: { doc: DocumentView; facts: Record<string, FactView>; room: RoomApi; editable: boolean }) {
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

  return (
    <div className="pane-inset min-w-0 px-4 py-5 text-[0.98rem] leading-relaxed text-ink-2 sm:px-7 sm:py-7">
      <div className="mx-auto grid max-w-[680px] gap-3">
        {doc.blocks.map((b, i) => {
          const gap = b.role === "gap";
          const isSel = selected === i;
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
                  <SourceList ids={b.factIds} facts={facts} />
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

export function DocumentsPane({ room, editable }: { room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.documents");
  const tk = useTranslations("applications.kinds");
  const docs = room.view.documents;
  const [active, setActive] = useState<string | null>(null);
  const current = docs.find((d) => d.id === active) ?? docs[0] ?? null;

  if (!docs.length) {
    return (
      <Pane pad="md" className="min-w-0">
        <h2 className="title text-[1.2rem] text-ink">{t("title")}</h2>
        <p className="mt-2 text-[0.95rem] text-ink-3">{t("empty")}</p>
      </Pane>
    );
  }

  const regenerating = current ? room.busy === `regen:${current.id}` : false;

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
          value={current?.id}
          onChange={setActive}
          items={docs.map((d) => ({ id: d.id, label: tk.has(d.kind) ? tk(d.kind) : d.title, count: d.gaps.length || undefined }))}
        />
      ) : null}
      {current ? (
        <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-medium text-ink">{current.title}</p>
            <Tag tone={LABEL_TONE[current.label]} dot>
              {current.label === "written_with_ai" ? <Sparkles size={13} aria-hidden /> : null}
              {t(`labels.${current.label}`)}
            </Tag>
            {current.version > 1 ? <Tag>{t("version", { n: current.version })}</Tag> : null}
          </div>
          {current.notes.map((n) => (
            <Callout key={n} tone="info" title={t("notes")}>
              {n}
            </Callout>
          ))}
          {regenerating ? (
            <div className="pane-inset px-5 py-6" aria-busy="true">
              <p className="mb-4 text-[0.9rem] text-ink-3">{t("regenerating")}</p>
              <Skeleton className="block h-4 w-1/3 rounded-full" />
              <SkeletonText lines={6} className="mt-4" />
            </div>
          ) : (
            <DocumentBody key={current.id} doc={current} facts={room.view.facts} room={room} editable={editable} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {current.formats.map((f) => (
              <Button key={f} size="sm" variant="ghost" icon={<Download size={15} aria-hidden />} loading={room.busy === `download:${current.id}:${f}`} onClick={() => room.download(current.id, f)}>
                {room.busy === `download:${current.id}:${f}` ? t("downloading", { format: f.toUpperCase() }) : t("download", { format: f.toUpperCase() })}
              </Button>
            ))}
            {editable ? (
              <Button size="sm" variant="quiet" icon={<RefreshCw size={15} aria-hidden />} loading={regenerating} onClick={() => room.regenerateDocument(current.id)} className="ml-auto">
                {t("regenerate")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Pane>
  );
}
