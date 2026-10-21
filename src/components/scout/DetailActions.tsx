"use client";

import { Bookmark, BookmarkCheck, ThumbsDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MatchFeedback } from "@/lib/core/types";
import { FEEDBACK_REASONS, type FeedbackReason } from "@/lib/opportunities/types";
import { Button, Chip } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { ApplyButton } from "./ApplyButton";
import { DeadlineText } from "./parts";

async function saveFeedback(target: string, feedback: MatchFeedback | null, reason: FeedbackReason | null, fallback: string): Promise<string> {
  const res = await fetch(`/api/matches/${encodeURIComponent(target)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback, reason }),
  });
  const body = (await res.json().catch(() => null)) as { match?: { id: string }; error?: string } | null;
  if (!res.ok || !body?.match) throw new Error(body?.error || fallback);
  return body.match.id;
}

/** Later / Not interested on the detail page (optimistic, with undo or a reason). */
export function DetailActions({ opportunityId, matchId, feedback, practice }: { opportunityId: string; matchId: string | null; feedback: MatchFeedback | null; practice: boolean }) {
  const t = useTranslations("scout.feedback");
  const tc = useTranslations("common");
  const router = useRouter();
  const [current, setCurrent] = useState<MatchFeedback | null>(feedback);
  const [target, setTarget] = useState(matchId ?? opportunityId);
  const [asking, setAsking] = useState(false);

  async function toggleLater() {
    const prev = current;
    const next = prev === "later" ? null : "later";
    setCurrent(next);
    try {
      setTarget(await saveFeedback(target, next, null, tc("errors.generic")));
      toast.success(next === "later" ? t("savedLater") : t("movedBack"));
    } catch (err) {
      setCurrent(prev);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function dismiss(reason: FeedbackReason) {
    const prev = current;
    setCurrent("not_interested");
    setAsking(false);
    try {
      await saveFeedback(target, "not_interested", reason, tc("errors.generic"));
      toast({ title: t("dismissed"), body: t("learns") });
      router.push("/app/scout");
    } catch (err) {
      setCurrent(prev);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  if (practice) return null;
  if (asking) {
    return (
      <div role="group" aria-label={t("whyTitle")}>
        <p className="text-[0.92rem] font-medium text-ink">{t("whyTitle")}</p>
        <p className="mt-0.5 text-[0.84rem] text-ink-3">{t("whyHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FEEDBACK_REASONS.map((r) => (
            <Chip key={r} size="sm" onClick={() => dismiss(r)}>
              {t(`reasons.${r}`)}
            </Chip>
          ))}
        </div>
        <Button variant="quiet" size="sm" className="mt-2 -ml-2" onClick={() => setAsking(false)}>
          {t("keep")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="quiet"
        size="sm"
        icon={current === "later" ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
        onClick={toggleLater}
        aria-pressed={current === "later"}
      >
        {current === "later" ? t("savedLaterShort") : t("later")}
      </Button>
      <Button variant="quiet" size="sm" icon={<ThumbsDown size={15} aria-hidden />} onClick={() => setAsking(true)} aria-pressed={current === "not_interested"}>
        {t("notInterested")}
      </Button>
    </div>
  );
}

/** Phones: the Apply button stays in reach above the tab bar while the page scrolls. */
export function StickyApply({
  opportunityId,
  type,
  channel,
  goalId,
  applicationId,
  deadline,
  rolling,
  nowIso,
}: {
  opportunityId: string;
  type: string;
  channel: string;
  goalId: string | null;
  applicationId: string | null;
  deadline: string | null;
  rolling: boolean;
  nowIso: string;
}) {
  return (
    <div className="fixed inset-x-3 z-30 lg:hidden" style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)" }}>
      <div className="pane-glass flex items-center gap-3 rounded-[24px] p-2 pl-4 shadow-lift">
        <DeadlineText deadline={deadline} rolling={rolling} now={new Date(nowIso)} className="min-w-0 flex-1 text-[0.86rem]" />
        <ApplyButton opportunityId={opportunityId} type={type} channel={channel} goalId={goalId} applicationId={applicationId} practice={type === "practice"} className="shrink-0" />
      </div>
    </div>
  );
}
