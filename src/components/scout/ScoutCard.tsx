"use client";

import { Bookmark, Check, ThumbsDown, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { opportunityTypeLabel } from "@/lib/core/opportunity-types";
import type { MatchFeedback } from "@/lib/core/types";
import type { BoardView } from "@/lib/opportunities/filters";
import { FEEDBACK_REASONS, type BoardItem, type FeedbackReason } from "@/lib/opportunities/types";
import { Button, Chip, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { ApplyButton } from "./ApplyButton";
import { BenefitsText, DeadlineText, FitBadge, LocationText, MaterialIcons, WhatYoullDo } from "./parts";

/**
 * One pick on the Scout board: what it is, why it fits (two lines), when it closes, what the
 * person will have to do, what it asks for and what it gives. Actions: Apply for me, Later,
 * Not interested (with a reason, so the scout learns).
 */
export function ScoutCard({
  item,
  now,
  view,
  goalLabel,
  leaving = false,
  onFeedback,
}: {
  item: BoardItem;
  now: Date;
  view: BoardView;
  goalLabel?: string | null;
  leaving?: boolean;
  onFeedback: (item: BoardItem, feedback: MatchFeedback | null, reason?: FeedbackReason) => void;
}) {
  const t = useTranslations("scout.card");
  const tf = useTranslations("scout.feedback");
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const { opportunity: o, match, application } = item;
  const practice = o.type === "practice";
  const reasons = match?.reasons.slice(0, 2) ?? [];

  return (
    <article
      className={cx(
        "pane flex min-w-0 flex-col p-5 transition-[opacity,transform] duration-200 ease-out sm:p-6",
        leaving && "pointer-events-none scale-[0.98] opacity-0",
      )}
      aria-busy={leaving || undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {practice ? null : <Tag>{opportunityTypeLabel(o.type, locale)}</Tag>}
          {match?.isNew && !practice ? <Tag tone="accent">{t("new")}</Tag> : null}
          {o.mine ? <Tag>{t("addedByYou")}</Tag> : null}
          {practice ? <Tag tone="ok">{t("practiceFree")}</Tag> : null}
          {application ? <Tag tone="ink">{t("applied")}</Tag> : null}
        </div>
        {practice ? null : <FitBadge fit={match?.fit} />}
      </div>

      <h3 className="title mt-3 text-[1.14rem] leading-snug text-ink">
        <Link href={`/app/scout/${o.id}`} className="rounded-[6px] hover:underline focus-visible:underline">
          {o.name}
        </Link>
      </h3>
      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.9rem] text-ink-3">
        {o.orgName ? <span className="min-w-0 truncate font-medium text-ink-2">{o.orgName}</span> : null}
        <LocationText geo={o.geo} />
      </p>

      {reasons.length ? (
        <ul className="mt-3 space-y-1.5" aria-label={t("whyLabel")}>
          {reasons.map((r) => (
            <li key={r} className="flex min-w-0 gap-2 text-[0.92rem] leading-snug text-ink-2">
              <Check size={15} className="mt-[3px] shrink-0 text-pine" aria-hidden />
              <span className="line-clamp-1 min-w-0">{r}</span>
            </li>
          ))}
        </ul>
      ) : o.summary ? (
        <p className="mt-3 line-clamp-2 text-[0.92rem] leading-snug text-ink-2">{o.summary}</p>
      ) : null}

      <div className="mt-4 grid min-w-0 gap-2 text-[0.88rem]">
        <DeadlineText deadline={o.deadline} rolling={o.rolling} now={now} />
        <WhatYoullDo card={o} />
        <BenefitsText card={o} className="text-ink-3" />
      </div>

      <div className="mt-4 flex min-w-0 items-center justify-between gap-3">
        <MaterialIcons materials={o.requiredMaterials} />
        {goalLabel ? <span className="min-w-0 truncate text-right text-[0.8rem] text-ink-4">{goalLabel}</span> : null}
      </div>

      <div className="mt-auto pt-5">
        <div className="border-t border-line pt-4">
          {asking ? (
            <div role="group" aria-label={tf("whyTitle")}>
              <p className="text-[0.9rem] font-medium text-ink">{tf("whyTitle")}</p>
              <p className="mt-0.5 text-[0.84rem] text-ink-3">{tf("whyHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {FEEDBACK_REASONS.map((r) => (
                  <Chip key={r} size="sm" onClick={() => onFeedback(item, "not_interested", r)}>
                    {tf(`reasons.${r}`)}
                  </Chip>
                ))}
              </div>
              <Button variant="quiet" size="sm" className="mt-2 -ml-2" onClick={() => setAsking(false)}>
                {tf("keep")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <ApplyButton
                opportunityId={o.id}
                type={o.type}
                channel={o.channel}
                goalId={match?.goalId}
                applicationId={application?.id}
                practice={practice}
                className="w-full sm:w-auto"
              />
              <div className="flex gap-1 sm:ml-auto">
                {view === "later" ? (
                  <Button variant="quiet" size="sm" icon={<Undo2 size={15} aria-hidden />} onClick={() => onFeedback(item, null)}>
                    {tf("backToPicks")}
                  </Button>
                ) : (
                  <Button variant="quiet" size="sm" icon={<Bookmark size={15} aria-hidden />} onClick={() => onFeedback(item, "later")}>
                    {tf("later")}
                  </Button>
                )}
                {practice ? null : (
                  <Button variant="quiet" size="sm" icon={<ThumbsDown size={15} aria-hidden />} onClick={() => setAsking(true)} aria-expanded={asking}>
                    {tf("notInterested")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** Placeholder while a pasted link is being read. */
export function ImportingCard({ host }: { host: string }) {
  const t = useTranslations("scout.import");
  return (
    <div className="pane flex min-w-0 flex-col p-5 sm:p-6" aria-busy="true" role="status">
      <div className="flex items-center gap-2">
        <span className="scout-dot scout-dot-live" aria-hidden="true" />
        <p className="text-[0.9rem] font-medium text-ink-2">{t("reading", { host })}</p>
      </div>
      <span className="skeleton mt-5 block h-5 w-4/5 rounded-full" aria-hidden="true" />
      <span className="skeleton mt-2.5 block h-3.5 w-3/5 rounded-full" aria-hidden="true" />
      <span className="skeleton mt-5 block h-3 w-full rounded-full" aria-hidden="true" />
      <span className="skeleton mt-2 block h-3 w-11/12 rounded-full" aria-hidden="true" />
      <span className="skeleton mt-6 block h-11 w-36 rounded-full" aria-hidden="true" />
    </div>
  );
}

/** Skeleton panes in the card's shape (list loading, next page). */
export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pane min-w-0 p-5 sm:p-6" aria-hidden="true">
          <div className="flex items-center justify-between">
            <span className="skeleton block h-6 w-24 rounded-full" />
            <span className="skeleton block h-6 w-16 rounded-full" />
          </div>
          <span className="skeleton mt-4 block h-5 w-4/5 rounded-full" />
          <span className="skeleton mt-2.5 block h-3.5 w-1/2 rounded-full" />
          <span className="skeleton mt-4 block h-3 w-full rounded-full" />
          <span className="skeleton mt-2 block h-3 w-10/12 rounded-full" />
          <span className="skeleton mt-4 block h-3 w-2/5 rounded-full" />
          <span className="skeleton mt-2 block h-3 w-1/3 rounded-full" />
          <span className="skeleton mt-6 block h-11 w-36 rounded-full" />
        </div>
      ))}
    </>
  );
}
