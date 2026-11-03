"use client";

import { FileUp, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, Input, Pane, Progress, Tag } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { fileItems, filesBlockConfirm, isLinkAnswer, materialOf } from "@/lib/applications/materials";
import type { ApplicationQuestion } from "@/lib/core/types";
import { call, putFile, RequestError, uploadType } from "./api";
import type { RoomApi } from "./useApplication";

/*
 * Files only the person holds (a transcript, a demo video, work samples…). They are never a
 * question that holds the drafts back: a file the organiser needs to accept the application is
 * "needed to submit" (confirm waits for it where we submit; on a handoff it is attached on the
 * official form), a deliverable made later is "later, if they ask" and waits for nothing. Each
 * uploads straight to storage with a signed link, or takes a link instead (a video on YouTube,
 * a repository).
 */

const MATERIAL_KIND: Record<string, string> = { transcript: "transcript", license: "license", certificate: "certificate", paper: "paper", portfolio: "portfolio", work_samples: "portfolio", pitch_deck: "deck", business_plan: "business_plan", resume: "resume", cv: "cv" };

export function FileQuestion({ q, room }: { q: ApplicationQuestion; room: RoomApi }) {
  const t = useTranslations("applications.questions");
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const material = materialOf(q) ?? "";
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
  const linkOk = link !== null && isLinkAnswer(link);
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
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<FileUp size={15} aria-hidden />} onClick={() => input.current?.click()} loading={progress !== null && progress < 1}>
          {t("upload")}
        </Button>
        <Button size="sm" variant="quiet" icon={<Link2 size={15} aria-hidden />} aria-expanded={link !== null} onClick={() => setLink(link === null ? "" : null)}>
          {t("pasteLink")}
        </Button>
      </div>
      <span className="text-[0.84rem] text-ink-4">{t("fileHint")}</span>
      {link !== null ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!linkOk) return;
            const r = await room.answer(q, { value: link.trim() });
            if (r) setLink(null);
          }}
        >
          <Input autoFocus type="url" inputMode="url" autoCapitalize="none" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label={t("linkLabel", { name: q.prompt })} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" loading={room.busy === `answer:${q.id}`} disabled={!linkOk}>
            {t("save")}
          </Button>
        </form>
      ) : null}
      {progress !== null ? <Progress value={Math.round(progress * 100)} label={progress < 1 ? t("uploading", { percent: Math.round(progress * 100) }) : t("uploaded", { name: name ?? "" })} showValue={false} /> : null}
      {progress !== null ? <p className="text-[0.84rem] text-ink-3">{progress < 1 ? t("uploading", { percent: Math.round(progress * 100) }) : t("uploaded", { name: name ?? "" })}</p> : null}
    </div>
  );
}

export function FilesPane({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.files");
  const v = room.view;
  const { needed, later, optional } = fileItems(v.questions, v.opportunity.type);
  const items = [...needed, ...optional, ...later];
  if (!items.length || v.submittedAt) return null;
  const blocking = filesBlockConfirm(v);
  const tagOf = (q: ApplicationQuestion) => (needed.includes(q) ? <Tag tone="accent">{blocking ? t("needed") : t("neededHandoff")}</Tag> : later.includes(q) ? <Tag tone="pine">{t("later")}</Tag> : <Tag>{t("optional")}</Tag>);
  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="files-title">
      <h2 id="files-title" className="title text-[1.05rem] text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-3">{t("lede")}</p>
      <ul className="mt-4 grid gap-3">
        {items.map((q) => (
          <li key={q.id} className="pane-inset grid gap-2 px-4 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 font-medium leading-snug text-ink">{q.prompt}</p>
              {tagOf(q)}
            </div>
            <p className="text-[0.84rem] leading-snug text-ink-3">{needed.includes(q) && !blocking ? t("handoffNote") : q.why}</p>
            <FileQuestion q={q} room={room} />
          </li>
        ))}
      </ul>
    </Pane>
  );
}
