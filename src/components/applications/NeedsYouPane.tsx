"use client";

import { Check, FileUp, PenLine, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, Chip, Pane, Progress, Tag, Textarea, Input, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import type { ApplicationQuestion } from "@/lib/core/types";
import { call, putFile, RequestError, uploadType } from "./api";
import type { RoomApi } from "./useApplication";

/*
 * "Needs you": the gap questions, at most three at a time (plan §1 principle 2). Choices are
 * chips that answer on press; motivation is a pick of reasons (or one sentence of their own);
 * text appears only when unavoidable, with the draft from the profile to keep, edit or rewrite;
 * files upload straight to storage with a signed link.
 */

const PAGE = 3;

/** A chip whose label wraps (reasons and profile values can be long; the shared Chip truncates). */
function WrapChip({ selected, onClick, children, busy }: { selected: boolean; onClick: () => void; children: string; busy?: boolean }) {
  return (
    <button type="button" className="chip h-auto min-h-[44px] max-w-full py-2 text-left leading-snug whitespace-normal" data-selected={selected ? "true" : undefined} aria-pressed={selected} aria-busy={busy || undefined} onClick={onClick}>
      <span className="min-w-0 break-words">{children}</span>
    </button>
  );
}

const MATERIAL_KIND: Record<string, string> = { transcript: "transcript", license: "license", certificate: "certificate", paper: "paper", portfolio: "portfolio", work_samples: "portfolio", pitch_deck: "deck", business_plan: "business_plan", resume: "resume", cv: "cv" };

function ChoiceQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const press = async (value: string) => {
    setPicked(value);
    const r = await room.answer(q, { value });
    if (!r) setPicked(null);
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {(q.options ?? []).map((o) => (
          <WrapChip key={o.value} selected={picked === o.value} onClick={() => press(o.value)} busy={room.busy === `answer:${q.id}` && picked === o.value}>
            {o.label}
          </WrapChip>
        ))}
        <Chip selected={other !== null} onClick={() => setOther(other === null ? "" : null)} icon={<PenLine size={14} aria-hidden />}>
          {t("other")}
        </Chip>
      </div>
      {other !== null ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!other.trim()) return;
            const r = await room.answer(q, { value: null, custom: other.trim() });
            if (r) setOther(null);
          }}
        >
          <Input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder={t("otherPlaceholder")} aria-label={q.prompt} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" loading={room.busy === `answer:${q.id}`} disabled={!other.trim()}>
            {t("save")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function MultiQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState<string | null>(null);
  const toggle = (v: string) => setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= 3 ? cur : [...cur, v]));
  const submit = async () => {
    const r = await room.answer(q, { value: picked, custom: own?.trim() || null });
    if (!r) return;
  };
  return (
    <div className="grid gap-3">
      <p className="text-[0.86rem] text-ink-3">{t("pickUpTo")}</p>
      <div className="flex flex-wrap gap-2">
        {(q.options ?? []).map((o) => (
          <WrapChip key={o.value} selected={picked.includes(o.value)} onClick={() => toggle(o.value)}>
            {o.label}
          </WrapChip>
        ))}
        <Chip selected={own !== null} onClick={() => setOwn(own === null ? "" : null)} icon={<PenLine size={14} aria-hidden />}>
          {t("writeOwn")}
        </Chip>
      </div>
      {own !== null ? <Textarea autoFocus rows={3} value={own} onChange={(e) => setOwn(e.target.value)} placeholder={t("ownPlaceholder")} aria-label={q.prompt} /> : null}
      <div>
        <Button size="sm" onClick={submit} loading={room.busy === `answer:${q.id}`} disabled={!picked.length && !own?.trim()} icon={<Check size={15} aria-hidden />}>
          {t("useThese", { count: Math.max(1, picked.length) })}
        </Button>
      </div>
    </div>
  );
}

function TextQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const [editing, setEditing] = useState(!q.draft);
  const [text, setText] = useState(q.draft ?? "");
  const rewriting = room.busy === `draft:${q.id}`;
  if (q.draft && !editing) {
    return (
      <div className="grid gap-3">
        <div className="pane-inset px-4 py-3.5">
          <Tag tone="pine" dot>
            {t("draftLabel")}
          </Tag>
          <p className={cx("mt-2 whitespace-pre-line text-[0.96rem] leading-relaxed text-ink-2", rewriting && "opacity-50")}>{q.draft}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => room.answer(q, { value: q.draft ?? "", source: "generated" })} loading={room.busy === `answer:${q.id}`} icon={<Check size={15} aria-hidden />}>
            {t("keep")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<PenLine size={15} aria-hidden />}
            onClick={() => {
              setText(q.draft ?? "");
              setEditing(true);
            }}
          >
            {t("edit")}
          </Button>
          <Button size="sm" variant="quiet" icon={<RefreshCw size={15} aria-hidden />} loading={rewriting} onClick={() => room.regenerateDraft(q.id)}>
            {rewriting ? t("rewriting") : t("rewrite")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await room.answer(q, { value: text.trim(), source: "user" });
      }}
    >
      <Textarea rows={Math.min(8, Math.max(3, Math.ceil(text.length / 70)))} value={text} onChange={(e) => setText(e.target.value)} aria-label={q.prompt} placeholder={t("ownPlaceholder")} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={room.busy === `answer:${q.id}`} disabled={!text.trim()}>
          {t("save")}
        </Button>
        {q.draft ? (
          <Button type="button" size="sm" variant="quiet" onClick={() => setEditing(false)}>
            {t("draftLabel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function FileQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  const material = (q.fieldName ?? q.id).replace(/^material:/, "");
  const pick = async (file: File) => {
    const contentType = uploadType(file);
    if (!contentType) {
      toast.error(t("fileHint"));
      return;
    }
    setName(file.name);
    setProgress(0);
    try {
      const signed = await call<{ key: string; uploadUrl: string }>(`/api/applications/${room.view.id}/upload`, { json: { purpose: "answer", filename: file.name, contentType, bytes: file.size } }, room.msgs);
      await putFile(signed.uploadUrl, file, contentType, setProgress);
      setProgress(1);
      const r = await room.answer(q, { file: { key: signed.key, filename: file.name, contentType, kind: MATERIAL_KIND[material] ?? "other" } });
      if (!r) setProgress(null);
    } catch (err) {
      setProgress(null);
      setName(null);
      toast.error(t("uploadFailed"), { body: err instanceof RequestError && err.status >= 400 && err.status < 500 && !err.message.startsWith("upload ") ? err.message : undefined });
    }
  };
  return (
    <div className="grid gap-2">
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept=".pdf,.doc,.docx,.pptx,.png,.jpg,.jpeg,.txt,.zip,.mp4"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" icon={<FileUp size={15} aria-hidden />} onClick={() => input.current?.click()} loading={progress !== null && progress < 1}>
          {t("upload")}
        </Button>
        <span className="text-[0.84rem] text-ink-4">{t("fileHint")}</span>
      </div>
      {progress !== null ? <Progress value={Math.round(progress * 100)} label={progress < 1 ? t("uploading", { percent: Math.round(progress * 100) }) : t("uploaded", { name: name ?? "" })} showValue={false} /> : null}
      {progress !== null ? <p className="text-[0.84rem] text-ink-3">{progress < 1 ? t("uploading", { percent: Math.round(progress * 100) }) : t("uploaded", { name: name ?? "" })}</p> : null}
    </div>
  );
}

function ConfirmQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const [on, setOn] = useState(false);
  return (
    <Chip
      selected={on}
      icon={<Check size={15} aria-hidden />}
      onClick={async () => {
        setOn(true);
        const r = await room.answer(q, { value: true });
        if (!r) setOn(false);
      }}
    >
      {q.options?.[0]?.label ?? t("agree")}
    </Chip>
  );
}

export function NeedsYouPane({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const [skipped, setSkipped] = useState<string[]>([]);
  const all = room.view.questions;
  const open = all.filter((q) => !skipped.includes(q.id));
  const [initialTotal] = useState(() => Math.max(all.length, 1));
  const total = Math.max(initialTotal, all.length);
  if (!open.length) {
    return room.view.status === "preparing" ? (
      <Pane pad="md" className="min-w-0">
        <p className="flex items-center gap-2 text-ink-2">
          <Check size={18} className="text-ok" aria-hidden />
          {t("allDone")}
        </p>
      </Pane>
    ) : null;
  }
  const shown = open.slice(0, PAGE);
  const done = Math.max(0, total - all.length);
  return (
    <Pane pad="md" className="min-w-0 shadow-[0_0_0_2px_var(--accent-soft)]" aria-labelledby="needs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="needs-title" className="title text-[1.2rem] text-ink">
            {t("title")}
          </h2>
          <p className="mt-1 max-w-xl text-[0.92rem] leading-relaxed text-ink-3">{t("lede")}</p>
        </div>
        <Tag tone="accent">{t("progress", { done, total })}</Tag>
      </div>
      <ol className="mt-5 grid gap-4">
        {shown.map((q) => (
          <li key={q.id} className="pane-inset px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[1.02rem] font-medium leading-snug text-ink">{q.prompt}</p>
              {q.required === false ? <Tag>{t("optional")}</Tag> : null}
            </div>
            <p className="mt-1.5 text-[0.86rem] leading-snug text-ink-3">{q.why}</p>
            <div className="mt-3.5">
              {q.kind === "choice" ? <ChoiceQuestion q={q} room={room} /> : null}
              {q.kind === "multi" ? <MultiQuestion q={q} room={room} /> : null}
              {q.kind === "text" ? <TextQuestion q={q} room={room} /> : null}
              {q.kind === "file" ? <FileQuestion q={q} room={room} /> : null}
              {q.kind === "confirm" ? <ConfirmQuestion q={q} room={room} /> : null}
            </div>
            {q.required === false ? (
              <Button size="sm" variant="quiet" className="mt-2" onClick={() => setSkipped((s) => [...s, q.id])}>
                {t("skip")}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {open.length > PAGE ? <p className="mt-3 text-[0.86rem] text-ink-4">{t("moreLater", { count: open.length - PAGE })}</p> : null}
    </Pane>
  );
}
