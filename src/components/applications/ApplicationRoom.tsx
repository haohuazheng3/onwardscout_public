"use client";

import { useTranslations } from "next-intl";
import { RotateCw } from "lucide-react";
import { Button, Callout, Pane } from "@/components/ui";
import { CheckoutNotice } from "@/components/billing/CheckoutButton";
import type { ApplicationView, RoomBalance } from "@/lib/applications/types";
import { offerName } from "@/content/plans";
import { AnswersPane } from "./AnswersPane";
import { ConfirmPane } from "./ConfirmPane";
import { DocumentsPane } from "./DocumentsPane";
import { EmailPane } from "./EmailPane";
import { FilesPane } from "./FilesPane";
import { HandoffPanel } from "./HandoffPanel";
import { NeedsYouPane } from "./NeedsYouPane";
import { EvidencePane, OutcomePane, WithdrawButton } from "./OutcomePane";
import { ActivityLog, RoomHeader, WorkingPane } from "./RoomHeader";
import { UnlockPane } from "./UnlockPane";
import { isLive, useApplication } from "./useApplication";

/*
 * The application room (/app/applications/[id]): header + trail, then the one thing that needs
 * the person (questions, the confirm button, the handoff, a follow-up), the files only they hold
 * (never a blocker for the drafts), the documents and answers with their sources, and the record
 * (evidence, outcome). On phones the action comes first; on desktop it sits in a sticky side column.
 */
export function ApplicationRoom({ initial, balance, locale, nowIso, payment = null }: { initial: ApplicationView; balance: RoomBalance | null; locale: string; nowIso: string; payment?: "unlocked" | "pending" | "failed" | null }) {
  const t = useTranslations("applications");
  const room = useApplication(initial, balance);
  const v = room.view;
  const live = isLive(v);
  const preSubmission = !v.submittedAt;
  const locked = v.access.locked;
  // The free preview is read, not edited: every change is part of the unlock.
  const editable = !locked && preSubmission && ["needs_info", "preparing", "ready", "needs_you"].includes(v.status);
  const reason = v.needsYouReason;
  const handoffShown = v.status === "needs_you" && preSubmission && v.handoff && reason !== "no_gmail" && reason !== "opportunity_missing";
  const showWorking = live && v.status !== "needs_info" && !v.access.writing;
  const unlockPane = (
    <UnlockPane
      applicationId={v.id}
      locale={locale}
      signedIn
      available={room.available}
      pass={room.pass}
      onCredit={room.unlockWithCredit}
      busy={room.busy}
      writing={v.access.writing}
      pending={payment === "pending" && locked}
      messages={room.msgs}
    />
  );

  const action = (() => {
    // Preview: the unlock is the one thing to do (once there is something to look at).
    if (locked && preSubmission && !["submitting", "rejected", "expired", "withdrawn", "closed"].includes(v.status) && (v.documents.length || !live)) return unlockPane;
    if (v.access.writing && preSubmission) return unlockPane;
    if (v.status === "ready") return <ConfirmPane room={room} locale={locale} />;
    if (v.status === "needs_you" && reason === "opportunity_missing") return <Callout tone="warn">{t("room.missingOpportunity")}</Callout>;
    if (["rejected", "expired", "withdrawn", "closed"].includes(v.status)) {
      return (
        <Pane pad="md" className="min-w-0">
          <p className="text-ink-2">{t(`ended.${v.status as "rejected" | "expired" | "withdrawn" | "closed"}`)}</p>
        </Pane>
      );
    }
    if (v.submittedAt) return <OutcomePane room={room} />;
    if (v.status === "needs_you") {
      return (
        <Pane pad="md" className="min-w-0">
          <p className="title text-[1.05rem] text-ink">{t("handoff.doneTitle")}</p>
          <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-3">{t("handoff.doneLede")}</p>
          {v.creditsReserved > 0 ? <p className="mt-3 text-[0.86rem] text-ink-3">{t("handoff.credit")}</p> : null}
        </Pane>
      );
    }
    if (v.status === "needs_info" || v.status === "draft" || v.status === "preparing" || v.status === "submitting") {
      // Before the confirm button exists, say what happens next.
      return (
        <Pane pad="md" className="min-w-0">
          <p className="title text-[1.05rem] text-ink">{t("confirm.title")}</p>
          <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-3">{v.status === "needs_info" ? t("confirm.waitingQuestions") : v.status === "submitting" ? t("working.submit") : t("confirm.preparing")}</p>
          <p className="mt-3 text-[0.86rem] text-ink-4">
            {v.creditCost > 0 ? (room.pass ? t("confirm.costPass", { name: offerName(room.pass.sku, locale === "zh" ? "zh" : "en") }) : t("confirm.cost")) : t("confirm.costFree")}
          </p>
        </Pane>
      );
    }
    return null;
  })();

  return (
    <div className="grid min-w-0 gap-4 sm:gap-5">
      <RoomHeader room={room} locale={locale} nowIso={nowIso} />
      <CheckoutNotice />
      <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="order-2 grid min-w-0 gap-4 sm:gap-5 lg:order-1">
          {showWorking ? <WorkingPane room={room} /> : null}
          {v.stalled ? (
            <Callout
              tone="warn"
              title={t("stalled.title")}
              action={
                <Button size="sm" variant="ghost" icon={<RotateCw size={15} aria-hidden />} loading={room.busy === "retry"} onClick={() => room.retryPreparation()}>
                  {t("stalled.retry")}
                </Button>
              }
            >
              {t("stalled.body")}
            </Callout>
          ) : null}
          {v.questions.some((q) => q.kind !== "file") || v.status === "needs_info" ? <NeedsYouPane room={room} /> : null}
          {handoffShown && v.handoff ? (
            <HandoffPanel
              applicationId={v.id}
              handoff={v.handoff}
              reason={reason}
              canComplete
              completing={room.busy === "handoff"}
              onComplete={(input) => room.handoffDone(input)}
              onDownloadGenerated={(id) => room.download(id, "pdf")}
              onDownloadFile={(id) => room.downloadOwnFile(id)}
              busyKey={room.busy}
            />
          ) : null}
          {v.channel === "CH4" || v.email ? <EmailPane room={room} editable={editable} /> : null}
          {!(live && !v.documents.length) ? <DocumentsPane room={room} editable={editable} /> : null}
          <AnswersPane room={room} editable={editable} />
          <ActivityLog view={v} />
        </div>
        <aside className="order-1 grid min-w-0 gap-4 sm:gap-5 lg:sticky lg:top-24 lg:order-2">
          {action}
          {editable ? <FilesPane room={room} /> : null}
          <EvidencePane room={room} />
          <div className="flex justify-center lg:justify-start">
            <WithdrawButton room={room} />
          </div>
        </aside>
      </div>
    </div>
  );
}
