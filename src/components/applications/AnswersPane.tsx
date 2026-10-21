"use client";

import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Input, Pane, Tag, Textarea } from "@/components/ui";
import type { AnswerView } from "@/lib/applications/types";
import { SourceList } from "./DocumentsPane";
import type { RoomApi } from "./useApplication";

/** Each form answer with where it came from; editable until the application is submitted. */
export function AnswersPane({ room, editable }: { room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.answers");
  const answers = room.view.answers;
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (!answers.length) return null;

  const sourceTag = (a: AnswerView) =>
    a.source === "profile" ? (
      <Tag tone="pine" dot>
        {t("fromProfile")}
      </Tag>
    ) : a.source === "generated" ? (
      <Tag tone="accent" dot>
        {t("drafted")}
      </Tag>
    ) : a.source === "default" ? (
      <Tag>{t("default")}</Tag>
    ) : (
      <Tag tone="ok" dot>
        {t("yourAnswer")}
      </Tag>
    );

  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="answers-title">
      <h2 id="answers-title" className="title text-[1.2rem] text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 text-[0.92rem] text-ink-3">{t("lede")}</p>
      <ul className="mt-4 divide-y divide-[var(--line)]">
        {answers.map((a) => (
          <li key={a.key} className="py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[0.86rem] font-medium text-ink-3">{a.label}</p>
              {sourceTag(a)}
            </div>
            {editing === a.key ? (
              <form
                className="mt-2 grid gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setEditing(null);
                  const r = await room.editAnswer(a.key, draft);
                  if (!r) setEditing(a.key);
                }}
              >
                {a.long ? <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={a.label} autoFocus /> : <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={a.label} autoFocus />}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={!draft.trim()} loading={room.busy === `edit:${a.key}`}>
                    {t("save")}
                  </Button>
                  <Button type="button" size="sm" variant="quiet" onClick={() => setEditing(null)}>
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <button type="button" className="press mt-1 block w-full text-left" aria-expanded={open === a.key} onClick={() => setOpen(open === a.key ? null : a.key)}>
                <p className="whitespace-pre-line break-words text-[0.97rem] leading-relaxed text-ink">{a.value}</p>
              </button>
            )}
            {open === a.key && editing !== a.key ? (
              <div className="mt-3 grid gap-3">
                {a.factIds.length ? <SourceList ids={a.factIds} facts={room.view.facts} /> : null}
                {editable ? (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<PenLine size={15} aria-hidden />}
                      onClick={() => {
                        setDraft(a.value);
                        setEditing(a.key);
                      }}
                    >
                      {t("edit")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Pane>
  );
}
