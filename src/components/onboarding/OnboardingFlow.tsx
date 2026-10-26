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
import { Button, Chip, Input, ScoutDot, Tag, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { IDENTITY_GROUP_DEFS, identitiesInGroup, isMinor } from "@/lib/core/identities";
import { localize } from "@/lib/core/labels";
import { isOccupationCode, mapOccupation, occupationLabel } from "@/lib/core/occupations";
import { groupOfIdentity, type GoalFamily, type IdentityCode, type IdentityGroup, type Intensity, type Profile, type RemotePreference, type SubGoalId } from "@/lib/core/types";
import { countryOfLocation } from "@/lib/llm/local/geo";
import { targetRoleOptions } from "@/lib/profile/gaps";
import type { ProfilePatch } from "@/lib/profile/patch";
import { isJobGoal, quickGoalById, quickGoalsFor, type QuickGoal } from "@/lib/profile/quick-goals";
import { snapHorizon, successOptions } from "@/lib/profile/success-params";
import { signInPath, withLocale } from "@/lib/site";
import { api, ENDPOINTS, type ApiMode, type DraftStatusView } from "./api";
import { ParseStatus } from "./ParseStatus";
import { citySuggestions } from "./ProfileCard";
import { Uploader } from "./Uploader";
import { useDraftStatus } from "./useDraftStatus";

/*
 * /app/start — one piece of information per screen, every essential question asked:
 *   files → what you do now → one detail of it → what you're going for → [a founder or creator
 *   goal for someone who isn't one: that detail too] → [jobs: which role, remote or not] →
 *   where you're based → [under 18: guardian].
 * The files never answer for the person: what they say only pre-selects an answer ("From your
 * résumé"), which one tap confirms or another tap changes. Answers save at once (queued; a failed
 * save rolls back with a toast) and the goal is created last, so it copies the saved remote, role
 * and city. Success definition, horizon and intensity take defaults (kept for a goal the person
 * already runs), editable on /app/goals. The screen is in the URL (?q=, with ?g= and ?goal=).
 */

type Screen = "files" | "situation" | "detail" | "goal" | "extra" | "role" | "remote" | "where" | "guardian";

const SCREENS: readonly Screen[] = ["files", "situation", "detail", "goal", "extra", "role", "remote", "where", "guardian"];
const USER_GROUPS = IDENTITY_GROUP_DEFS.filter((g) => !g.supplySide).map((g) => g.id);
/** Startup goals are for founders and creative goals for creators: someone who isn't one is asked that detail too. */
const EXTRA_GROUP: Partial<Record<GoalFamily, IdentityGroup>> = { G3: "F", G6: "C" };
const EXTRA_GROUPS: readonly IdentityGroup[] = ["F", "C"];
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

export interface ExistingGoal {
  family: GoalFamily;
  sub: SubGoalId | null;
  successDefinition: string | null;
  horizonMonths: number | null;
  intensity: Intensity | null;
}

export interface OnboardingFlowProps {
  mode: ApiMode;
  signedIn: boolean;
  locale: "en" | "zh";
  claim: boolean;
  status: DraftStatusView;
  profile: Profile;
  /** Goals the person already runs: picking one again keeps its success definition, horizon and intensity. */
  activeGoals: ExistingGoal[];
  /** Profile paths the person answered themselves: their values are presets without the "from your résumé" tag. */
  confirmedPaths: string[];
}

type Role = Profile["roles"][number];

/** True once the person has moved between screens: from then on each new question takes the focus. */
const FocusTitle = createContext(false);

/** ?q=<screen>; the old three-step links (?step=2 profile, ?step=3 goals) land on their question. */
function readScreen(q: string | null, step: string | null): Screen {
  if (SCREENS.includes(q as Screen)) return q as Screen;
  return step === "2" ? "situation" : step === "3" ? "goal" : "files";
}

function readGroup(v: string | null): IdentityGroup | null {
  return USER_GROUPS.includes(v as IdentityGroup) ? (v as IdentityGroup) : null;
}

/** The founder or creator detail a goal needs when the person's main identity isn't one. */
function extraGroupFor(family: GoalFamily, primary: IdentityCode | undefined): IdentityGroup | null {
  const need = EXTRA_GROUP[family];
  return need && primary && groupOfIdentity(primary) !== need ? need : null;
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  const { mode, signedIn, locale } = props;
  const t = useTranslations("onboarding");
  const tf = useTranslations("onboarding.flow");
  const tc = useTranslations("common");
  const router = useRouter();
  const search = useSearchParams();
  const screen = readScreen(search.get("q"), search.get("step"));
  const goalId = search.get("goal");
  const { status, kick } = useDraftStatus(mode, locale, props.status);
  const [profile, setProfile] = useState<Profile>(props.profile);
  /** What the files said about the person: presets only, never answers. */
  const [fromFiles, setFromFiles] = useState<Role[]>(() => props.profile.roles.filter((r) => r.inferred));
  const [moved, setMoved] = useState(false);
  const [sawWho, setSawWho] = useState(false);
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
  const roles = profile.roles;
  const codes = roles.map((r) => r.code);
  const primary = roles[0];
  const goal = goalId ? quickGoalById(goalId) : null;
  const extraGroup = goal ? extraGroupFor(goal.family, primary?.code) : null;
  const answered = (path: string) => props.confirmedPaths.includes(path);

  /** The answer to pre-select for a group: the person's own answer first, else what the files said. */
  const presetIn = (group: IdentityGroup): Role | undefined => roles.find((r) => groupOfIdentity(r.code) === group) ?? fromFiles.find((r) => groupOfIdentity(r.code) === group);
  const situationPreset = (primary ?? fromFiles[0]) ? groupOfIdentity((primary ?? fromFiles[0])!.code) : null;
  const situation = readGroup(search.get("g")) ?? situationPreset;

  /* ---------- the plan: which screens this person sees ---------- */

  const plan = useMemo<Screen[]>(() => {
    const out: Screen[] = ["files", "situation", "detail", "goal"];
    if (extraGroup) out.push("extra");
    if (goal && isJobGoal(goal.sub)) out.push("role", "remote");
    out.push("where");
    if (isMinor(codes) && (!profile.identity.guardianEmail || screen === "guardian")) out.push("guardian");
    return out;
  }, [extraGroup, goal, codes, profile.identity.guardianEmail, screen]);

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

  // A screen that isn't in the plan (the browser's back button after an answer changed) falls back to the goal question;
  // the detail question without a situation falls back to the situation question.
  useEffect(() => {
    const fallback: Screen | null = !plan.includes(screen) ? "goal" : screen === "detail" && !situation ? "situation" : null;
    if (!fallback) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", fallback);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [plan, screen, situation]);

  // Remembered for finishing: only someone who answered who they are has confirmed it.
  if ((screen === "situation" || screen === "detail") && !sawWho) setSawWho(true);

  /** The screen after `from` in the current plan; finishing when there is none. */
  function next(from: Screen, override?: { plan?: Screen[]; params?: Record<string, string | null> }) {
    const p = override?.plan ?? plan;
    const after = p[p.indexOf(from) + 1];
    if (after) go(after, override?.params ?? {});
    else void finish(override?.params?.goal ?? goalId);
  }

  /* ---------- keep the presets in step with the reading ---------- */

  const refreshProfile = useCallback(async () => {
    try {
      await chain.current; // never overwrite an answer that is still on its way to the server
      const res = await api<{ profile: Profile | null }>(ENDPOINTS[mode].profile, {}, msgs);
      if (!res.profile) return;
      const read = res.profile.roles.filter((r) => r.inferred);
      if (read.length) setFromFiles(read);
      setProfile(res.profile);
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

  /** The person's identities: their main answer, plus the founder/creator detail a goal needed. */
  function saveRoles(next: Role[]) {
    const clean = next.map((r) => ({ ...r, inferred: false }));
    void save({ op: "roles", roles: clean.map((r) => ({ code: r.code, stage: r.stage })) }, { ...profile, roles: clean });
  }

  /** A role answered on a detail screen keeps the stage the files gave for that same code. */
  function roleFor(code: IdentityCode): Role {
    const known = roles.find((r) => r.code === code) ?? fromFiles.find((r) => r.code === code);
    return { code, stage: known?.stage ?? null, since: known?.since ?? null, inferred: false };
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

  const fromFilesTag = tf("fromResume");
  const readingNote = reading ? (
    <p className="flex items-center gap-2.5 px-1 text-[0.95rem] text-ink-3" aria-live="polite">
      <ScoutDot live />
      {tf("reading")}
    </p>
  ) : null;

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

        {screen === "situation" ? (
          <Question title={tf("situation.title")} hint={tf("situation.hint")}>
            {readingNote}
            <Single
              options={USER_GROUPS.map((g) => ({ value: g, label: tf(`situation.${g}`) }))}
              preset={situationPreset}
              presetTag={situationPreset && !roles.some((r) => !r.inferred) ? fromFilesTag : undefined}
              continueLabel={tf("continue")}
              onPick={(g) => next("situation", { params: { g } })}
            />
          </Question>
        ) : null}

        {screen === "detail" && situation ? (
          <Question title={tf(`detail.${situation}`)} hint={tf("detailHint")}>
            {readingNote}
            <Single
              options={identitiesInGroup(situation).map((d) => ({ value: d.code, label: localize(d.label, locale) }))}
              preset={presetIn(situation)?.code ?? null}
              presetTag={presetIn(situation)?.inferred !== false && fromFiles.some((r) => groupOfIdentity(r.code) === situation) ? fromFilesTag : undefined}
              continueLabel={tf("continue")}
              onPick={(code) => {
                // The main identity is this answer; a founder/creator detail stays only if the goal still needs it.
                const keepExtra = roles.slice(1).filter((r) => EXTRA_GROUPS.includes(groupOfIdentity(r.code)) && groupOfIdentity(r.code) !== situation);
                saveRoles([roleFor(code), ...keepExtra]);
                next("detail");
              }}
            />
          </Question>
        ) : null}

        {screen === "goal" ? (
          <GoalScreen
            codes={primary ? [primary.code] : []}
            locale={locale}
            selected={goalId}
            onPick={(g) => {
              // The plan depends on the goal (a founder/creator detail, the two job questions), so it is worked out here.
              const extra = extraGroupFor(g.family, primary?.code);
              if (!extra && roles.length > 1) saveRoles(roles.slice(0, 1));
              const p: Screen[] = ["files", "situation", "detail", "goal", ...(extra ? (["extra"] as Screen[]) : []), ...(isJobGoal(g.sub) ? (["role", "remote"] as Screen[]) : []), "where"];
              if (isMinor(codes) && !profile.identity.guardianEmail) p.push("guardian");
              next("goal", { plan: p, params: { goal: g.id } });
            }}
          />
        ) : null}

        {screen === "extra" && extraGroup ? (
          <Question title={tf(`extra.${extraGroup}`)} hint={tf(`extraHint.${extraGroup}`)}>
            <Single
              options={identitiesInGroup(extraGroup).map((d) => ({ value: d.code, label: localize(d.label, locale) }))}
              preset={presetIn(extraGroup)?.code ?? null}
              presetTag={fromFiles.some((r) => groupOfIdentity(r.code) === extraGroup) && !roles.slice(1).length ? fromFilesTag : undefined}
              continueLabel={tf("continue")}
              onPick={(code) => {
                saveRoles([...(primary ? [primary] : []), roleFor(code)]);
                next("extra");
              }}
            />
          </Question>
        ) : null}

        {screen === "role" ? (
          <RoleScreen
            profile={profile}
            locale={locale}
            fromFilesTag={answered("/packs/jobSeeker/targetOccupations") ? undefined : fromFilesTag}
            onDone={(picks) => {
              if (picks.length) void save({ op: "answer", questionId: "jobSeeker.targetRole", values: picks }, withTargetRoles(profile, picks));
              next("role");
            }}
          />
        ) : null}

        {screen === "remote" ? (
          <Question title={tf("remote.title")} hint={tf("remote.hint")}>
            <Single
              options={(["remote_only", "remote_ok"] as RemotePreference[]).map((v) => ({ value: v, label: tf(v === "remote_only" ? "remote.only" : "remote.either") }))}
              preset={profile.packs.jobSeeker?.remote === "remote_only" ? "remote_only" : profile.packs.jobSeeker?.remote ? "remote_ok" : null}
              presetTag={answered("/packs/jobSeeker/remote") ? undefined : fromFilesTag}
              continueLabel={tf("continue")}
              onPick={(v) => {
                void save({ op: "remote", value: v }, withRemote(profile, v));
                next("remote");
              }}
            />
          </Question>
        ) : null}

        {screen === "where" ? (
          <WhereScreen
            initial={profile.identity.location ?? ""}
            presetTag={profile.identity.location === props.profile.identity.location && !answered("/identity/location") ? fromFilesTag : undefined}
            locale={locale}
            onDone={(loc) => {
              if (loc && loc.location !== profile.identity.location) {
                void save({ op: "location", location: loc.location, city: loc.city, countryCode: loc.countryCode }, { ...profile, identity: { ...profile.identity, location: loc.location, city: loc.city, countryCode: loc.countryCode } });
              } else if (loc) {
                // Confirmed as it was: saved as the person's answer, so a later reading never changes it.
                void save({ op: "location", location: loc.location, city: loc.city, countryCode: loc.countryCode }, profile);
              }
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

function Option({ label, hint, icon, tag, selected, onClick }: { label: string; hint?: string; icon?: ReactNode; tag?: string; selected?: boolean; onClick: () => void }) {
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
      className={cx("pane pane-hover press flex w-full min-w-0 items-center gap-3.5 px-4 py-3.5 text-left sm:px-5 sm:py-4", on && "shadow-[inset_0_0_0_2px_var(--pine)]")}
    >
      {icon ? <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", on ? "bg-pine text-void" : "bg-pine-soft text-pine")}>{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[1.02rem] font-semibold leading-snug text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[0.88rem] leading-snug text-ink-3">{hint}</span> : null}
        {tag ? (
          <span className="mt-1.5 block">
            <Tag tone="pine">{tag}</Tag>
          </span>
        ) : null}
      </span>
      {on ? <Check size={19} className="shrink-0 text-pine" aria-hidden /> : <ChevronRight size={18} className="shrink-0 text-ink-4" aria-hidden />}
    </button>
  );
}

/**
 * One answer out of a list. A tap on any answer moves on; a pre-selected answer (the person's earlier
 * answer, or what their files said, tagged) is confirmed by a tap on it or on Continue.
 */
function Single<V extends string>({
  options,
  preset,
  presetTag,
  continueLabel,
  onPick,
}: {
  options: { value: V; label: string; hint?: string; icon?: ReactNode }[];
  preset: V | null;
  presetTag?: string;
  continueLabel: string;
  onPick: (value: V) => void;
}) {
  const valid = preset && options.some((o) => o.value === preset) ? preset : null;
  return (
    <>
      <Options>
        {options.map((o) => (
          <Option key={o.value} label={o.label} hint={o.hint} icon={o.icon} selected={o.value === valid} tag={o.value === valid ? presetTag : undefined} onClick={() => onPick(o.value)} />
        ))}
      </Options>
      {valid ? (
        <div className="flex justify-end pt-1">
          <Button size="lg" onClick={() => onPick(valid)} iconRight={<ArrowRight size={18} aria-hidden />}>
            {continueLabel}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ screens */

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

function RoleScreen({ profile, locale, fromFilesTag, onDone }: { profile: Profile; locale: "en" | "zh"; fromFilesTag?: string; onDone: (picks: string[]) => void }) {
  const tf = useTranslations("onboarding.flow");
  const suggested = useMemo(() => targetRoleOptions(profile).map((o) => o.value), [profile]);
  // An earlier answer is the preset; otherwise the role the files show the person doing now.
  // A target written in the person's own words ("Head of Growth") seeds the search instead.
  const saved = profile.packs.jobSeeker?.targetOccupations ?? [];
  const savedCodes = saved.filter(isOccupationCode).slice(0, 3);
  const current = profile.occupations.filter(isOccupationCode).slice(0, 1);
  const presetFromFiles = Boolean(fromFilesTag) && (savedCodes.length > 0 || current.length > 0);
  const [picks, setPicks] = useState<string[]>(() => (savedCodes.length ? savedCodes : current));
  const [query, setQuery] = useState(() => saved.find((c) => !isOccupationCode(c)) ?? "");
  const shown = [...new Set([...picks, ...suggested])];
  const results = useMemo(() => (query.trim().length >= 2 ? mapOccupation(query, { limit: 6 }).map((m) => m.code) : []), [query]);
  const fresh = results.filter((c) => !shown.includes(c));

  function toggle(code: string) {
    setPicks((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code].slice(-3)));
  }

  return (
    <Question title={tf("role.title")} hint={tf("role.hint")}>
      {presetFromFiles && picks.length ? (
        <p className="px-1">
          <Tag tone="pine">{fromFilesTag}</Tag>
        </p>
      ) : null}
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

type Place = { location: string; city: string | null; countryCode: string | null };

function WhereScreen({ initial, presetTag, locale, onDone }: { initial: string; presetTag?: string; locale: "en" | "zh"; onDone: (loc: Place | null) => void }) {
  const tf = useTranslations("onboarding.flow");
  const [query, setQuery] = useState("");
  const suggestions = useMemo(() => citySuggestions(query, locale), [query, locale]);
  const typed = query.trim();
  const preset: Place | null = initial ? { location: initial, city: null, countryCode: countryOfLocation(initial) } : null;
  return (
    <Question title={tf("where.title")} hint={tf("where.hint")}>
      {preset ? (
        <Single
          options={[{ value: "preset", label: preset.location, icon: <MapPin size={17} aria-hidden /> }]}
          preset="preset"
          presetTag={presetTag}
          continueLabel={tf("continue")}
          onPick={() => onDone(preset)}
        />
      ) : null}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={preset ? tf("where.other") : tf("where.placeholder")}
        aria-label={preset ? tf("where.other") : tf("where.title")}
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
      {preset ? null : (
        <div className="pt-1">
          <button type="button" className="link text-[0.92rem]" onClick={() => onDone(null)}>
            {tf("skip")}
          </button>
        </div>
      )}
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
