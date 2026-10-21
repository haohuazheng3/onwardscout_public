"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/components/Consent";
import { PaneSkeleton } from "@/components/Skeletons";
import { Button, Callout, ScoutDot, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import type { IdentityCode, Profile, SubGoalId } from "@/lib/core/types";
import type { GapQuestion } from "@/lib/profile/gaps";
import { signInPath, withLocale } from "@/lib/site";
import { api, ENDPOINTS, type ApiMode, type DraftStatusView } from "./api";
import { GoalChooser, type GoalSubmission } from "./GoalChooser";
import { ParseStatus } from "./ParseStatus";
import { ProfileCard, type PatchResponse, type RoleHint } from "./ProfileCard";
import { Uploader } from "./Uploader";
import { useDraftStatus } from "./useDraftStatus";

/*
 * /app/start — three floating steps, state in the URL (?step=1|2|3) and in the database.
 * Works signed out (an anonymous draft) and signed in. Step changes are instant (history
 * push, no server round trip); the reading status is polled while sources are read.
 */

type Step = 1 | 2 | 3;

export interface StartWizardProps {
  mode: ApiMode;
  signedIn: boolean;
  locale: "en" | "zh";
  claim: boolean;
  status: DraftStatusView;
  profile: Profile;
  profileStatus: string;
  roleHints: Record<string, RoleHint>;
  gaps: GapQuestion[];
  activeSubGoals: SubGoalId[];
}

function readStep(v: string | null): Step {
  return v === "2" ? 2 : v === "3" ? 3 : 1;
}

export function StartWizard(props: StartWizardProps) {
  const { mode, signedIn, locale } = props;
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const router = useRouter();
  const search = useSearchParams();
  const step = readStep(search.get("step"));
  const { status, kick } = useDraftStatus(mode, locale, props.status);
  const [profile, setProfile] = useState<Profile>(props.profile);
  const [profileStatus, setProfileStatus] = useState(props.profileStatus);
  const [gaps, setGaps] = useState<GapQuestion[]>(props.gaps);
  const [roleHints, setRoleHints] = useState(props.roleHints);
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [claiming, setClaiming] = useState(props.claim && signedIn);
  const lastVersion = useRef(props.status.profile?.version ?? 0);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  const go = useCallback((next: Step) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(next));
    url.searchParams.delete("claim");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0 });
  }, []);

  /* ---------- keep the card in step with the extraction ---------- */

  const refreshProfile = useCallback(async () => {
    try {
      const res = await api<{ profile: Profile | null; status: string; gaps: GapQuestion[]; roleHints?: Record<string, RoleHint> }>(ENDPOINTS[mode].profile, {}, msgs);
      if (res.profile) setProfile(res.profile);
      setProfileStatus(res.status);
      setGaps(res.gaps);
      if (res.roleHints) setRoleHints(res.roleHints);
    } catch (err) {
      console.warn("[start] profile refresh failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const v = status?.profile?.version ?? 0;
    if (status?.phase === "ready" && v !== lastVersion.current) {
      lastVersion.current = v;
      void refreshProfile();
    }
  }, [status, refreshProfile]);

  /* ---------- after sign-in: claim the draft and continue ---------- */

  useEffect(() => {
    if (!claiming) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ moved: number; goals: { id: string; family: string; sub: string | null }[] }>("/api/drafts/claim", { method: "POST", json: { locale } }, msgs);
        if (cancelled) return;
        if (res.goals.length) {
          track("profile_confirmed", { via: "claim" });
          for (const g of res.goals) track("goal_set", { goalId: g.id, family: g.family, sub: g.sub });
          router.replace("/app/scout");
          return;
        }
        setClaiming(false);
        router.refresh();
      } catch (err) {
        if (cancelled) return;
        setClaiming(false);
        toast.error(t("claimFailed"), { body: err instanceof Error ? err.message : undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claiming]);

  /* ---------- step 2 → 3: "looks right" ---------- */

  async function confirmProfile() {
    setConfirming(true);
    go(3);
    try {
      if (profile.roles.some((r) => r.inferred)) {
        await api<PatchResponse>(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch: { op: "roles", roles: profile.roles.map((r) => ({ code: r.code, stage: r.stage })) }, locale } }, msgs);
        setProfile((p) => ({ ...p, roles: p.roles.map((r) => ({ ...r, inferred: false })) }));
      }
      await api<PatchResponse>(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch: { op: "confirm" }, locale } }, msgs);
      setProfileStatus("confirmed");
      track("profile_confirmed", { signedIn, roles: profile.roles.map((r) => r.code).join(",") });
    } catch (err) {
      toast.error(t("confirmFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setConfirming(false);
    }
  }

  /* ---------- step 3: finish ---------- */

  async function finish(goals: GoalSubmission[]) {
    const res = await api<{ goals: { id: string; family: string; sub: string | null }[] }>(ENDPOINTS[mode].goals, { method: "POST", json: { goals, locale } }, msgs).catch((err: unknown) => {
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
      return null;
    });
    if (!res) return;
    if (!signedIn) {
      setSaveOpen(true);
      return;
    }
    for (const g of res.goals) track("goal_set", { goalId: g.id, family: g.family, sub: g.sub });
    router.push("/app/scout");
    await new Promise(() => undefined); // stay pressed while the scout page loads
  }

  const docs = status?.documents ?? [];
  const busy = status?.phase === "reading" || status?.phase === "building" || profileStatus === "parsing";
  const codes: IdentityCode[] = profile.roles.map((r) => r.code);
  const steps = [t("steps.drop"), t("steps.card"), t("steps.goals")];
  const signInHref = signInPath(locale, withLocale(locale, "/app/start?step=3&claim=1"));

  if (claiming) {
    return (
      <div className="mx-auto grid max-w-[760px] gap-4">
        <section className="pane p-6 sm:p-8" aria-live="polite" aria-busy="true">
          <p className="flex items-center gap-2.5 text-[1.05rem] font-semibold text-ink">
            <ScoutDot live />
            {t("claiming")}
          </p>
          <p className="mt-1.5 text-[0.95rem] text-ink-3">{t("claimingBody")}</p>
        </section>
        <PaneSkeleton lines={3} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <nav aria-label={t("steps.label")} className="mb-6">
        <ol className="grid grid-cols-3 gap-2">
          {steps.map((label, i) => {
            const n = (i + 1) as Step;
            const done = n < step;
            const current = n === step;
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  onClick={() => (n < step ? go(n) : undefined)}
                  disabled={n > step}
                  aria-current={current ? "step" : undefined}
                  className={cx("press group flex w-full min-w-0 flex-col gap-2 text-left", n > step && "cursor-default")}
                >
                  <span className={cx("h-1.5 w-full rounded-full transition-colors", done || current ? "bg-ink" : "bg-line-2")} aria-hidden="true" />
                  <span className={cx("flex min-w-0 items-center gap-1.5 text-[0.8rem] font-semibold sm:text-[0.86rem]", current ? "text-ink" : done ? "text-ink-2" : "text-ink-4")}>
                    {done ? <Check size={13} className="shrink-0 text-pine" aria-hidden /> : <span className="num shrink-0">{n}</span>}
                    <span className="truncate">{label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 1 ? (
        <div className="grid gap-4">
          <header className="px-1">
            <h1 className="headline text-[1.85rem] text-ink sm:text-[2.35rem]">{t("drop.title")}</h1>
            <p className="mt-2 max-w-xl text-[1rem] leading-relaxed text-ink-3">{t("drop.lede")}</p>
          </header>
          <Uploader mode={mode} locale={locale} docs={docs} onActivity={kick} />
          <ParseStatus status={status} />
          <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="link self-center text-[0.92rem] sm:self-auto" onClick={() => go(2)}>
              {docs.length ? t("drop.skipMore") : t("drop.skip")}
            </button>
            <Button size="lg" onClick={() => go(2)} disabled={!docs.length} iconRight={<ArrowRight size={18} aria-hidden />}>
              {busy ? t("drop.continueWhileReading") : t("drop.continue")}
            </Button>
          </div>
          {!signedIn ? <p className="px-1 text-center text-[0.84rem] leading-relaxed text-ink-4 sm:text-left">{t("drop.privacy")}</p> : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4">
          <header className="px-1">
            <h1 className="headline text-[1.85rem] text-ink sm:text-[2.35rem]">{t("card.title")}</h1>
            <p className="mt-2 max-w-xl text-[1rem] leading-relaxed text-ink-3">{busy ? t("card.ledeBuilding") : t("card.lede")}</p>
          </header>
          {busy ? <ParseStatus status={status} /> : null}
          {!docs.length && !profile.roles.length ? (
            <Callout tone="info" title={t("card.noSourcesTitle")}>
              {t("card.noSourcesBody")}
            </Callout>
          ) : null}
          <ProfileCard
            mode={mode}
            locale={locale}
            profile={profile}
            roleHints={roleHints}
            gaps={gaps}
            building={busy}
            onChange={(p, res) => {
              setProfile(p);
              if (res) setGaps(res.gaps);
            }}
          />
          <div className="flex items-center justify-between gap-3 pt-2">
            <Button variant="ghost" onClick={() => go(1)} icon={<ArrowLeft size={17} aria-hidden />}>
              {tc("buttons.back")}
            </Button>
            <Button size="lg" onClick={() => void confirmProfile()} loading={confirming} disabled={!profile.roles.length} iconRight={<ArrowRight size={18} aria-hidden />}>
              {t("card.looksRight")}
            </Button>
          </div>
          {!profile.roles.length ? <p className="text-right text-[0.85rem] text-ink-4">{t("card.needRole")}</p> : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-4">
          <header className="px-1">
            <h1 className="headline text-[1.85rem] text-ink sm:text-[2.35rem]">{t("goals.title")}</h1>
            <p className="mt-2 max-w-xl text-[1rem] leading-relaxed text-ink-3">{t("goals.lede")}</p>
          </header>
          <GoalChooser
            key={codes.join(",")}
            codes={codes}
            profile={profile}
            locale={locale}
            exclude={props.activeSubGoals}
            submitLabel={signedIn ? t("goals.finish") : t("goals.finishSave")}
            footnote={signedIn ? t("goals.footnote") : t("goals.footnoteSignedOut")}
            onSubmit={finish}
          />
          <div className="pt-1">
            <Button variant="ghost" onClick={() => go(2)} icon={<ArrowLeft size={17} aria-hidden />}>
              {tc("buttons.back")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={t("save.title")}
        description={t("save.body")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              {t("save.later")}
            </Button>
            <a href={signInHref} className="btn btn-primary" onClick={() => track("save_scout_clicked")}>
              <span className="btn-label">{t("save.cta")}</span>
              <ArrowRight size={17} aria-hidden />
            </a>
          </>
        }
      >
        <ul className="grid gap-2.5 text-[0.95rem] text-ink-2">
          {(["point1", "point2", "point3"] as const).map((k) => (
            <li key={k} className="flex gap-2.5">
              <Check size={18} className="mt-0.5 shrink-0 text-pine" aria-hidden />
              <span>{t(`save.${k}`)}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
