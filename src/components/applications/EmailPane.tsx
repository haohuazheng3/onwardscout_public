"use client";

import { Mail, Plug, Send, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Callout, Field, Input, Pane, Tag, Textarea } from "@/components/ui";
import type { RoomApi } from "./useApplication";

/*
 * The outreach email (CH4): one recipient, the person's own address, every word editable.
 * With Gmail connected the confirm button sends it; without, it opens in the person's mail app
 * (mailto) and they tap "I sent it". A drafted follow-up shows here too, waiting for "Send".
 */
export function EmailPane({ room, editable }: { room: RoomApi; editable: boolean }) {
  const t = useTranslations("applications.email");
  const v = room.view;
  const email = v.email;
  // The draft lives in the room (useApplication): confirm and "send follow-up" save it first,
  // and a refresh or a failed save never replaces what the person typed.
  const { subject, body } = room.emailDraft;
  const setSubject = (next: string) => room.setEmailDraft({ subject: next, body });
  const setBody = (next: string) => room.setEmailDraft({ subject, body: next });
  if (!email) return null;
  const followUp = v.status === "needs_you" && v.needsYouReason === "followup_approval";
  const mailtoNeeded = v.status === "needs_you" && v.needsYouReason === "no_gmail";
  const dirty = room.emailDirty;
  const mailto = `mailto:${encodeURIComponent(email.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="email-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-title" className="title text-[1.2rem] text-ink">
          {followUp ? t("followupTitle") : t("title")}
        </h2>
        {v.gmail?.connected && v.gmail.email ? <Tag tone="pine" dot>{t("gmailConnected", { email: v.gmail.email })}</Tag> : null}
      </div>
      <p className="mt-1 text-[0.92rem] text-ink-3">{followUp ? t("followupLede") : t("lede")}</p>
      {!v.gmail?.connected ? (
        <Callout tone="info" className="mt-4" action={<ButtonLink href="/app/integrations" size="sm" variant="ghost" icon={<Plug size={15} aria-hidden />}>{t("connect")}</ButtonLink>}>
          {t("gmailMissing")}
        </Callout>
      ) : null}
      <div className="mt-4 grid gap-4">
        <div>
          <p className="field-label">{t("to")}</p>
          {email.to ? <p className="break-all text-[0.97rem] text-ink">{email.to}</p> : <p className="text-[0.92rem] text-warn">{t("noRecipient")}</p>}
        </div>
        <Field id="email-subject" label={t("subject")}>
          <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} readOnly={!editable} />
        </Field>
        <Field id="email-body" label={t("body")}>
          <Textarea id="email-body" rows={Math.min(16, Math.max(8, body.split("\n").length + 2))} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {editable && dirty && email.documentId ? (
            <Button size="sm" variant="ghost" loading={room.busy === "email"} onClick={() => room.editEmail(email.documentId!, subject, body)}>
              {t("save")}
            </Button>
          ) : null}
          {mailtoNeeded ? (
            <>
              <ButtonLink href={mailto} variant="ink" size="sm" icon={<Mail size={15} aria-hidden />}>
                {t("openApp")}
              </ButtonLink>
              <Button size="sm" loading={room.busy === "handoff"} onClick={() => room.handoffDone({})}>
                {t("sentIt")}
              </Button>
            </>
          ) : null}
          {followUp ? (
            <>
              <Button size="sm" icon={<Send size={15} aria-hidden />} loading={room.busy === "followup:send" || room.busy === "email"} onClick={() => void room.followUp("send")}>
                {t("sendFollowup")}
              </Button>
              <Button size="sm" variant="quiet" icon={<SkipForward size={15} aria-hidden />} loading={room.busy === "followup:skip"} onClick={() => room.followUp("skip")}>
                {t("skipFollowup")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Pane>
  );
}
