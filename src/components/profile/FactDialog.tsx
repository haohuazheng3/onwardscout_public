"use client";

import { BadgeCheck, CircleHelp, FileText, Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Field, Input, Tag, Textarea, cx } from "@/components/ui";
import { Dialog } from "@/components/ui-client";
import { fixTarget } from "@/lib/profile/sections";
import type { FactView } from "./facts";

/*
 * The source of one value: the person's own word, or a document quote with its file name and
 * how sure we are. "Confirm" makes it theirs; "Fix it" edits it inline and makes the
 * corrected value theirs. Unsourced values say so plainly.
 */

export function SourceChip({ fact, docName, onOpen, className }: { fact: FactView | null; docName: (id: string | null) => string | null; onOpen: () => void; className?: string }) {
  const t = useTranslations("profile.sources");
  const confirmed = fact?.confirmedByUser;
  const name = fact ? docName(fact.sourceDocId) : null;
  const addedByYou = Boolean(fact && !confirmed && !fact.sourceDocId);
  const unsure = fact && !confirmed && !addedByYou && fact.confidence < 0.5;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "press inline-flex min-h-[28px] max-w-[190px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.76rem] font-semibold",
        !fact ? "bg-warn-soft text-warn" : confirmed ? "bg-pine-soft text-pine" : unsure ? "bg-warn-soft text-warn" : "bg-pane-2 text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink",
        className,
      )}
      aria-label={!fact ? t("noSourceLabel") : confirmed ? t("confirmedLabel") : addedByYou ? t("addedByYou") : t("fromLabel", { name: name ?? t("removedSource") })}
    >
      {!fact ? <CircleHelp size={12} aria-hidden /> : confirmed ? <BadgeCheck size={12} aria-hidden /> : <FileText size={12} aria-hidden />}
      <span className="truncate">{!fact ? t("noSource") : confirmed ? t("confirmed") : addedByYou ? t("addedByYou") : (name ?? t("removedSource"))}</span>
    </button>
  );
}

export function FactDialog({
  fact,
  docName,
  onClose,
  onConfirm,
  onFix,
  initialValue,
}: {
  fact: FactView | null;
  docName: (id: string | null) => string | null;
  onClose: () => void;
  onConfirm: (fact: FactView) => Promise<void>;
  onFix: (fact: FactView, value: Record<string, unknown> | string) => Promise<void>;
  /** The value as the profile shows it now (prefills "fix it"). */
  initialValue: unknown;
}) {
  const t = useTranslations("profile.sources");
  const tc = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"confirm" | "fix" | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if ((fact?.id ?? null) !== lastId) {
    setLastId(fact?.id ?? null);
    setEditing(false);
    setBusy(null);
  }
  const target = fact ? fixTarget(fact.path) : null;
  const name = fact ? docName(fact.sourceDocId) : null;

  function startEdit() {
    if (!target) return;
    const v = (initialValue ?? fact?.value) as Record<string, unknown> | string | null;
    const next: Record<string, string> = {};
    for (const f of target.fields) {
      const raw = target.shape === "scalar" ? v : v && typeof v === "object" ? (v as Record<string, unknown>)[f.key] : "";
      next[f.key] = raw == null ? "" : String(raw);
    }
    setDraft(next);
    setEditing(true);
  }

  async function confirm() {
    if (!fact) return;
    setBusy("confirm");
    try {
      await onConfirm(fact);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!fact || !target) return;
    setBusy("fix");
    try {
      await onFix(fact, target.shape === "scalar" ? (draft.value ?? "") : draft);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={Boolean(fact)}
      onClose={onClose}
      title={t("dialogTitle")}
      footer={
        fact ? (
          editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {tc("buttons.cancel")}
              </Button>
              <Button onClick={() => void save()} loading={busy === "fix"}>
                {tc("buttons.save")}
              </Button>
            </>
          ) : (
            <>
              {target ? (
                <Button variant="ghost" onClick={startEdit}>
                  {t("fix")}
                </Button>
              ) : null}
              {!fact.confirmedByUser ? (
                <Button onClick={() => void confirm()} loading={busy === "confirm"}>
                  {t("confirm")}
                </Button>
              ) : (
                <Button variant="ghost" onClick={onClose}>
                  {tc("buttons.close")}
                </Button>
              )}
            </>
          )
        ) : null
      }
    >
      {fact ? (
        editing && target ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {target.fields.map((f) => {
              const id = `fix-${f.key}`;
              const label = target.shape === "scalar" ? t("value") : t(`fields.${f.key}`);
              return (
                <Field key={f.key} id={id} label={label} hint={f.type === "date" ? t("dateHint") : undefined} optional={f.required ? undefined : t("optional")}>
                  {f.type === "textarea" ? (
                    <Textarea id={id} rows={3} value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                  ) : (
                    <Input
                      id={id}
                      value={draft[f.key] ?? ""}
                      inputMode={f.type === "year" ? "numeric" : f.type === "url" ? "url" : undefined}
                      placeholder={f.type === "date" ? "2024-06" : undefined}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    />
                  )}
                </Field>
              );
            })}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        ) : (
          <div className="grid gap-4">
            <p className="text-[1.02rem] font-medium leading-snug text-ink">{fact.claim}</p>
            {fact.confirmedByUser ? (
              <p className="flex items-center gap-2 text-[0.92rem] text-pine">
                <BadgeCheck size={16} aria-hidden />
                {t("confirmedLong")}
              </p>
            ) : null}
            {fact.quote ? (
              <figure className="pane-inset px-4 py-3">
                <Quote size={15} className="text-ink-4" aria-hidden />
                <blockquote className="mt-1 text-[0.95rem] leading-relaxed text-ink-2">{fact.quote}</blockquote>
                <figcaption className="mt-2 flex items-center gap-1.5 text-[0.84rem] text-ink-3">
                  <FileText size={13} aria-hidden />
                  {name ?? (fact.sourceDocId ? t("removedSource") : t("addedByYou"))}
                </figcaption>
              </figure>
            ) : name ? (
              <p className="flex items-center gap-1.5 text-[0.9rem] text-ink-3">
                <FileText size={14} aria-hidden />
                {t("readFrom", { name })}
              </p>
            ) : !fact.confirmedByUser ? (
              <p className="text-[0.9rem] text-ink-3">{t("noQuote")}</p>
            ) : null}
            {!fact.confirmedByUser ? (
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={fact.confidence >= 0.7 ? "pine" : fact.confidence >= 0.5 ? "default" : "warn"}>{fact.confidence >= 0.7 ? t("sure") : fact.confidence >= 0.5 ? t("fairlySure") : t("unsure")}</Tag>
                <span className="text-[0.84rem] text-ink-4">{t("confirmHint")}</span>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </Dialog>
  );
}
