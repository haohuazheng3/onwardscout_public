"use client";

import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Coins,
  Compass,
  GraduationCap,
  Image as ImageIcon,
  MapPin,
  Mic,
  Microscope,
  Rocket,
  Search,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "@/components/Consent";
import { PaneSkeleton } from "@/components/Skeletons";
import { Button, Chip, Input, ScoutDot, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { IDENTITY_GROUP_DEFS, identitiesInGroup, identityLabel, isMinor } from "@/lib/core/identities";
import { localize } from "@/lib/core/labels";
import { isOccupationCode, mapOccupation, occupationLabel } from "@/lib/core/occupations";
import type { GoalFamily, Intensity, IdentityCode, IdentityGroup, Profile, RemotePreference, SubGoalId } from "@/lib/core/types";
import { countryOfLocation } from "@/lib/llm/local/geo";
import { targetRoleOptions } from "@/lib/profile/gaps";
import type { ProfilePatch } from "@/lib/profile/patch";
import { isJobGoal, quickGoalById, quickGoalsFor, type QuickGoal } from "@/lib/profile/quick-goals";
import { snapHorizon, successOptions } from "@/lib/profile/success-params";
import { signInPath, withLocale } from "@/lib/site";
import { api, ENDPOINTS, type ApiMode, type DraftStatusView } from "./api";
import { ParseStatus } from "./ParseStatus";
import { citySuggestions, type RoleHint } from "./ProfileCard";
import { Uploader } from "./Uploader";
import { useDraftStatus } from "./useDraftStatus";

/*
 * /app/start — one question per screen, only the answers the engines use:
 *   files → who you are (confirmed from the files, or picked) → what you're going for →
 *   [jobs: which role, remote or not] → [no city in the files: where] → [under 18: guardian].
 * A single-choice answer moves on by itself; every answer saves at once (optimistic, rolled
 * back with a toast if the save fails). Success definition, horizon and intensity take their
 * defaults and can be changed on /app/goals. The screen is in the URL (?q=), so back works.
 * Works signed out (an anonymous draft) and signed in.
 */

type Screen = "files" | "who" | "kind" | "goal" | "role" | "remote" | "where" | "guardian";

const SCREENS: readonly Screen[] = ["files", "who", "kind", "goal", "role", "remote", "where", "guardian"];
const USER_GROUPS = IDENTITY_GROUP_DEFS.filter((g) => !g.supplySide);
const GOAL_ICON: Record<QuickGoal["icon"], LucideIcon> = {
  briefcase: Briefcase,
  graduation: GraduationCap,
  rocket: Rocket,
  coins: Coins,
  microscope: Microscope,
  mic: Mic,
  image: ImageIcon,
  trophy: Trophy,
  compass: Compass,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OnboardingFlowProps {
  mode: ApiMode;
  signedIn: boolean;
  locale: "en" | "zh";
  claim: boolean;
  status: DraftStatusView;
  profile: Profile;
  roleHints: Record<string, RoleHint>;
  /** Goals the person already runs: picking one again keeps its success definition, horizon and intensity. */
  activeGoals: ExistingGoal[];
}

export interface ExistingGoal {
  family: GoalFamily;
  sub: SubGoalId | null;
  successDefinition: string | null;
  horizonMonths: number | null;
  intensity: Intensity | null;
}

/** True once the person has moved between screens: from then on each new question takes the focus. */
const FocusTitle = createContext(false);

/** ?q=<screen>; the old three-step links (?step=2 profile, ?step=3 goals) land on their question. */
function readScreen(q: string | null, step: string | null): Screen {
  if (SCREENS.includes(q as Screen)) return q as Screen;
  return step === "2" ? "who" : step === "3" ? "goal" : "files";
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  const { mode, signedIn, locale } = props;
  const t = useTranslations("onboarding");
  const tf = useTranslations("onboarding.flow");
  const tc = useTranslations("common");
  const router = useRouter();
  const search = useSearchParams();
  const screen = readScreen(search.get("q"), search.get("step"));
  const { status, kick } = useDraftStatus(mode, locale, props.status);
  const [profile, setProfile] = useState<Profile>(props.profile);
  const [roleHints, setRoleHints] = useState(props.roleHints);
  const [group, setGroup] = useState<IdentityGroup | null>(null);
  const goalId = search.get("goal");
  const [sawWho, setSawWho] = useState(false);
  const [moved, setMoved] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [claiming, setClaiming] = useState(props.claim && signedIn);
  const lastVersion = useRef(props.status.profile?.version ?? 0);
  const seq = useRef(0);
  /**
   * Saves run one after another: the first one of a signed-out visitor creates the draft cookie, and
   * the goal copies remote/role/city from the profile, so finishing waits for the queue to drain.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const failures = useRef(0);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  const docs = status?.documents ?? [];
  const reading = status?.phase === "reading" || status?.phase === "building";
  const codes = profile.roles.map((r) => r.code) as IdentityCode[];
  const goal = goalId ? quickGoalById(goalId) : null;

  /* ---------- the plan: which screens this person sees ---------- */

  const plan = useMemo<Screen[]>(() => {
    const out: Screen[] = ["files", "who"];
    if (group || screen === "kind") out.push("kind");
    out.push("goal");
    if (goal && isJobGoal(goal.sub)) out.push("role", "remote");
    // Asked only when the files didn't say (a city answered here stays in the plan while it's on screen).
    if (!profile.identity.location || screen === "where") out.push("where");
    if (isMinor(codes) && (!profile.identity.guardianEmail || screen === "guardian")) out.push("guardian");
    return out;
  }, [group, screen, goal, codes, profile.identity.location, profile.identity.guardianEmail]);

  const index = Math.max(0, plan.indexOf(screen));

  function go(next: Screen, extra: Record<string, string | null> = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set("q", next);
    url.searchParams.delete("step");
    url.searchParams.delete("claim");
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0 });
    setMoved(true);
  }

  // A screen that isn't in the plan (the browser's back button after the goal changed) falls back to the goal question.
  useEffect(() => {
    if (plan.includes(screen)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", "goal");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [plan, screen]);

  // Remembered for finishing: only someone who saw "who you are" has confirmed it.
  if ((screen === "who" || screen === "kind") && !sawWho) setSawWho(true);

  /** The screen after `from` in the current plan; finishing when there is none. */
  function next(from: Screen, override?: { plan?: Screen[]; goalId?: string }) {
    const p = override?.plan ?? plan;
    const after = p[p.indexOf(from) + 1];
    if (after) go(after, override?.goalId ? { goal: override.goalId } : {});
    else void finish(override?.goalId ?? goalId);
  }

  /* ---------- keep the profile in step with the reading ---------- */

  const refreshProfile = useCallback(async () => {
    try {
      await chain.current; // never overwrite an answer that is still on its way to the server
      const res = await api<{ profile: Profile | null; roleHints?: Record<string, RoleHint> }>(ENDPOINTS[mode].profile, {}, msgs);
      if (res.profile) setProfile(res.profile);
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

  /* ---------- saving ---------- */

  /** Optimistic: the profile changes now; a failed save puts it back and says so. */
  function save(patch: ProfilePatch, nextProfile: Profile): Promise<boolean> {
    const before = profile;
    const mine = ++seq.current;
    setProfile(nextProfile);
    const done = chain.current
      .then(() => api(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch, locale } }, msgs))
      .then(
        () => true,
        (err: unknown) => {
          failures.current++;
          // The latest answer failed: put it back. An earlier one failed: ask the server what it kept.
          if (mine === seq.current) setProfile(before);
          else void refreshProfile();
          toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
          return false;
        },
      );
    chain.current = done;
    return done;
  }

  async function finish(id: string | null) {
    const chosen = id ? quickGoalById(id) : null;
    if (!chosen) {
      go("goal");
      return;
    }
    setFinishing(true);
    try {
      await chain.current;
      if (failures.current) {
        // An answer didn't save (the toast said so): stay here so it can be given again.
        failures.current = 0;
        setFinishing(false);
        return;
      }
      // Only a person who saw "who you are" has confirmed it (?q=goal from the home page skips it).
      if (sawWho) {
        await api(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch: { op: "confirm" }, locale } }, msgs);
        track("profile_confirmed", { signedIn, roles: codes.join(",") });
      }
      // A goal the person already runs keeps what they set for it; a new one takes the defaults.
      const existing = props.activeGoals.find((g) => g.family === chosen.family && g.sub === chosen.sub);
      const first = successOptions(chosen.sub, profile, 6, locale)[0];
      const horizon = existing?.horizonMonths ?? snapHorizon(first?.horizonMonths ?? 6);
      const success = existing?.successDefinition || successOptions(chosen.sub, profile, horizon, locale)[0]?.text?.trim() || localize(chosen.label, locale);
      const intensity: Intensity = existing?.intensity ?? "steady";
      const res = await api<{ goals: { id: string; family: string; sub: string | null }[] }>(
        ENDPOINTS[mode].goals,
        { method: "POST", json: { goals: [{ family: chosen.family, sub: chosen.sub, successDefinition: success, templateId: null, horizonMonths: horizon, intensity }], locale } },
        msgs,
      );
      if (!signedIn) {
        setFinishing(false);
        setSaveOpen(true);
        return;
      }
      for (const g of res.goals) track("goal_set", { goalId: g.id, family: g.family, sub: g.sub });
      router.push("/app/scout");
    } catch (err) {
      setFinishing(false);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  /* ---------- views ---------- */

  const signInHref = signInPath(locale, withLocale(locale, "/app/start?claim=1"));

  if (claiming || finishing) {
    return (
      <div className="mx-auto grid max-w-[640px] gap-4">
        <section className="pane p-6 sm:p-8" aria-live="polite" aria-busy="true">
          <p className="flex items-center gap-2.5 text-[1.05rem] font-semibold text-ink">
            <ScoutDot live />
            {claiming ? t("claiming") : tf("finishing")}
          </p>
          <p className="mt-1.5 text-[0.95rem] text-ink-3">{claiming ? t("claimingBody") : signedIn ? tf("finishingBody") : tf("finishingBodyDraft")}</p>
        </section>
        <PaneSkeleton lines={3} />
      </div>
    );
  }

  return (
    <FocusTitle.Provider value={moved}>
    <div className="mx-auto max-w-[640px]">
      <div className="mb-6 flex items-center gap-3">
        {index > 0 ? (
          <button type="button" onClick={() => go(plan[index - 1]!)} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-pane-2" aria-label={tc("buttons.back")}>
            <ArrowLeft size={19} aria-hidden />
          </button>
        ) : null}
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-2" role="progressbar" aria-valuemin={1} aria-valuemax={plan.length} aria-valuenow={index + 1} aria-label={tf("progress", { n: index + 1, total: plan.length })}>
          <span className="block h-full rounded-full bg-ink transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / plan.length) * 100}%` }} />
        </div>
        <span className="num shrink-0 text-[0.82rem] text-ink-4">{tf("progress", { n: index + 1, total: plan.length })}</span>
      </div>

      {screen === "files" ? (
        <Question title={t("drop.title")} hint={t("drop.lede")}>
          <Uploader mode={mode} locale={locale} docs={docs} onActivity={kick} />
          <ParseStatus status={status} />
          <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="link self-center text-[0.92rem] sm:self-auto" onClick={() => next("files")}>
              {docs.length ? t("drop.skipMore") : t("drop.skip")}
            </button>
            <Button size="lg" onClick={() => next("files")} disabled={!docs.length} iconRight={<ArrowRight size={18} aria-hidden />}>
              {reading ? t("drop.continueWhileReading") : t("drop.continue")}
            </Button>
          </div>
          {!signedIn ? <p className="px-1 text-center text-[0.84rem] leading-relaxed text-ink-4 sm:text-left">{t("drop.privacy")}</p> : null}
        </Question>
      ) : null}

      {screen === "who" ? (
        <WhoScreen
          profile={profile}
          locale={locale}
          reading={reading}
          roleHints={roleHints}
          onConfirm={() => {
            if (profile.roles.some((r) => r.inferred)) {
              const roles = profile.roles.map((r) => ({ ...r, inferred: false }));
              void save({ op: "roles", roles: roles.map((r) => ({ code: r.code, stage: r.stage })) }, { ...profile, roles });
            }
            setGroup(null);
            next("who", { plan: plan.filter((s) => s !== "kind") });
          }}
          onGroup={(g) => {
            setGroup(g);
            go("kind");
          }}
        />
      ) : null}

      {screen === "kind" ? (
        <KindScreen
          group={group}
          locale={locale}
          selected={codes}
          onPick={(code) => {
            const roles = [{ code, stage: null, since: null, inferred: false }];
            void save({ op: "roles", roles: [{ code, stage: null }] }, { ...profile, roles });
            next("kind");
          }}
          onRestart={() => go("who")}
        />
      ) : null}

      {screen === "goal" ? (
        <GoalScreen
          codes={codes}
          locale={locale}
          selected={goalId}
          onPick={(g) => {
            // The plan depends on the goal (jobs add two questions), so it is worked out here.
            const p: Screen[] = plan.filter((s) => s !== "role" && s !== "remote");
            if (isJobGoal(g.sub)) p.splice(p.indexOf("goal") + 1, 0, "role", "remote");
            next("goal", { plan: p, goalId: g.id });
          }}
        />
      ) : null}

      {screen === "role" ? (
        <RoleScreen
          profile={profile}
          locale={locale}
          onDone={(picks) => {
            if (picks.length) void save({ op: "answer", questionId: "jobSeeker.targetRole", values: picks }, withTargetRoles(profile, picks));
            next("role");
          }}
        />
      ) : null}

      {screen === "remote" ? (
        <Question title={tf("remote.title")} hint={tf("remote.hint")}>
          <Options>
            {(["remote_only", "remote_ok"] as RemotePreference[]).map((v) => (
              <Option
                key={v}
                selected={profile.packs.jobSeeker?.remote === v}
                label={tf(v === "remote_only" ? "remote.only" : "remote.either")}
                onClick={() => {
                  void save({ op: "remote", value: v }, withRemote(profile, v));
                  next("remote");
                }}
              />
            ))}
          </Options>
        </Question>
      ) : null}

      {screen === "where" ? (
        <WhereScreen
          initial={profile.identity.location ?? ""}
          locale={locale}
          onDone={(loc) => {
            if (loc) void save({ op: "location", location: loc.location, city: loc.city, countryCode: loc.countryCode }, { ...profile, identity: { ...profile.identity, location: loc.location, city: loc.city, countryCode: loc.countryCode } });
            next("where");
          }}
        />
      ) : null}

      {screen === "guardian" ? (
        <GuardianScreen
          initial={profile.identity.guardianEmail ?? ""}
          onDone={(email) => {
            if (email) void save({ op: "field", field: "guardianEmail", value: email }, { ...profile, identity: { ...profile.identity, guardianEmail: email } });
            next("guardian");
          }}
        />
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
    </FocusTitle.Provider>
  );
}

/* ------------------------------------------------------------------ profile helpers */

const EMPTY_JOB_SEEKER = { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null };

function withRemote(p: Profile, remote: RemotePreference): Profile {
  return { ...p, packs: { ...p.packs, jobSeeker: { ...(p.packs.jobSeeker ?? EMPTY_JOB_SEEKER), remote } } };
}

function withTargetRoles(p: Profile, codes: string[]): Profile {
  return { ...p, packs: { ...p.packs, jobSeeker: { ...(p.packs.jobSeeker ?? EMPTY_JOB_SEEKER), targetOccupations: codes } } };
}

/* ------------------------------------------------------------------ building blocks */

function Question({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  const focus = useContext(FocusTitle);
  const ref = useRef<HTMLHeadingElement>(null);
  // A new question is announced and keyboard focus starts at it (not on the first visit to the page).
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="grid gap-4" aria-labelledby="q-title">
      <header className="px-1">
        <h1 ref={ref} tabIndex={-1} id="q-title" className="headline text-[1.85rem] text-ink outline-none sm:text-[2.35rem]">
          {title}
        </h1>
        {hint ? <p className="mt-2 max-w-xl text-[1rem] leading-relaxed text-ink-3">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Options({ children }: { children: ReactNode }) {
  return <div className="grid gap-2.5">{children}</div>;
}

function Option({ label, hint, icon, selected, onClick }: { label: string; hint?: string; icon?: ReactNode; selected?: boolean; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const on = selected || pressed;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        setPressed(true);
        onClick();
      }}
      className={cx(
        "pane pane-hover press flex w-full min-w-0 items-center gap-3.5 px-4 py-3.5 text-left sm:px-5 sm:py-4",
        on && "shadow-[inset_0_0_0_2px_var(--pine)]",
      )}
    >
      {icon ? <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", on ? "bg-pine text-void" : "bg-pine-soft text-pine")}>{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[1.02rem] font-semibold leading-snug text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[0.88rem] leading-snug text-ink-3">{hint}</span> : null}
      </span>
      {on ? <Check size={19} className="shrink-0 text-pine" aria-hidden /> : <ChevronRight size={18} className="shrink-0 text-ink-4" aria-hidden />}
    </button>
  );
}

/* ------------------------------------------------------------------ screens */

function WhoScreen({
  profile,
  locale,
  reading,
  roleHints,
  onConfirm,
  onGroup,
}: {
  profile: Profile;
  locale: "en" | "zh";
  reading: boolean;
  roleHints: Record<string, RoleHint>;
  onConfirm: () => void;
  onGroup: (g: IdentityGroup) => void;
}) {
  const tf = useTranslations("onboarding.flow");
  const [changing, setChanging] = useState(false);
  const roles = profile.roles;

  if (roles.length && !changing) {
    const names = roles.map((r) => identityLabel(r.code, locale)).join(locale === "zh" ? "、" : " · ");
    const inferred = roles.some((r) => r.inferred);
    const why = inferred ? roles.map((r) => roleHints[r.code]?.why).find(Boolean) : undefined;
    return (
      <Question title={tf("who.confirmTitle")} hint={why ? tf("who.because", { why }) : inferred ? tf("who.confirmHint") : tf("who.savedHint")}>
        <div className="pane p-5 sm:p-6">
          <p className="text-[1.25rem] font-semibold leading-snug text-ink">{names}</p>
        </div>
        <Options>
          <Option label={tf("who.yes")} onClick={onConfirm} />
          <Option label={tf("who.change")} onClick={() => setChanging(true)} />
        </Options>
      </Question>
    );
  }

  return (
    <Question title={tf("who.title")} hint={tf("who.hint")}>
      {reading && !changing ? (
        <p className="flex items-center gap-2.5 px-1 text-[0.95rem] text-ink-3" aria-live="polite">
          <ScoutDot live />
          {tf("who.reading")}
        </p>
      ) : null}
      <Options>
        {USER_GROUPS.map((g) => (
          <Option key={g.id} label={localize(g.label, locale)} onClick={() => onGroup(g.id)} />
        ))}
      </Options>
    </Question>
  );
}

function KindScreen({ group, locale, selected, onPick, onRestart }: { group: IdentityGroup | null; locale: "en" | "zh"; selected: IdentityCode[]; onPick: (code: IdentityCode) => void; onRestart: () => void }) {
  const tf = useTranslations("onboarding.flow");
  if (!group) {
    // Reached by a reload or the back button: the group lives in memory only.
    return (
      <Question title={tf("who.title")}>
        <Options>
          <Option label={tf("kind.restart")} onClick={onRestart} />
        </Options>
      </Question>
    );
  }
  return (
    <Question title={tf("kind.title")} hint={tf("kind.hint")}>
      <Options>
        {identitiesInGroup(group).map((d) => (
          <Option key={d.code} label={localize(d.label, locale)} selected={selected.length === 1 && selected[0] === d.code} onClick={() => onPick(d.code)} />
        ))}
      </Options>
    </Question>
  );
}

function GoalScreen({ codes, locale, selected, onPick }: { codes: IdentityCode[]; locale: "en" | "zh"; selected: string | null; onPick: (g: QuickGoal) => void }) {
  const tf = useTranslations("onboarding.flow");
  const { first, more } = useMemo(() => quickGoalsFor(codes), [codes]);
  const [showMore, setShowMore] = useState(() => more.some((g) => g.id === selected));
  const moreRef = useRef<HTMLDivElement>(null);
  const option = (g: QuickGoal) => {
    const Icon = GOAL_ICON[g.icon];
    return <Option key={g.id} label={localize(g.label, locale)} hint={localize(g.hint, locale)} icon={<Icon size={18} aria-hidden />} selected={selected === g.id} onClick={() => onPick(g)} />;
  };
  return (
    <Question title={tf("goal.title")} hint={tf("goal.hint")}>
      <Options>{first.map(option)}</Options>
      {showMore ? (
        <div ref={moreRef} className="animate-pop">
          <Options>{more.map(option)}</Options>
        </div>
      ) : (
        <button
          type="button"
          className="link w-fit px-1 text-[0.95rem]"
          aria-expanded={showMore}
          onClick={() => {
            setShowMore(true);
            requestAnimationFrame(() => moreRef.current?.querySelector("button")?.focus());
          }}
        >
          {tf("goal.more", { count: more.length })}
        </button>
      )}
    </Question>
  );
}

function RoleScreen({ profile, locale, onDone }: { profile: Profile; locale: "en" | "zh"; onDone: (picks: string[]) => void }) {
  const tf = useTranslations("onboarding.flow");
  const suggested = useMemo(() => targetRoleOptions(profile).map((o) => o.value), [profile]);
  // The files may hold a target role in the person's own words ("Head of Growth"): only taxonomy codes are
  // picks; the first such phrase seeds the search so it maps in one tap.
  const saved = profile.packs.jobSeeker?.targetOccupations ?? [];
  const [picks, setPicks] = useState<string[]>(() => saved.filter(isOccupationCode).slice(0, 3));
  const [query, setQuery] = useState(() => saved.find((c) => !isOccupationCode(c)) ?? "");
  const shown = [...new Set([...picks, ...suggested])];
  const results = useMemo(() => (query.trim().length >= 2 ? mapOccupation(query, { limit: 6 }).map((m) => m.code) : []), [query]);
  const fresh = results.filter((c) => !shown.includes(c));

  function toggle(code: string) {
    setPicks((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code].slice(-3)));
  }

  return (
    <Question title={tf("role.title")} hint={tf("role.hint")}>
      {shown.length ? (
        <div className="flex flex-wrap gap-2">
          {shown.map((c) => (
            <Chip key={c} selected={picks.includes(c)} onClick={() => toggle(c)}>
              {occupationLabel(c, locale)}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tf("role.search")} aria-label={tf("role.search")} className="pl-11" autoComplete="off" autoCapitalize="none" />
      </div>
      {fresh.length ? (
        <div className="flex flex-wrap gap-2 animate-pop" role="group" aria-label={tf("role.results")}>
          {fresh.map((c) => (
              <Chip
                key={c}
                onClick={() => {
                  toggle(c);
                  setQuery("");
                }}
              >
                {occupationLabel(c, locale)}
              </Chip>
            ))}
        </div>
      ) : query.trim().length >= 2 && !results.length ? (
        <p className="px-1 text-[0.86rem] text-ink-4">{tf("role.none")}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button type="button" className="link text-[0.92rem]" onClick={() => onDone([])}>
          {tf("skip")}
        </button>
        <Button size="lg" onClick={() => onDone(picks)} disabled={!picks.length} iconRight={<ArrowRight size={18} aria-hidden />}>
          {tf("continue")}
        </Button>
      </div>
    </Question>
  );
}

function WhereScreen({ initial, locale, onDone }: { initial: string; locale: "en" | "zh"; onDone: (loc: { location: string; city: string | null; countryCode: string | null } | null) => void }) {
  const tf = useTranslations("onboarding.flow");
  const [query, setQuery] = useState(initial);
  const suggestions = useMemo(() => citySuggestions(query, locale), [query, locale]);
  const typed = query.trim();
  return (
    <Question title={tf("where.title")} hint={tf("where.hint")}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tf("where.placeholder")}
        aria-label={tf("where.title")}
        autoComplete="address-level2"
        onKeyDown={(e) => {
          if (e.key === "Enter" && typed) {
            e.preventDefault();
            onDone({ location: typed, city: null, countryCode: countryOfLocation(typed) });
          }
        }}
      />
      {typed.length >= 2 ? (
        <Options>
          {suggestions.map((s) => (
            <Option key={s.location} label={s.location} icon={<MapPin size={17} aria-hidden />} onClick={() => onDone(s)} />
          ))}
          {suggestions.some((s) => s.location.toLowerCase() === typed.toLowerCase()) ? null : (
            <Option label={tf("where.useTyped", { text: typed })} onClick={() => onDone({ location: typed, city: null, countryCode: countryOfLocation(typed) })} />
          )}
        </Options>
      ) : null}
      <div className="pt-1">
        <button type="button" className="link text-[0.92rem]" onClick={() => onDone(null)}>
          {tf("skip")}
        </button>
      </div>
    </Question>
  );
}

function GuardianScreen({ initial, onDone }: { initial: string; onDone: (email: string | null) => void }) {
  const tf = useTranslations("onboarding.flow");
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState(false);
  function submit() {
    const v = email.trim();
    if (!EMAIL.test(v)) {
      setError(true);
      return;
    }
    onDone(v);
  }
  return (
    <Question title={tf("guardian.title")} hint={tf("guardian.hint")}>
      <Input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="name@example.com"
        aria-label={tf("guardian.title")}
        aria-invalid={error || undefined}
        aria-describedby={error ? "guardian-error" : undefined}
        autoComplete="email"
        autoCapitalize="none"
      />
      {error ? (
        <p id="guardian-error" role="alert" className="px-1 text-[0.88rem] text-bad">
          {tf("guardian.invalid")}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button type="button" className="link text-[0.92rem]" onClick={() => onDone(null)}>
          {tf("guardian.later")}
        </button>
        <Button size="lg" onClick={submit} iconRight={<ArrowRight size={18} aria-hidden />}>
          {tf("continue")}
        </Button>
      </div>
    </Question>
  );
}
