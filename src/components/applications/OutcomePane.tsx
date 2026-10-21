"use client";

import { CircleCheck, ExternalLink, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Chip, Pane, Tag } from "@/components/ui";
import { Dialog } from "@/components/ui-client";
import { canTransition } from "@/lib/core/state-machine";
import type { OutcomeChoice } from "@/lib/applications/plan";
import type { RoomApi } from "./useApplication";

/** Which outcome chips fit the opportunity type (an investor meets, a programme admits, a job offers). */
export function outcomeChoices(type: string): OutcomeChoice[] {
  const venture = ["investor", "brand_partnership", "client_lead", "collaborator", "referral", "recruiter", "industry_partnership", "media", "podcast", "book_publisher", "service_provider"];
  const funding = ["grant", "fellowship", "scholarship", "loan", "crowdfunding", "government_program"];
  const programme = ["accelerator", "incubator", "degree_program", "exchange_program", "phd_position", "residency", "mentorship", "course", "visiting_scholar"];
  const award = ["award", "competition", "startup_competition", "hackathon", "open_call", "pitch_event", "exhibition", "speaking", "conference_cfp", "journal"];
  if (venture.includes(type)) return ["meeting", "funded", "accepted", "rejected", "no_response"];
  if (funding.includes(type)) return ["interview", "funded", "rejected", "no_response"];
  if (programme.includes(type)) return ["interview", "admitted", "rejected", "no_response"];
  if (award.includes(type)) return type === "journal" || type === "conference_cfp" ? ["accepted", "published", "rejected", "no_response"] : ["selected", "awarded", "rejected", "no_response"];
  return ["interview", "offer", "rejected", "no_response"];
}

export function EvidencePane({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.evidence");
  const format = useFormatter();
  const v = room.view;
  const e = v.evidence;
  if (!e || !v.submittedAt) return null;
  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="title flex items-center gap-2 text-[1.1rem] text-ink">
        <CircleCheck size={19} className="text-ok" aria-hidden />
        {t("title")}
      </h2>
      <p className="mt-1 text-[0.88rem] text-ink-3">{t("when", { date: format.dateTime(new Date(v.submittedAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>
      <dl className="mt-3 grid gap-2.5 text-[0.93rem]">
        {e.reference ? (
          <div>
            <dt className="text-[0.8rem] text-ink-3">{t("reference")}</dt>
            <dd className="num font-semibold text-ink">{e.reference}</dd>
          </div>
        ) : null}
        {e.confirmationText ? (
          <div>
            <dt className="text-[0.8rem] text-ink-3">{t("message")}</dt>
            <dd className="text-ink-2">{e.confirmationText}</dd>
          </div>
        ) : null}
        {e.url ? (
          <div>
            <dt className="text-[0.8rem] text-ink-3">{t("link")}</dt>
            <dd>
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 break-all">
                {e.url.replace(/^https?:\/\//, "").slice(0, 60)}
                <ExternalLink size={13} aria-hidden />
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {e.screenshotKey ? <Tag>{t("screenshot")}</Tag> : null}
        <Tag tone={e.userConfirmed ? "ok" : "pine"}>{e.userConfirmed ? t("byYou") : t("byChannel")}</Tag>
      </div>
    </Pane>
  );
}

export function OutcomePane({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.outcome");
  const format = useFormatter();
  const v = room.view;
  const [pressed, setPressed] = useState<OutcomeChoice | null>(null);
  if (!v.submittedAt || ["rejected", "closed", "withdrawn", "expired"].includes(v.status)) return null;
  const choices = outcomeChoices(v.opportunity.type);
  return (
    <Pane pad="md" className="min-w-0" aria-labelledby="outcome-title">
      <h2 id="outcome-title" className="title text-[1.1rem] text-ink">
        {t("title")}
      </h2>
      <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-3">{t("lede")}</p>
      {v.outcome ? <p className="mt-3 text-[0.9rem] text-ink-2">{t("current", { result: t(v.outcome.result as OutcomeChoice) })}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {choices.map((c) => (
          <Chip
            key={c}
            selected={pressed === c || (pressed === null && v.outcome?.result === c)}
            aria-busy={room.busy === `outcome:${c}` || undefined}
            onClick={async () => {
              setPressed(c);
              const r = await room.outcome(c);
              setPressed(null);
              if (!r) return;
            }}
          >
            {t(c)}
          </Chip>
        ))}
      </div>
      {v.followUpAt ? <p className="mt-4 text-[0.84rem] text-ink-4">{t("nextFollowUp", { date: format.dateTime(new Date(v.followUpAt), { dateStyle: "medium" }) })}</p> : null}
      {v.followUpsSent ? <p className="mt-1 text-[0.84rem] text-ink-4">{t("followUpsSent", { count: v.followUpsSent })}</p> : null}
    </Pane>
  );
}

export function WithdrawButton({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.withdraw");
  const [open, setOpen] = useState(false);
  const v = room.view;
  const submitted = Boolean(v.submittedAt);
  if (v.status === "submitting" || !canTransition(v.status, "withdrawn", "user", { submitted })) return null;
  return (
    <>
      <Button variant="quiet" size="sm" icon={<Undo2 size={15} aria-hidden />} onClick={() => setOpen(true)} className="text-ink-3">
        {t("button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("title")}
        description={submitted ? t("bodySubmitted") : t("body")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("keep")}
            </Button>
            <Button
              variant="danger"
              loading={room.busy === "withdraw"}
              onClick={async () => {
                setOpen(false);
                await room.withdraw();
              }}
            >
              {t("confirm")}
            </Button>
          </>
        }
      />
    </>
  );
}
