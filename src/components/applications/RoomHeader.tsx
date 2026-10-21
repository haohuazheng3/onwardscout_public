"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Pane, ScoutDot, Skeleton, SkeletonText, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { daysUntil, statusLine } from "@/lib/applications/present";
import type { ApplicationView, StepView } from "@/lib/applications/types";
import { channelLabel, getChannel } from "@/lib/core/channels";
import { isOpportunityTypeId, opportunityTypeLabel } from "@/lib/core/opportunity-types";
import { localize } from "@/lib/core/labels";
import type { RoomApi } from "./useApplication";

/*
 * The room's top: what this is (opportunity, organisation, type), how it is submitted (channel,
 * in plain words), where it stands (the trail), and — while the scout works — what it is doing.
 */

type Stage = "read" | "answers" | "documents" | "confirm" | "submitted" | "reply";
const STAGES: Stage[] = ["read", "answers", "documents", "confirm", "submitted", "reply"];

function stageState(v: ApplicationView): Record<Stage, "done" | "current" | "todo"> {
  const has = (kind: StepView["kind"]) => v.steps.some((s) => s.kind === kind && s.status === "done");
  const s = v.status;
  const out: Record<Stage, "done" | "current" | "todo"> = { read: "todo", answers: "todo", documents: "todo", confirm: "todo", submitted: "todo", reply: "todo" };
  out.read = has("analyze") ? "done" : s === "draft" ? "current" : "todo";
  out.answers = s === "needs_info" ? "current" : has("gaps") && v.questions.every((q) => q.required === false) ? "done" : "todo";
  out.documents = has("compose") || has("preview") ? "done" : s === "preparing" ? "current" : "todo";
  out.confirm = v.submittedAt || s === "submitting" || (s === "needs_you" && v.creditsReserved > 0) ? "done" : s === "ready" ? "current" : "todo";
  out.submitted = v.submittedAt ? "done" : s === "submitting" || (s === "needs_you" && !v.submittedAt && v.creditsReserved > 0) ? "current" : "todo";
  out.reply = v.outcome || ["progress", "rejected", "closed"].includes(s) ? "done" : v.submittedAt && ["submitted", "waiting"].includes(s) ? "current" : "todo";
  return out;
}

export function Trail({ view }: { view: ApplicationView }) {
  const t = useTranslations("applications.trail");
  const st = stageState(view);
  return (
    <ol className="scroll-row mt-5 gap-1.5" aria-label={t("label")}>
      {STAGES.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-1.5">
          <span
            className={cx(
              "inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-[0.84rem] font-medium",
              st[s] === "done" && "bg-pine-soft text-pine",
              st[s] === "current" && "bg-accent-soft text-accent-text shadow-[0_0_0_1px_var(--accent)]",
              st[s] === "todo" && "bg-pane-2 text-ink-4",
            )}
            aria-current={st[s] === "current" ? "step" : undefined}
          >
            <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", st[s] === "done" ? "bg-pine" : st[s] === "current" ? "bg-[var(--accent)]" : "bg-[var(--line-2)]")} />
            {t(s)}
          </span>
          {i < STAGES.length - 1 ? <span aria-hidden className="h-px w-3 bg-[var(--line-2)]" /> : null}
        </li>
      ))}
    </ol>
  );
}

export function RoomHeader({ room, locale }: { room: RoomApi; locale: string }) {
  const t = useTranslations("applications");
  const format = useFormatter();
  const v = room.view;
  const o = v.opportunity;
  const line = statusLine({ status: v.status, needsYouReason: v.needsYouReason, openQuestions: v.questions.filter((q) => q.required !== false).length, practice: v.practice });
  const days = daysUntil(o.deadline);
  const type = isOpportunityTypeId(o.type) ? opportunityTypeLabel(o.type, locale) : null;
  const channel = getChannel(v.channel);
  return (
    <header className="min-w-0">
      <Link href="/app/applications" className="press inline-flex min-h-[40px] items-center gap-1.5 text-[0.92rem] font-medium text-ink-3 hover:text-ink">
        <ArrowLeft size={16} aria-hidden />
        {t("room.back")}
      </Link>
      <Pane pad="md" className="mt-2 min-w-0">
        <p className="eyebrow eyebrow-dot">{[type, o.orgName].filter(Boolean).join(" · ")}</p>
        <h1 className="headline mt-2.5 text-[1.7rem] leading-tight text-ink sm:text-[2.2rem]">{o.name}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Tag tone={v.status === "needs_you" || v.status === "needs_info" || v.status === "ready" ? "accent" : v.submittedAt ? "pine" : "default"} dot>
            <span aria-live="polite">{t(line.key, line.vars)}</span>
          </Tag>
          {v.practice ? <Tag tone="ink">{t("card.practice")}</Tag> : null}
          {o.deadline ? (
            <Tag tone={days !== null && days <= 3 ? "warn" : "default"}>{days !== null && days < 0 ? t("card.deadlinePassed") : t("card.deadline", { date: format.dateTime(new Date(o.deadline), { dateStyle: "medium" }) })}</Tag>
          ) : o.rolling ? (
            <Tag>{t("card.rolling")}</Tag>
          ) : (
            <Tag>{t("card.checkOfficial")}</Tag>
          )}
          {v.goal ? <Tag>{t("room.goal", { label: v.goal.label })}</Tag> : null}
        </div>
        <div className="mt-4 grid gap-1 text-[0.9rem] leading-relaxed">
          <p className="text-ink-2">
            <span className="font-medium text-ink">{t("room.channel")}: </span>
            {channelLabel(v.channel, locale)} — {localize(channel.userAction, locale)}
          </p>
          {v.practice ? <p className="text-ink-3">{t("room.practiceNote")}</p> : null}
        </div>
        {o.url && !v.practice ? (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className="link mt-3 inline-flex items-center gap-1 text-[0.92rem]">
            {t("room.officialPage")}
            <ExternalLink size={14} aria-hidden />
          </a>
        ) : null}
        <Trail view={v} />
      </Pane>
    </header>
  );
}

export function WorkingPane({ room }: { room: RoomApi }) {
  const t = useTranslations("applications.working");
  const v = room.view;
  const step = v.working?.step ?? (v.status === "submitting" ? "submit" : v.status === "draft" ? "analyze" : v.status === "preparing" ? "compose" : null);
  return (
    <Pane pad="md" className="min-w-0" aria-live="polite" aria-busy="true">
      <p className="flex items-center gap-2.5 font-medium text-ink">
        <ScoutDot live />
        {t("title")}
      </p>
      <p className="mt-1.5 text-[0.95rem] text-ink-2">{step && t.has(step) ? t(step) : t("starting")}</p>
      <div className="mt-5 grid gap-3">
        <Skeleton className="block h-4 w-2/5 rounded-full" />
        <SkeletonText lines={4} />
      </div>
      {room.slow ? <p className="mt-4 text-[0.86rem] text-ink-3">{t("slow")}</p> : null}
    </Pane>
  );
}

export function ActivityLog({ view }: { view: ApplicationView }) {
  const t = useTranslations("applications.activity");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const steps = view.steps;
  if (!steps.length) return null;
  const text = (s: StepView) => {
    const n = (k: string) => Number(s.summary[k] ?? 0);
    switch (s.kind) {
      case "analyze":
        return t("analyze", { fields: n("fields"), questions: n("questions") });
      case "gaps":
        return t("gaps", { settled: n("settled"), asked: n("asked") });
      case "compose":
        return t("compose", { documents: n("documents") });
      default:
        return t.has(s.kind) ? t(s.kind) : s.kind;
    }
  };
  return (
    <Pane pad="sm" className="min-w-0">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[0.95rem] font-semibold text-ink">{t("title")}</h2>
        <Button size="sm" variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t("hide") : t("show")}
        </Button>
      </div>
      {open ? (
        <ol className="mt-2 grid gap-2 px-1 pb-1">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3 text-[0.88rem] leading-snug">
              <span aria-hidden className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", s.status === "done" ? "bg-pine" : s.status === "failed" ? "bg-bad" : s.status === "running" ? "bg-[var(--accent)]" : "bg-[var(--line-2)]")} />
              <div className="min-w-0">
                <p className="text-ink-2">{text(s)}</p>
                <p className="text-[0.8rem] text-ink-4">
                  {s.startedAt ? format.dateTime(new Date(s.startedAt), { dateStyle: "short", timeStyle: "short" }) : null}
                  {s.status === "running" ? ` · ${t("running")}` : null}
                  {s.status === "failed" ? ` · ${s.summary.retrying ? t("retrying") : t("failed", { error: (s.error ?? "").slice(0, 140) })}` : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </Pane>
  );
}
