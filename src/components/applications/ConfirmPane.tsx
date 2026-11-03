"use client";

import { ArrowRight, Send, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Callout, Pane } from "@/components/ui";
import { channelLabel } from "@/lib/core/channels";
import { offerName } from "@/content/plans";
import { fileItems, fileName, filesBlockConfirm } from "@/lib/applications/materials";
import type { RoomApi } from "./useApplication";

/*
 * The big "Confirm & submit". Shows exactly what it costs (CREDIT_COST: 1, practice free) and
 * the balance; nothing is sent before this press (honesty rule 2). The press flips the room to
 * "submitting" at once; a 402 rolls back with a "Get credits" toast.
 */
export function ConfirmPane({ room, locale }: { room: RoomApi; locale: string }) {
  const t = useTranslations("applications.confirm");
  const v = room.view;
  const cost = v.creditCost;
  const short = cost > 0 && room.available !== null && room.available < cost;
  const lastFailed = [...v.steps].reverse().find((s) => s.kind === "submit");
  const failedBefore = lastFailed?.status === "failed" && !lastFailed.summary.retrying;
  const label =
    v.practice ? t("buttonPractice") : v.channel === "CH6" ? t("buttonHandoff") : v.channel === "CH4" ? (v.gmail?.connected ? t("buttonEmail") : t("buttonEmailMailto")) : t("button");
  // Who presses the last button: the person on a handoff or in their own email app, we otherwise.
  const mode = v.practice ? "practice" : v.channel === "CH6" ? "handoff" : v.channel === "CH4" ? (v.gmail?.connected ? "email" : "mailto") : "submit";
  const lang = locale === "zh" ? "zh" : "en";
  // A file the organiser needs: we attach it where we submit, so confirm waits for it; on a
  // handoff the person attaches it on the official form. Later items never wait (FilesPane).
  const needed = fileItems(v.questions, v.opportunity.type).needed;
  const filesWait = needed.length > 0 && filesBlockConfirm(v);

  return (
    <Pane pad="md" className="min-w-0 shadow-[0_0_0_2px_var(--accent-soft)]" aria-labelledby="confirm-title">
      <h2 id="confirm-title" className="title text-[1.25rem] text-ink">
        {t("title")}
      </h2>
      <p className="mt-1.5 text-[0.93rem] leading-relaxed text-ink-3">
        {mode === "practice" ? t("practiceLede") : mode === "handoff" ? t("ledeHandoff") : mode === "mailto" ? t("ledeMailto") : t("lede")}
      </p>
      <p className="mt-3 text-[0.9rem] text-ink-2">
        {mode === "handoff" ? t("viaHandoff") : mode === "mailto" ? t("viaMailto") : t("via", { channel: channelLabel(v.channel, locale) })}
      </p>
      {failedBefore ? (
        <Callout tone="warn" className="mt-4">
          {t("retryFailed")}
        </Callout>
      ) : null}
      <div className="mt-5 rounded-[18px] bg-pane-2 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
        <p className="font-medium text-ink">{cost > 0 ? (room.pass ? t("costPass", { name: offerName(room.pass.sku, lang) }) : t("cost")) : t("costFree")}</p>
        {cost > 0 ? (
          <p className="mt-0.5 text-[0.88rem] text-ink-3">
            {room.pass ? t("passLeft", { count: room.pass.remaining }) : room.available !== null ? t("balance", { count: room.available }) : t("balanceUnknown")}
          </p>
        ) : null}
      </div>
      {short ? (
        <Callout tone="warn" className="mt-4" action={<ButtonLink href="/app/billing" size="sm" variant="ghost" iconRight={<ArrowRight size={15} aria-hidden />}>{t("buy")}</ButtonLink>}>
          {t("short")}
        </Callout>
      ) : null}
      {room.emailDirty ? <p className="mt-4 text-[0.88rem] text-ink-3">{t("unsavedEmail")}</p> : null}
      {needed.length ? (
        <Callout tone={filesWait ? "warn" : "info"} className="mt-4">
          {t(filesWait ? "filesNeeded" : "filesOnForm", { files: needed.map((q) => fileName(q, lang)).join(lang === "zh" ? "、" : ", ") })}
        </Callout>
      ) : null}
      <Button size="lg" block className="mt-5" icon={<Send size={18} aria-hidden />} disabled={filesWait} loading={room.busy === "confirm" || room.busy === "email"} onClick={() => void room.confirm()}>
        {room.busy === "confirm" ? (mode === "handoff" || mode === "mailto" ? t("starting") : t("submitting")) : label}
      </Button>
      <p className="mt-3 flex gap-2 text-[0.82rem] leading-snug text-ink-3">
        <ShieldCheck size={15} className="mt-[1px] shrink-0" aria-hidden />
        <span>{t(mode === "practice" ? "finePractice" : mode === "handoff" ? "fineHandoff" : mode === "email" ? "fineEmail" : mode === "mailto" ? "fineMailto" : "fine")}</span>
      </p>
    </Pane>
  );
}
