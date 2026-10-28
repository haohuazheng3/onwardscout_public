"use client";

import { ArrowLeft, ArrowRight, Check, ChevronRight, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "@/components/Consent";
import { PaneSkeleton } from "@/components/Skeletons";
import { Button, Input, ScoutDot, Tag, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { FUNCTIONS } from "@/lib/core/functions";
import { IDENTITY_GROUP_DEFS, identitiesInGroup, isMinor } from "@/lib/core/identities";
import { TOP_LEVEL_INDUSTRIES, isIndustryCode, topLevelIndustry } from "@/lib/core/industries";
import { localize } from "@/lib/core/labels";
import { groupOfIdentity, type FunctionId, type IdentityCode, type IdentityGroup, type Profile } from "@/lib/core/types";
import { countryOfLocation } from "@/lib/llm/local/geo";
import { RESEARCH_FIELDS } from "@/lib/profile/gaps";
import type { ProfilePatch } from "@/lib/profile/patch";
import { api, ENDPOINTS, type ApiMode, type DraftStatusView } from "./api";
import { ParseStatus } from "./ParseStatus";
import { citySuggestions } from "./ProfileCard";
import { Uploader } from "./Uploader";
import { useDraftStatus } from "./useDraftStatus";

/*
 * /app/start — questions about the person only, one piece of information per screen:
 *   files → what you do now → one detail of it → your field → where you're based → [under 18: guardian].
 * This part only learns about the person. Nobody is asked what they're "going for": when the last
 * answer is saved the dashboard opens (/app?plan=1) and Onward Scout plans there — it works out the
 * direction(s) from the answers and files, sets them up as goals, starts matching, and says where
 * the person is heading and what happens next (owner decision 2026-10-27). No sign-up or sign-in
 * on the way: a visitor's answers live in an anonymous draft and the dashboard offers to save it,
 * never requires it.
 * The files never answer for the person: what they say only pre-selects an answer ("From your
 * résumé"), which one tap confirms or another tap changes. Answers save at once (queued; a failed
 * save rolls back with a toast). The screen is in the URL (?q=, with ?g= for the situation).
 */

type Screen = "files" | "situation" | "detail" | "field" | "where" | "guardian";

const SCREENS: readonly Screen[] = ["files", "situation", "detail", "field", "where", "guardian"];
/** Earlier links to screens that no longer exist (the goal, role and remote questions) land on the first question. */
const RETIRED: Record<string, Screen> = { who: "situation", kind: "detail", goal: "situation", extra: "situation", role: "situation", remote: "situation", plan: "situation" };
const USER_GROUPS = IDENTITY_GROUP_DEFS.filter((g) => !g.supplySide).map((g) => g.id);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What "your field" means for each kind of person (creators already said what they do one screen earlier). */
type FieldKind = "function" | "industry" | "research" | null;
const FIELD_KIND: Record<IdentityGroup, FieldKind> = { S: "function", E: "function", P: "function", T: "function", F: "industry", R: "research", C: null, I: null };

export interface OnboardingFlowProps {
  mode: ApiMode;
  signedIn: boolean;
  locale: "en" | "zh";
  claim: boolean;
  status: DraftStatusView;
  profile: Profile;
  /** Profile paths the person answered themselves: their values are presets without the "from your résumé" tag. */
  confirmedPaths: string[];
}

type Role = Profile["roles"][number];

/** True once the person has moved between screens: from then on each new question takes the focus. */
const FocusTitle = createContext(false);

/** ?q=<screen>; the old three-step links (?step=2 profile, ?step=3 goals) land on the first question. */
function readScreen(q: string | null, step: string | null): Screen {
  if (SCREENS.includes(q as Screen)) return q as Screen;
  if (q && RETIRED[q]) return RETIRED[q]!;
  return step === "2" || step === "3" ? "situation" : "files";
}

function readGroup(v: string | null): IdentityGroup | null {
  return USER_GROUPS.includes(v as IdentityGroup) ? (v as IdentityGroup) : null;
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
  /** What the files said about the person: presets only, never answers. */
  const [fromFiles, setFromFiles] = useState<Role[]>(() => props.profile.roles.filter((r) => r.inferred));
  const [moved, setMoved] = useState(false);
  const [sawWho, setSawWho] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [claiming, setClaiming] = useState(props.claim && signedIn);
  const lastVersion = useRef(props.status.profile?.version ?? 0);
  const seq = useRef(0);
  /**
   * Saves run one after another: the first one of a signed-out visitor creates the draft cookie, and
   * finishing reads the saved profile, so it waits for the queue to drain.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const failures = useRef(0);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  const docs = status?.documents ?? [];
  const reading = status?.phase === "reading" || status?.phase === "building";
  const roles = profile.roles;
  const codes = roles.map((r) => r.code);
  const primary = roles[0];
  const answered = (path: string) => props.confirmedPaths.includes(path);

  /** The answer to pre-select for a group: the person's own answer first, else what the files said. */
  const presetIn = (group: IdentityGroup): Role | undefined => roles.find((r) => groupOfIdentity(r.code) === group) ?? fromFiles.find((r) => groupOfIdentity(r.code) === group);
  const situationPreset = (primary ?? fromFiles[0]) ? groupOfIdentity((primary ?? fromFiles[0])!.code) : null;
  const situation = readGroup(search.get("g")) ?? situationPreset;
  const fieldKind = situation ? FIELD_KIND[situation] : null;

  /* ---------- the plan: which screens this person sees ---------- */

  const plan = useMemo<Screen[]>(() => {
    const out: Screen[] = ["files", "situation", "detail"];
    if (fieldKind) out.push("field");
    out.push("where");
    if (isMinor(codes) && (!profile.identity.guardianEmail || screen === "guardian")) out.push("guardian");
    return out;
  }, [fieldKind, codes, profile.identity.guardianEmail, screen]);

  const index = Math.max(0, plan.indexOf(screen));

  function go(next: Screen, extra: Record<string, string | null> = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set("q", next);
    url.searchParams.delete("step");
    url.searchParams.delete("claim");
    url.searchParams.delete("goal");
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0 });
    setMoved(true);
  }

  // A screen outside the plan (no field question for a creator, a detail with no situation yet) falls back to the situation.
  useEffect(() => {
    const fallback: Screen | null = (screen === "detail" || screen === "field") && !situation ? "situation" : !plan.includes(screen) ? "situation" : null;
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
    else void finish();
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

  /* ---------- after sign-in from an older link: claim the draft and continue ---------- */

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
          router.replace("/app");
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

  /** A role answered on the detail screen keeps the stage the files gave for that same code. */
  function roleFor(code: IdentityCode): Role {
    const known = roles.find((r) => r.code === code) ?? fromFiles.find((r) => r.code === code);
    return { code, stage: known?.stage ?? null, since: known?.since ?? null, inferred: false };
  }

  /** Answers done: once they are all saved, the dashboard opens and plans from them. */
  async function finish() {
    setFinishing(true);
    await chain.current;
    if (failures.current) {
      // An answer didn't save (the toast said so): stay here so it can be given again.
      failures.current = 0;
      setFinishing(false);
      return;
    }
    if (sawWho) track("profile_confirmed", { signedIn, roles: codes.join(",") });
    router.push("/app?plan=1");
  }

  /* ---------- views ---------- */

  if (claiming || finishing) {
    return (
      <div className="mx-auto grid max-w-[640px] gap-4">
        <section className="pane p-6 sm:p-8" aria-live="polite" aria-busy="true">
          <p className="flex items-center gap-2.5 text-[1.05rem] font-semibold text-ink">
            <ScoutDot live />
            {claiming ? t("claiming") : tf("finishing")}
          </p>
          <p className="mt-1.5 text-[0.95rem] text-ink-3">{claiming ? t("claimingBody") : tf("finishingBody")}</p>
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
                saveRoles([roleFor(code)]);
                const fk = FIELD_KIND[groupOfIdentity(code)];
                next("detail", { plan: ["files", "situation", "detail", ...(fk ? (["field"] as Screen[]) : []), ...plan.filter((s) => s === "where" || s === "guardian")] });
              }}
            />
          </Question>
        ) : null}

        {screen === "field" && fieldKind ? (
          <FieldScreen
            kind={fieldKind}
            group={situation!}
            profile={profile}
            locale={locale}
            fromFilesTag={fromFilesTag}
            answered={answered}
            onPick={(value) => {
              if (fieldKind === "function") void save({ op: "functions", ids: [value as FunctionId] }, { ...profile, functions: [value as FunctionId] });
              else if (fieldKind === "industry") void save({ op: "industries", codes: [value] }, { ...profile, industries: [value] });
              else void save({ op: "answer", questionId: "researcher.field", values: [value] }, profile);
              next("field");
            }}
          />
        ) : null}

        {screen === "where" ? (
          <WhereScreen
            initial={profile.identity.location ?? ""}
            presetTag={profile.identity.location === props.profile.identity.location && !answered("/identity/location") ? fromFilesTag : undefined}
            locale={locale}
            onDone={(loc) => {
              if (loc) {
                const changed = loc.location !== profile.identity.location;
                // Confirmed as it was, or changed: either way it's saved as the person's answer.
                void save(
                  { op: "location", location: loc.location, city: loc.city, countryCode: loc.countryCode },
                  changed ? { ...profile, identity: { ...profile.identity, location: loc.location, city: loc.city, countryCode: loc.countryCode } } : profile,
                );
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
      </div>
    </FocusTitle.Provider>
  );

  function saveRoles(next: Role[]) {
    const clean = next.map((r) => ({ ...r, inferred: false }));
    void save({ op: "roles", roles: clean.map((r) => ({ code: r.code, stage: r.stage })) }, { ...profile, roles: clean });
  }
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
 * answer, or what their files said, tagged) is confirmed by a tap on it or on Continue. Long lists show
 * the first few (the preset among them) and the rest behind "More".
 */
function Single<V extends string>({
  options,
  preset,
  presetTag,
  continueLabel,
  onPick,
  firstCount,
  moreLabel,
}: {
  options: { value: V; label: string; hint?: string; icon?: ReactNode }[];
  preset: V | null;
  presetTag?: string;
  continueLabel: string;
  onPick: (value: V) => void;
  firstCount?: number;
  moreLabel?: (count: number) => string;
}) {
  const valid = preset && options.some((o) => o.value === preset) ? preset : null;
  const [all, setAll] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const ordered = valid ? [options.find((o) => o.value === valid)!, ...options.filter((o) => o.value !== valid)] : options;
  const cut = firstCount && moreLabel && !all && ordered.length > firstCount + 1 ? firstCount : ordered.length;
  const option = (o: (typeof options)[number]) => <Option key={o.value} label={o.label} hint={o.hint} icon={o.icon} selected={o.value === valid} tag={o.value === valid ? presetTag : undefined} onClick={() => onPick(o.value)} />;
  return (
    <>
      <Options>{ordered.slice(0, cut).map(option)}</Options>
      {cut < ordered.length ? (
        <button
          type="button"
          className="link w-fit px-1 text-[0.95rem]"
          aria-expanded={false}
          onClick={() => {
            setAll(true);
            requestAnimationFrame(() => moreRef.current?.querySelector("button")?.focus());
          }}
        >
          {moreLabel!(ordered.length - cut)}
        </button>
      ) : all ? (
        <div ref={moreRef} className="hidden" />
      ) : null}
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

function FieldScreen({
  kind,
  group,
  profile,
  locale,
  fromFilesTag,
  answered,
  onPick,
}: {
  kind: Exclude<FieldKind, null>;
  group: IdentityGroup;
  profile: Profile;
  locale: "en" | "zh";
  fromFilesTag: string;
  answered: (path: string) => boolean;
  onPick: (value: string) => void;
}) {
  const tf = useTranslations("onboarding.flow");
  const { options, preset, path } = useMemo(() => {
    if (kind === "industry") {
      const first = profile.industries.find(isIndustryCode);
      return { options: TOP_LEVEL_INDUSTRIES.map((i) => ({ value: i.code, label: localize(i.label, locale) })), preset: first ? topLevelIndustry(first) : null, path: "/industries" };
    }
    if (kind === "research") {
      const saved = profile.packs.researcher?.fields[0];
      const hit = RESEARCH_FIELDS.find((f) => f.label.en === saved || f.value === saved);
      return { options: RESEARCH_FIELDS.map((f) => ({ value: f.value, label: localize(f.label, locale) })), preset: hit?.value ?? null, path: "/packs/researcher/fields" };
    }
    return { options: FUNCTIONS.map((f) => ({ value: f.id, label: localize(f.label, locale) })), preset: profile.functions[0] ?? null, path: "/functions" };
  }, [kind, profile, locale]);
  const title = kind === "industry" ? tf("field.industry") : kind === "research" ? tf("field.research") : group === "S" ? tf("field.study") : tf("field.work");
  return (
    <Question title={title} hint={tf("field.hint")}>
      <Single
        options={options}
        preset={preset}
        presetTag={answered(path) ? undefined : fromFilesTag}
        continueLabel={tf("continue")}
        firstCount={7}
        moreLabel={(count) => tf("field.more", { count })}
        onPick={onPick}
      />
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
