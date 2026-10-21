"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/components/Consent";
import { refreshAppStatus, updateAppStatus, useAppStatus } from "@/components/AppNav";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { outcomeStatus, type OutcomeChoice } from "@/lib/applications/plan";
import { boardColumn } from "@/lib/core/state-machine";
import type { ApplicationStatus, ApplicationQuestion } from "@/lib/core/types";
import { answerKeyOf, LIVE_STATUSES, type ApplicationView } from "@/lib/applications/types";
import { call, RequestError, startDownload } from "./api";

/*
 * The room's state machine on the client: the server view, optimistic patches applied the
 * moment the person presses, and rollback + toast when the server says no. While a job works
 * (preparing, submitting, following up) the view is polled (2 s, then 5 s after a minute;
 * paused while the tab is hidden).
 */

type View = ApplicationView;
type Resp = { application: View | null; balance?: { available: number; reserved: number } | null; unlock?: boolean };

const UNLOCK_KEY = "os:unlock-tracked";

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, v: string): void {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode: the event may fire twice, which FlowGlance dedupes per session */
  }
}

export function isLive(v: Pick<View, "status" | "working" | "stalled">): boolean {
  if (v.stalled) return false;
  return Boolean(v.working) || LIVE_STATUSES.includes(v.status);
}

export function useApplication(initial: View, initialBalance: { available: number; reserved: number } | null) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const router = useRouter();
  const msgs = useMemo(() => ({ network: tc("errors.network"), generic: tc("errors.generic") }), [tc]);
  const [view, setView] = useState<View>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const shell = useAppStatus();
  const [balance, setBalance] = useState(initialBalance);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const prevStatus = useRef<ApplicationStatus>(initial.status);
  const [slow, setSlow] = useState(false);

  const available = shell.state === "ready" && shell.available !== null ? shell.available : (balance?.available ?? null);

  /** Side effects of a status change seen from the server (analytics, toasts, shell counters). */
  const settle = useCallback(
    (next: View) => {
      const before = prevStatus.current;
      if (before !== next.status) {
        if (next.status === "submitted" && before === "submitting") {
          track("application_submitted", { channel: next.channel, practice: next.practice });
          toast.success(t("toasts.submitted", { name: next.opportunity.name }));
          void refreshAppStatus();
        } else if (next.status === "needs_you" && before === "submitting") {
          toast.info(t("toasts.needsYou"));
        } else if (next.status === "ready" && before === "submitting") {
          toast.warn(t("toasts.failedRetry"));
          void refreshAppStatus();
        }
        prevStatus.current = next.status;
      }
      if (next.unlock && !next.practice && storageGet(UNLOCK_KEY) !== "1") {
        track("unlock", { applicationId: next.id });
        storageSet(UNLOCK_KEY, "1");
      }
    },
    [t],
  );

  const apply = useCallback(
    (r: Resp) => {
      if (r.application) {
        setView(r.application);
        settle(r.application);
      }
      if (r.balance) {
        setBalance(r.balance);
        updateAppStatus({ available: r.balance.available, reserved: r.balance.reserved });
      }
    },
    [settle],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await call<Resp>(`/api/applications/${viewRef.current.id}`, {}, msgs);
      apply(r);
    } catch (err) {
      // Polling is best-effort: the next tick retries; a lasting failure shows on the next action.
      console.warn("[applications] refresh failed", err);
    }
  }, [apply, msgs]);

  // Live polling while a job works on it.
  const live = isLive(view);
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await refresh();
      const elapsed = Date.now() - started;
      setSlow(elapsed > 90_000);
      timer = setTimeout(tick, elapsed > 60_000 ? 5000 : 2000);
    };
    timer = setTimeout(tick, 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, refresh]);

  /** Runs a mutation with an optimistic patch; rolls back and explains on failure. */
  const mutate = useCallback(
    async <T extends Resp>(key: string, optimistic: ((v: View) => View) | null, request: () => Promise<T>, failTitle?: string): Promise<T | null> => {
      const before = viewRef.current;
      if (optimistic) setView(optimistic(before));
      setBusy(key);
      try {
        const r = await request();
        apply(r);
        return r;
      } catch (err) {
        setView(before);
        const message = err instanceof Error ? err.message : msgs.generic;
        if (err instanceof RequestError && err.status === 402) {
          toast.error(t("confirm.noCredits"), { body: message, action: { label: t("confirm.buy"), onClick: () => router.push("/app/billing") } });
        } else {
          toast.error(failTitle ?? tc("errors.rolledBack"), { body: message });
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [apply, msgs.generic, router, t, tc],
  );

  /* ---------------------------------------------------------------- actions */

  const answer = useCallback(
    (q: ApplicationQuestion, payload: { value?: string | string[] | boolean | null; custom?: string | null; source?: "user" | "generated"; file?: { key: string; filename: string; contentType: string; kind?: string } }) =>
      mutate(
        `answer:${q.id}`,
        (v) => {
          const questions = v.questions.filter((x) => x.id !== q.id);
          const stillOpen = questions.some((x) => x.required !== false);
          const shown = typeof payload.value === "string" ? payload.value : Array.isArray(payload.value) ? payload.value.join(", ") : (payload.custom ?? "");
          const answers = shown && q.kind !== "file" ? [...v.answers.filter((a) => a.key !== answerKeyOf(q)), { key: answerKeyOf(q), label: q.prompt, value: shown, source: "user" as const, factIds: [], confirmed: true, long: shown.length > 120 }] : v.answers;
          const status: ApplicationStatus = v.status === "needs_info" && !stillOpen ? "preparing" : v.status;
          return { ...v, questions, answers, status, column: boardColumn(status), working: status === "preparing" ? { kind: "prepare", step: null } : v.working };
        },
        () => call<Resp>(`/api/applications/${viewRef.current.id}/answer`, { json: { questionId: q.id, ...payload } }, msgs),
        t("toasts.answerFailed"),
      ),
    [msgs, mutate, t],
  );

  const confirm = useCallback(async () => {
    const cost = viewRef.current.creditCost;
    const r = await mutate(
      "confirm",
      (v) => ({ ...v, status: "submitting", column: boardColumn("submitting"), working: { kind: "submit", step: "submit" } }),
      () => call<Resp>(`/api/applications/${viewRef.current.id}/confirm`, { json: { confirm: true } }, msgs),
      t("toasts.confirmFailed"),
    );
    if (r && cost > 0 && !r.balance && shell.available !== null) updateAppStatus({ available: Math.max(0, shell.available - cost), reserved: shell.reserved + cost });
    return r;
  }, [msgs, mutate, shell.available, shell.reserved, t]);

  const handoffDone = useCallback(
    async (input: { url?: string; reference?: string; screenshotKey?: string }) => {
      const r = await mutate(
        "handoff",
        (v) => ({ ...v, status: "submitted", column: boardColumn("submitted"), submittedAt: new Date().toISOString() }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}/handoff-done`, { json: input }, msgs),
      );
      if (r) {
        track("handoff_completed", { channel: viewRef.current.channel, practice: viewRef.current.practice });
        track("application_submitted", { channel: viewRef.current.channel, practice: viewRef.current.practice, handoff: true });
        prevStatus.current = "submitted";
        void refreshAppStatus();
      }
      return r;
    },
    [msgs, mutate],
  );

  const outcome = useCallback(
    (result: OutcomeChoice) =>
      mutate(
        `outcome:${result}`,
        (v) => {
          const to = outcomeStatus(v.status, result) ?? v.status;
          return { ...v, status: to, column: boardColumn(to), outcome: { result, note: null, amount: null, decidedAt: new Date().toISOString(), lessons: v.outcome?.lessons ?? [] }, followUpAt: null };
        },
        () => call<Resp>(`/api/applications/${viewRef.current.id}/outcome`, { json: { result } }, msgs),
      ),
    [msgs, mutate],
  );

  const withdraw = useCallback(
    () =>
      mutate(
        "withdraw",
        (v) => ({ ...v, status: "withdrawn", column: boardColumn("withdrawn"), working: null, followUpAt: null }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}/withdraw`, { json: {} }, msgs),
      ),
    [msgs, mutate],
  );

  const editBlock = useCallback(
    (documentId: string, index: number, text: string) =>
      mutate(
        `block:${documentId}:${index}`,
        (v) => ({
          ...v,
          documents: v.documents.map((d) =>
            d.id !== documentId
              ? d
              : {
                  ...d,
                  label: "edited_by_you",
                  blocks: text.trim()
                    ? d.blocks.map((b, i) => (i === index ? { ...b, text: text.trim(), role: b.role === "gap" ? "body" : b.role, flags: [], factIds: [...b.factIds.filter((x) => x !== "user:confirmed"), "user:confirmed"] } : b))
                    : d.blocks.filter((_, i) => i !== index),
                },
          ),
        }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}`, { method: "PATCH", json: { document: { id: documentId, edits: [{ index, text }] } } }, msgs),
      ),
    [msgs, mutate],
  );

  const editAnswer = useCallback(
    (key: string, value: string) =>
      mutate(
        `edit:${key}`,
        (v) => ({ ...v, answers: v.answers.map((a) => (a.key === key ? { ...a, value, source: "user", confirmed: true } : a)) }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}`, { method: "PATCH", json: { answers: { [key]: value } } }, msgs),
      ),
    [msgs, mutate],
  );

  const editEmail = useCallback(
    (documentId: string, subject: string, body: string) =>
      mutate(
        "email",
        (v) => ({ ...v, email: v.email ? { ...v.email, subject, body } : v.email }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}`, { method: "PATCH", json: { email: { documentId, subject, body } } }, msgs),
      ),
    [msgs, mutate],
  );

  const regenerateDocument = useCallback(
    (documentId: string) => mutate(`regen:${documentId}`, null, () => call<Resp & { documentId?: string }>(`/api/applications/${viewRef.current.id}/regenerate`, { json: { documentId } }, msgs)),
    [msgs, mutate],
  );

  const regenerateDraft = useCallback(
    (questionId: string) => mutate(`draft:${questionId}`, null, () => call<Resp & { draft?: string }>(`/api/applications/${viewRef.current.id}/regenerate`, { json: { questionId } }, msgs)),
    [msgs, mutate],
  );

  const retryPreparation = useCallback(
    () =>
      mutate(
        "retry",
        (v) => ({ ...v, stalled: null, working: { kind: "prepare", step: null } }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}/regenerate`, { json: { all: true } }, msgs),
      ),
    [msgs, mutate],
  );

  const followUp = useCallback(
    (decision: "send" | "skip") =>
      mutate(
        `followup:${decision}`,
        (v) => (decision === "skip" ? { ...v, status: "waiting", column: boardColumn("waiting"), needsYouReason: null } : { ...v, working: { kind: "followup", step: "followup" } }),
        () => call<Resp>(`/api/applications/${viewRef.current.id}/followup`, { json: { decision } }, msgs),
      ),
    [msgs, mutate],
  );

  const download = useCallback(
    async (documentId: string, format: "pdf" | "docx" | "pptx") => {
      setBusy(`download:${documentId}:${format}`);
      try {
        const r = await call<{ url: string; filename: string; fallback: boolean }>("/api/documents/render", { json: { generatedDocumentId: documentId, format } }, msgs);
        startDownload(r.url, r.filename);
        if (r.fallback) toast.info(t("documents.fallbackDocx"));
      } catch (err) {
        toast.error(t("toasts.downloadFailed"), { body: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [msgs, t],
  );

  const downloadOwnFile = useCallback(
    async (documentId: string) => {
      setBusy(`file:${documentId}`);
      try {
        const r = await call<{ url: string; filename: string }>(`/api/applications/${viewRef.current.id}/file?documentId=${encodeURIComponent(documentId)}`, {}, msgs);
        startDownload(r.url, r.filename);
      } catch (err) {
        toast.error(t("toasts.downloadFailed"), { body: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [msgs, t],
  );

  return { view, busy, slow, available, refresh, retryPreparation, answer, confirm, handoffDone, outcome, withdraw, editBlock, editAnswer, editEmail, regenerateDocument, regenerateDraft, followUp, download, downloadOwnFile, msgs };
}

export type RoomApi = ReturnType<typeof useApplication>;
