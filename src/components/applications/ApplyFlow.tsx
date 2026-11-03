"use client";

import { ArrowRight, Check, ExternalLink, FileText, Lock, PenLine, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/components/Consent";
import { api, ApiError, type DraftStatusView } from "@/components/onboarding/api";
import { Uploader } from "@/components/onboarding/Uploader";
import { useDraftStatus } from "@/components/onboarding/useDraftStatus";
import { Button, ButtonLink, Callout, Pane, ScoutDot, Skeleton, SkeletonText, Tag, cx } from "@/components/ui";
import { Tabs, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import type { ApplyPreview } from "@/lib/applications/apply";
import { DeckPreview } from "./DeckPreview";
import { BlockText, MaskedBlock } from "./DocumentsPane";
import { PaidSignIn, UnlockPane } from "./UnlockPane";
import { CheckoutNotice } from "@/components/billing/CheckoutButton";

/*
 * Apply from a listing, in three moments: drop your résumé → watch this programme's materials
 * being drafted (the free preview, by the template engine) → look at them, then unlock ($19, no
 * account needed) to have Claude write them in full, or save them first (sign in with an email
 * code). After a signed-out payment the application is attached to the email typed at checkout:
 * one sign-in opens it. Signed in, the application room takes over after the start.
 * Every press reacts at once; the drafting state is skeleton panes, never a blank screen.
 */

export interface ApplyOpportunity {
  id: string;
  name: string;
  orgName: string | null;
  type: string;
  typeLabel: string;
  url: string | null;
  deadline: string | null;
  rolling: boolean;
  closed: boolean;
}

type Phase = "upload" | "starting" | "drafting" | "ready" | "error";

const POLL_MS = 2000;

/** What we draft for this kind of programme (the skeleton shows the same panes). */
function expectedKinds(type: string): string[] {
  if (type === "returnship") return ["resume_variant", "cover_letter", "statement"];
  if (["accelerator", "incubator", "pitch_event", "startup_competition", "investor"].includes(type)) return ["pitch_notes", "one_pager"];
  return ["resume_variant", "cover_letter"];
}

export function ApplyFlow({
  locale,
  signedIn,
  opportunity,
  hasMaterial,
  status: initialStatus,
  preview: initialPreview,
  saveHref,
  payment = null,
}: {
  locale: string;
  signedIn: boolean;
  opportunity: ApplyOpportunity;
  hasMaterial: boolean;
  status: DraftStatusView;
  preview: ApplyPreview | null;
  saveHref: string;
  /** Back from Stripe: the session settled (unlocked), is still clearing (pending) or could not be confirmed. */
  payment?: "unlocked" | "pending" | "failed" | null;
}) {
  const t = useTranslations("applications.apply");
  const tc = useTranslations("common");
  const router = useRouter();
  const mode = signedIn ? "user" : "draft";
  const { status, kick } = useDraftStatus(mode, locale, initialStatus);
  const [preview, setPreview] = useState<ApplyPreview | null>(initialPreview);
  const [phase, setPhase] = useState<Phase>(() => (initialPreview ? (initialPreview.working || !initialPreview.documents.length ? "drafting" : "ready") : hasMaterial ? "starting" : "upload"));
  const [error, setError] = useState<{ message: string; signIn?: boolean } | null>(null);
  const started = useRef(false);
  // Came with a profile already (an earlier draft or their account): nothing to drop this time.
  const [returning] = useState(() => hasMaterial && !initialPreview);
  const target = opportunity.orgName && !opportunity.name.includes(opportunity.orgName) ? `${opportunity.name} · ${opportunity.orgName}` : opportunity.name;
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setPhase("starting");
    setError(null);
    try {
      const r = await api<{ applicationId: string; created: boolean; signedIn: boolean }>("/api/drafts/apply", { method: "POST", json: { opportunityId: opportunity.id } }, msgs);
      if (r.created) track("apply_requested", { opportunityId: opportunity.id, from: "listing" });
      if (r.signedIn) {
        router.replace(`/app/applications/${r.applicationId}`);
        return;
      }
      setPhase("drafting");
    } catch (err) {
      started.current = false;
      const e = err instanceof ApiError ? err : null;
      setError({ message: e?.message ?? msgs.generic, signIn: Boolean(e?.data?.signIn) });
      setPhase(e?.status === 409 && !hasMaterial ? "upload" : "error");
    }
    // msgs is rebuilt each render from stable translations; the request only needs the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity.id, router, hasMaterial]);

  // A profile already on hand (or one just read from the drop): start drafting without a tap.
  const ready = status?.phase === "ready" && status.documents.some((d) => d.status === "parsed");
  useEffect(() => {
    if (!((phase === "starting" && !started.current) || (phase === "upload" && ready))) return;
    const id = setTimeout(() => void start(), 0);
    return () => clearTimeout(id);
  }, [phase, ready, start]);

  // While drafting: poll until the materials are there and the preparation has paused for the person.
  useEffect(() => {
    if (phase !== "drafting") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      try {
        const r = await api<{ application: ApplyPreview | null }>(`/api/drafts/apply?opportunityId=${opportunity.id}`, {}, msgs);
        if (stopped) return;
        if (r.application) {
          setPreview(r.application);
          if (!r.application.working && r.application.documents.length) {
            setPhase("ready");
            return;
          }
        }
      } catch (err) {
        console.warn("[apply] poll failed", err);
      }
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    timer = setTimeout(loop, 600);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, opportunity.id]);

  const kinds = expectedKinds(opportunity.type);
  const paid = Boolean(preview && !preview.access.locked);
  // Claude is writing the paid version right now (upgrade → prepare), or has written it.
  const writing = paid && Boolean(preview?.access.writing || phase === "drafting");
  // After paying, the steps are what is left: Claude writes it, then sign in to download and submit.
  const steps = paid ? [t("steps.drop"), t("steps.written"), t("steps.finish")] : [t("steps.drop"), t("steps.draft"), t("steps.unlock")];
  const stepIndex = paid ? (writing ? 1 : 2) : phase === "upload" ? 0 : phase === "ready" ? 2 : 1;

  return (
    <div className="mx-auto grid max-w-[820px] min-w-0 gap-6">
      <header className="min-w-0">
        <p className="eyebrow eyebrow-accent flex items-center gap-2">
          <ScoutDot live={phase === "starting" || phase === "drafting"} /> {t("eyebrow")}
        </p>
        <h1 className="headline mt-3 text-[1.8rem] text-ink sm:text-[2.3rem]">{paid ? t("paidTitle", { target }) : phase === "ready" ? t("readyTitle", { target }) : t("title", { target })}</h1>
        <p className="mt-3 max-w-[640px] text-[1rem] leading-relaxed text-ink-3">{paid ? t(writing ? "paidLede" : "paidLedeDone") : phase === "ready" ? t("readyLede") : returning ? t("lede.returning") : t(`lede.${opportunity.type === "returnship" ? "returnship" : kinds[0] === "pitch_notes" ? "startup" : "default"}`)}</p>
        <ol className="mt-5 flex flex-wrap gap-2" aria-label={t("steps.label")}>
          {steps.map((s, i) => (
            <li key={s}>
              <Tag tone={i < stepIndex ? "ok" : i === stepIndex ? "accent" : "default"} dot={i === stepIndex}>
                {i < stepIndex ? <Check size={13} aria-hidden /> : null} {s}
              </Tag>
            </li>
          ))}
        </ol>
      </header>

      {opportunity.closed && phase === "upload" ? <Callout tone="warn" title={t("closedTitle")}>{t("closedBody")}</Callout> : null}
      <CheckoutNotice />
      {payment === "failed" ? <Callout tone="warn" title={t("paymentFailedTitle")}>{t("paymentFailedBody")}</Callout> : null}

      {phase === "upload" ? (
        <Pane pad="lg" className="min-w-0">
          <h2 className="text-[1.1rem] font-semibold text-ink">{t("dropTitle")}</h2>
          <p className="mt-1.5 text-[0.94rem] text-ink-3">{t("dropBody")}</p>
          <div className="mt-5">
            <Uploader mode={mode} locale={locale} docs={status?.documents ?? []} onActivity={kick} compact showNote={false} building={status?.phase === "building"} />
          </div>
          {error ? (
            <Callout tone="bad" className="mt-4">
              {error.message}
            </Callout>
          ) : null}
          <p className="mt-5 flex items-center gap-2 text-[0.86rem] text-ink-4">
            <Lock size={14} aria-hidden /> {t("privacy")}
          </p>
        </Pane>
      ) : null}

      {phase === "starting" || phase === "drafting" ? (
        <section aria-busy="true" aria-live="polite" className="grid min-w-0 gap-4">
          <p className="flex items-center gap-2 text-[0.96rem] font-medium text-ink-2">
            <Sparkles size={16} aria-hidden className="text-accent-text" /> {t("drafting", { target })}
          </p>
          {kinds.map((k) => {
            const done = preview?.documents.find((d) => d.kind === k);
            return done ? (
              <DocumentCard key={k} doc={done} />
            ) : (
              <Pane key={k} pad="lg" className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-ink">{t(`kinds.${k}`)}</p>
                  <Tag tone="accent" dot>
                    {t("writing")}
                  </Tag>
                </div>
                <Skeleton className="mt-4 h-5 w-1/3" />
                <SkeletonText className="mt-3" lines={4} />
              </Pane>
            );
          })}
        </section>
      ) : null}

      {phase === "error" ? (
        <Callout
          tone="bad"
          title={t("errorTitle")}
          action={
            error?.signIn ? (
              <ButtonLink href={saveHref} prefetch={false}>
                {t("save")}
              </ButtonLink>
            ) : (
              <Button onClick={() => void start()}>{t("retry")}</Button>
            )
          }
        >
          {error?.message}
        </Callout>
      ) : null}

      {phase === "ready" && preview ? <Ready preview={preview} saveHref={saveHref} officialUrl={opportunity.url} locale={locale} payment={payment} msgs={msgs} /> : null}
    </div>
  );
}

function DocumentCard({ doc }: { doc: ApplyPreview["documents"][number] }) {
  const t = useTranslations("applications.apply");
  const td = useTranslations("applications.documents");
  const gaps = doc.blocks.filter((b) => b.role === "gap").length;
  return (
    <Pane pad="lg" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-semibold text-ink">
          <FileText size={17} aria-hidden className="shrink-0 text-pine" /> <span className="min-w-0 truncate">{doc.title}</span>
        </p>
        <Tag tone={doc.label === "written_with_ai" ? "accent" : "pine"}>{td(`labels.${doc.label}`)}</Tag>
      </div>
      {gaps ? <p className="mt-2 text-[0.88rem] text-ink-3">{t("spots", { n: gaps })}</p> : null}
      <div className="mt-4">
        {doc.composer === "pitch_deck" && !doc.blocks.some((b) => b.flags.includes("masked")) ? (
          <DeckPreview blocks={doc.blocks} />
        ) : (
          <div className="pane-inset min-w-0 px-4 py-5 text-[0.96rem] leading-relaxed text-ink-2 sm:px-7 sm:py-6">
            <div className="mx-auto grid max-w-[680px] gap-3">
              {doc.blocks.map((b, i) =>
                b.role === "gap" ? (
                  <div key={i} className="rounded-[16px] border border-dashed border-[var(--accent)] bg-accent-soft px-4 py-3">
                    <p className="flex items-center gap-1.5 text-[0.8rem] font-semibold uppercase tracking-[0.06em] text-accent-text">
                      <PenLine size={13} aria-hidden /> {td("gap")}
                    </p>
                    <p className="mt-1 text-ink">{b.label ?? b.text}</p>
                  </div>
                ) : b.flags.includes("masked") ? (
                  <div key={i} className="relative">
                    {doc.blocks.findIndex((x) => x.flags.includes("masked")) === i ? (
                      <p className="pointer-events-none absolute inset-x-0 top-6 z-10 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-pane px-3.5 py-1.5 text-[0.84rem] font-medium text-ink shadow-[0_8px_30px_-10px_rgba(18,22,20,.35),0_0_0_1px_var(--line-2)]">
                        <Lock size={13} aria-hidden /> {td("maskedHint")}
                      </p>
                    ) : null}
                    <MaskedBlock b={b} kind={doc.kind} />
                  </div>
                ) : (
                  <BlockText key={i} b={b} kind={doc.kind} />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </Pane>
  );
}

function Ready({ preview, saveHref, officialUrl, locale, payment, msgs }: { preview: ApplyPreview; saveHref: string; officialUrl: string | null; locale: string; payment: "unlocked" | "pending" | "failed" | null; msgs: { network: string; generic: string } }) {
  const t = useTranslations("applications.apply");
  const [tab, setTab] = useState(preview.documents[0]?.id ?? "");
  const onSave = () => {
    track("apply_save", { from: "listing" });
    toast(t("savingToast"));
  };
  const doc = preview.documents.find((d) => d.id === tab) ?? preview.documents[0];
  // A résumé's title is the person's name; the others read "Cover letter — <organisation>".
  const tabLabel = (d: ApplyPreview["documents"][number]) => (d.kind === "resume_variant" || d.kind === "pitch_notes" || d.kind === "one_pager" ? t(`kinds.${d.kind}`) : d.title.split(/ — |｜/)[0]);
  const locked = preview.access.locked;
  return (
    <div className="grid min-w-0 gap-4">
      {/* Paid signed out: the application is theirs by email; one sign-in opens it while Claude writes. */}
      {!locked ? <PaidSignIn email={preview.access.paidEmail} signInHref={saveHref} writing={preview.access.writing} /> : null}
      {locked ? (
        <UnlockPane applicationId={preview.applicationId} locale={locale} signedIn={false} saveHref={saveHref} pending={payment === "pending"} messages={msgs} compact />
      ) : null}
      {preview.documents.length > 1 ? (
        <Tabs label={t("documentsLabel")} items={preview.documents.map((d) => ({ id: d.id, label: tabLabel(d) }))} value={doc?.id} onChange={setTab} size="sm" />
      ) : null}
      {doc ? <DocumentCard doc={doc} /> : null}

      {!locked ? null : (
      <Pane ink pad="lg" className="min-w-0">
        <h2 className="headline text-[1.4rem] sm:text-[1.7rem]">{t("saveTitle")}</h2>
        <p className="mt-2 text-[0.98rem] leading-relaxed opacity-80">
          {preview.questions.length ? t("saveBodyQuestions", { n: preview.questions.length }) : t("saveBody")}
        </p>
        {preview.questions.length ? (
          <ul className="mt-4 grid gap-2">
            {preview.questions.slice(0, 4).map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-[0.94rem] opacity-90">
                <PenLine size={15} aria-hidden className="mt-[3px] shrink-0" /> <span className="min-w-0">{q.prompt}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={saveHref} prefetch={false} onClick={onSave} iconRight={<ArrowRight size={18} aria-hidden />}>
            {t("save")}
          </ButtonLink>
          {officialUrl ? (
            <ButtonLink href={officialUrl} variant="ghost" external icon={<ExternalLink size={16} aria-hidden />}>
              {t("official")}
            </ButtonLink>
          ) : null}
        </div>
        <p className={cx("mt-5 text-[0.84rem] opacity-60")}>{t("saveNote")}</p>
      </Pane>
      )}
    </div>
  );
}
