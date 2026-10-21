"use client";

import { Camera, Check, Download, ExternalLink, ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, ButtonLink, Callout, Field, Input, Pane, Tag, cx } from "@/components/ui";
import { CopyButton, toast } from "@/components/ui-client";
import type { HandoffPackage } from "@/lib/applications/types";
import { call, putFile } from "./api";

/*
 * The 30-second handoff (plan §7.3, CH6): everything the official form needs, in the form's
 * order — steps, one-tap copy per field, the files, the exact link — then "I submitted it" with
 * an optional confirmation link, reference and screenshot. Phone-first: big copy buttons, one
 * column, long values collapsed until opened.
 */

export interface HandoffDoneInput {
  url?: string;
  reference?: string;
  screenshotKey?: string;
}

export function HandoffPanel({
  applicationId,
  handoff,
  reason,
  canComplete,
  completing = false,
  onComplete,
  onDownloadGenerated,
  onDownloadFile,
  busyKey,
  className,
}: {
  applicationId: string;
  handoff: HandoffPackage;
  /** needs_you_reason: captcha, login, payment, unsupported, blocked, no_gmail… */
  reason?: string | null;
  /** Show "I submitted it" (the application is waiting on the person). */
  canComplete: boolean;
  completing?: boolean;
  onComplete: (input: HandoffDoneInput) => Promise<unknown>;
  onDownloadGenerated: (generatedDocumentId: string) => void;
  onDownloadFile: (documentId: string) => void;
  /** The busy key of the room, to show which download is preparing. */
  busyKey?: string | null;
  className?: string;
}) {
  const t = useTranslations("applications.handoff");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [url, setUrl] = useState("");
  const [reference, setReference] = useState("");
  const [shot, setShot] = useState<{ key: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reasonKey = reason && ["captcha", "login", "payment", "unsupported", "blocked", "no_gmail"].includes(reason) ? reason : "handoff";

  const uploadShot = async (file: File) => {
    const contentType = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/png" ? "image/png" : null;
    if (!contentType) {
      toast.error(t("screenshot"));
      return;
    }
    setUploading(true);
    try {
      const signed = await call<{ key: string; uploadUrl: string }>(`/api/applications/${applicationId}/upload`, { json: { purpose: "evidence", filename: file.name, contentType, bytes: file.size } });
      await putFile(signed.uploadUrl, file, contentType, () => undefined);
      setShot({ key: signed.key, name: file.name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("screenshot"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Pane pad="md" className={cx("min-w-0", className)} aria-labelledby="handoff-title">
      <h2 id="handoff-title" className="title text-[1.2rem] text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-3">{t("lede")}</p>
      <Callout tone="accent" className="mt-4">
        {t(`reasons.${reasonKey}`)}
      </Callout>

      {handoff.url ? (
        <div className="mt-4">
          <ButtonLink href={handoff.url} external variant="ink" block iconRight={<ExternalLink size={16} aria-hidden />}>
            {t("open")}
          </ButtonLink>
        </div>
      ) : null}

      {handoff.steps.length ? (
        <section className="mt-6" aria-labelledby="handoff-steps">
          <h3 id="handoff-steps" className="flex items-center gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
            <ListOrdered size={15} aria-hidden />
            {t("steps")}
          </h3>
          <ol className="mt-3 grid gap-2.5">
            {handoff.steps.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pine-soft text-[0.85rem] font-semibold text-pine">{s.n}</span>
                <p className="min-w-0 pt-0.5 text-[0.96rem] leading-snug text-ink-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {handoff.fields.length ? (
        <section className="mt-6" aria-labelledby="handoff-fields">
          <h3 id="handoff-fields" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
            {t("fields")}
          </h3>
          <ul className="mt-3 grid gap-2">
            {handoff.fields.map((f, i) => {
              const long = f.long || f.value.length > 160;
              const open = expanded[i] ?? !long;
              return (
                <li key={`${f.label}-${i}`} className="pane-inset flex min-w-0 items-start gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8rem] font-medium text-ink-3">{f.label}</p>
                    <p className={cx("mt-0.5 whitespace-pre-line break-words text-[0.96rem] text-ink", !open && "line-clamp-3")}>{f.value || "—"}</p>
                    {long ? (
                      <button type="button" className="press mt-1 text-[0.84rem] font-medium text-accent-text" onClick={() => setExpanded((e) => ({ ...e, [i]: !open }))}>
                        {open ? t("showLess") : t("showMore")}
                      </button>
                    ) : null}
                  </div>
                  {f.value ? <CopyButton text={f.value} label={t("copy")} copiedLabel={t("copied")} size="sm" className="shrink-0" /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {handoff.files.length ? (
        <section className="mt-6" aria-labelledby="handoff-files">
          <h3 id="handoff-files" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
            {t("files")}
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {handoff.files.map((f) => {
              const key = f.generatedDocumentId ? `download:${f.generatedDocumentId}:pdf` : f.documentId ? `file:${f.documentId}` : f.name;
              return (
                <li key={`${f.name}-${f.generatedDocumentId ?? f.documentId ?? ""}`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Download size={15} aria-hidden />}
                    loading={busyKey === key}
                    disabled={!f.generatedDocumentId && !f.documentId}
                    onClick={() => (f.generatedDocumentId ? onDownloadGenerated(f.generatedDocumentId) : f.documentId ? onDownloadFile(f.documentId) : undefined)}
                  >
                    {f.name}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {handoff.notes.length ? (
        <section className="mt-6">
          <h3 className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-ink-3">{t("notes")}</h3>
          <ul className="mt-2 grid gap-1.5 text-[0.92rem] leading-snug text-ink-2">
            {handoff.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span aria-hidden className="text-ink-4">
                  •
                </span>
                <span className="min-w-0">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canComplete ? (
        <form
          className="mt-7 grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-6"
          onSubmit={async (e) => {
            e.preventDefault();
            await onComplete({ url: url.trim() || undefined, reference: reference.trim() || undefined, screenshotKey: shot?.key });
          }}
        >
          <div>
            <h3 className="title text-[1.08rem] text-ink">{t("doneTitle")}</h3>
            <p className="mt-1 text-[0.9rem] text-ink-3">{t("doneLede")}</p>
          </div>
          <Field id="handoff-url" label={t("link")}>
            <Input id="handoff-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("linkPlaceholder")} />
          </Field>
          <Field id="handoff-ref" label={t("reference")}>
            <Input id="handoff-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadShot(f);
                e.target.value = "";
              }}
            />
            <Button type="button" size="sm" variant="quiet" className="h-auto max-w-full whitespace-normal py-2 text-left" icon={shot ? <Check size={15} className="text-ok" aria-hidden /> : <Camera size={15} aria-hidden />} loading={uploading} onClick={() => fileInput.current?.click()}>
              {shot ? t("screenshotAdded") : t("screenshot")}
            </Button>
            {shot ? <Tag>{shot.name}</Tag> : null}
          </div>
          <Button type="submit" size="lg" block loading={completing} icon={<Check size={18} aria-hidden />}>
            {completing ? t("submitting") : t("submit")}
          </Button>
          <p className="text-[0.84rem] text-ink-4">{t("credit")}</p>
        </form>
      ) : null}
    </Pane>
  );
}
