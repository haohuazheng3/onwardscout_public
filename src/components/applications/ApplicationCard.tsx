"use client";

import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ScoutDot, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { daysUntil, nextAction, statusLine } from "@/lib/applications/present";
import type { BoardCard } from "@/lib/applications/types";
import { isOpportunityTypeId, opportunityTypeLabel } from "@/lib/core/opportunity-types";

/** One application on the board: what, the status in plain words, the next action, the deadline. */
export function ApplicationCard({ card, locale, now }: { card: BoardCard; locale: string; now: Date }) {
  const t = useTranslations("applications");
  const format = useFormatter();
  const o = card.opportunity;
  const line = statusLine({ status: card.status, needsYouReason: card.needsYouReason, openQuestions: card.openQuestions, practice: card.practice, followUpAt: card.followUpAt });
  const action = nextAction({ status: card.status, needsYouReason: card.needsYouReason, submittedAt: card.submittedAt });
  const days = daysUntil(o.deadline, now);
  const working = card.status === "draft" || card.status === "preparing" || card.status === "submitting";
  const urgent = card.status === "needs_you" || card.status === "needs_info" || card.status === "ready";
  const type = isOpportunityTypeId(o.type) ? opportunityTypeLabel(o.type, locale) : null;
  return (
    <Link
      href={`/app/applications/${card.id}`}
      className={cx("pane pane-hover block min-w-0 rounded-[20px] p-4 text-left", urgent && "shadow-[0_0_0_1.5px_var(--accent-soft)]")}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {type ? <Tag className="max-w-full truncate">{type}</Tag> : null}
        {card.practice ? <Tag tone="ink">{t("card.practice")}</Tag> : null}
      </div>
      <p className="mt-2.5 line-clamp-2 font-semibold leading-snug text-ink">{o.name}</p>
      {o.orgName ? <p className="mt-0.5 truncate text-[0.88rem] text-ink-3">{o.orgName}</p> : null}
      <p className={cx("mt-3 flex items-start gap-2 text-[0.88rem] leading-snug", urgent ? "text-accent-text" : "text-ink-2")}>
        {working ? <ScoutDot live className="mt-1.5 shrink-0" /> : null}
        <span className="min-w-0">{t(line.key, line.vars)}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.8rem] text-ink-3">
          {card.submittedAt
            ? t("card.submittedOn", { date: format.dateTime(new Date(card.submittedAt), { dateStyle: "medium" }) })
            : o.deadline
              ? days !== null && days < 0
                ? t("card.deadlinePassed")
                : days === 0
                  ? t("card.deadlineToday")
                  : t("card.deadline", { date: format.dateTime(new Date(o.deadline), { dateStyle: "medium" }) })
              : o.rolling
                ? t("card.rolling")
                : t("card.checkOfficial")}
        </span>
        {action && action !== "wait" ? (
          <span className={cx("inline-flex items-center gap-1 text-[0.84rem] font-semibold", urgent ? "text-accent-text" : "text-ink-2")}>
            {t(`next.${action}`)}
            <ArrowRight size={14} aria-hidden />
          </span>
        ) : null}
      </div>
    </Link>
  );
}
