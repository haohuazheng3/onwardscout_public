"use client";

import { MapPin, Search, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Chip, Input, Select, Skeleton, Tag, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { FUNCTIONS, functionLabel } from "@/lib/core/functions";
import { IDENTITY_GROUP_DEFS, identitiesInGroup, identityLabel, stagesFor } from "@/lib/core/identities";
import { TOP_LEVEL_INDUSTRIES, industryLabel, isIndustryCode } from "@/lib/core/industries";
import { localize } from "@/lib/core/labels";
import { mapOccupation, occupationLabel, isOccupationCode } from "@/lib/core/occupations";
import type { FunctionId, IdentityCode, IdentityGroup, Profile, RemotePreference, WorkAuthStatus } from "@/lib/core/types";
import { CITIES, COUNTRIES, countryName, countryOfLocation } from "@/lib/llm/local/geo";
import type { GapQuestion } from "@/lib/profile/gaps";
import type { ProfilePatch } from "@/lib/profile/patch";
import { api, ENDPOINTS, type ApiMode } from "./api";
import { GapQuestions } from "./GapQuestions";

/*
 * Step 2, "Is this you?": a profile card of tappable chips. Every tap changes the card at
 * once, saves in the background (PATCH), and rolls back with a toast if the save fails.
 * Identities come pre-selected from the documents with the reason we think so.
 */

export interface RoleHint {
  why: string;
  confidence: number;
}

export interface PatchResponse {
  version: number;
  status: string;
  completeness: number;
  gaps: GapQuestion[];
}

const USER_GROUPS = IDENTITY_GROUP_DEFS.filter((g) => !g.supplySide);
const AUTH_STATUSES: WorkAuthStatus[] = ["citizen", "permanent_resident", "work_visa", "student_visa", "needs_sponsorship"];
const REMOTE: RemotePreference[] = ["remote_only", "remote_ok", "onsite_only"];

function cityLabel(city: string): string {
  if (/[一-鿿]/.test(city)) return city;
  return city.replace(/(^|[\s-])([a-zà-ÿ])/g, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

export function citySuggestions(query: string, locale: "en" | "zh", limit = 5): { location: string; city: string; countryCode: string }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: { location: string; city: string; countryCode: string }[] = [];
  for (const [name, cc] of Object.entries(CITIES)) {
    if (name.length <= 3 && !/[一-鿿]/.test(name)) continue; // "sf", "la", "nyc"
    if (!name.startsWith(q)) continue;
    const city = cityLabel(name);
    out.push({ location: `${city}${locale === "zh" ? "，" : ", "}${countryName(cc, locale)}`, city, countryCode: cc });
    if (out.length >= limit) break;
  }
  return out;
}

export function ProfileCard({
  mode,
  locale,
  profile: initial,
  roleHints,
  gaps: initialGaps,
  building,
  onChange,
}: {
  mode: ApiMode;
  locale: "en" | "zh";
  profile: Profile;
  roleHints: Record<string, RoleHint>;
  gaps: GapQuestion[];
  building: boolean;
  onChange?: (p: Profile, res?: PatchResponse) => void;
}) {
  const t = useTranslations("onboarding.card");
  const tc = useTranslations("common");
  const [profile, setProfile] = useState<Profile>(initial);
  const [gaps, setGaps] = useState<GapQuestion[]>(initialGaps);
  const [openGroup, setOpenGroup] = useState<IdentityGroup | null>(null);
  const [showAllIndustries, setShowAllIndustries] = useState(false);
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  const [occQuery, setOccQuery] = useState("");
  const [locQuery, setLocQuery] = useState("");
  const [locEditing, setLocEditing] = useState(!initial.identity.location);
  const seq = useRef(0);

  // A fresher profile from the server (extraction finished) replaces the card's copy.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setProfile(initial);
    setLocEditing(!initial.identity.location);
  }
  const [seenGaps, setSeenGaps] = useState(initialGaps);
  if (initialGaps !== seenGaps) {
    setSeenGaps(initialGaps);
    setGaps(initialGaps);
  }

  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  /** Optimistic save: apply locally now, PATCH, roll back this change on failure. */
  async function save(patch: ProfilePatch, next: Profile): Promise<PatchResponse | null> {
    const before = profile;
    const mine = ++seq.current;
    setProfile(next);
    onChange?.(next);
    try {
      const res = await api<PatchResponse>(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch, locale } }, msgs);
      if (mine === seq.current) setGaps(res.gaps);
      onChange?.(next, res);
      return res;
    } catch (err) {
      if (mine === seq.current) {
        setProfile(before);
        onChange?.(before);
      }
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
      return null;
    }
  }

  /* ---------- identities ---------- */

  const selectedCodes = profile.roles.map((r) => r.code);
  function setRoles(roles: Profile["roles"]) {
    void save({ op: "roles", roles: roles.map((r) => ({ code: r.code, stage: r.stage })) }, { ...profile, roles });
  }
  function toggleRole(code: IdentityCode) {
    if (selectedCodes.includes(code)) setRoles(profile.roles.filter((r) => r.code !== code));
    else setRoles([...profile.roles.map((r) => ({ ...r, inferred: false })), { code, stage: null, since: null, inferred: false }]);
  }
  function setStage(code: IdentityCode, stage: string) {
    setRoles(profile.roles.map((r) => (r.code === code ? { ...r, stage: r.stage === stage ? null : stage, inferred: false } : { ...r, inferred: false })));
  }

  /* ---------- field ---------- */

  const industries = profile.industries;
  const industryChoices = useMemo(() => {
    const top = TOP_LEVEL_INDUSTRIES.map((i) => i.code).filter((c) => !industries.includes(c));
    return showAllIndustries ? top : top.slice(0, 6);
  }, [industries, showAllIndustries]);
  function toggleIndustry(code: string) {
    const codes = industries.includes(code) ? industries.filter((c) => c !== code) : [...industries, code].slice(-8);
    void save({ op: "industries", codes }, { ...profile, industries: codes });
  }
  const functions = profile.functions;
  const functionChoices = useMemo(() => {
    const rest = FUNCTIONS.map((f) => f.id).filter((id) => !functions.includes(id));
    return showAllFunctions ? rest : rest.slice(0, 8);
  }, [functions, showAllFunctions]);
  function toggleFunction(id: FunctionId) {
    const ids = functions.includes(id) ? functions.filter((f) => f !== id) : [...functions, id].slice(-6);
    void save({ op: "functions", ids }, { ...profile, functions: ids });
  }
  const occupations = profile.occupations.filter(isOccupationCode);
  const occResults = useMemo(() => (occQuery.trim().length >= 2 ? mapOccupation(occQuery, { limit: 6, minScore: 0.3 }).map((m) => m.code).filter((c) => !occupations.includes(c)) : []), [occQuery, occupations]);
  function toggleOccupation(code: string) {
    const codes = occupations.includes(code) ? occupations.filter((c) => c !== code) : [...occupations, code].slice(-5);
    setOccQuery("");
    void save({ op: "occupations", codes }, { ...profile, occupations: codes });
  }

  /* ---------- where ---------- */

  const detectedCountry = profile.identity.countryCode ?? (profile.identity.location ? countryOfLocation(profile.identity.location) : null);
  const suggestions = citySuggestions(locQuery, locale);
  function setLocation(location: string, city: string | null, countryCode: string | null) {
    setLocEditing(false);
    setLocQuery("");
    void save({ op: "location", location, city, countryCode }, { ...profile, identity: { ...profile.identity, location, city, countryCode } });
  }
  const remote = profile.packs.jobSeeker?.remote ?? null;
  function setRemote(value: RemotePreference) {
    const jobSeeker = profile.packs.jobSeeker ?? { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null };
    void save({ op: "remote", value }, { ...profile, packs: { ...profile.packs, jobSeeker: { ...jobSeeker, remote: value } } });
  }
  const [authCountry, setAuthCountry] = useState<string>(detectedCountry ?? profile.identity.workAuthorization[0]?.countryCode ?? "US");
  const authStatus = profile.identity.workAuthorization.find((w) => w.countryCode === authCountry)?.status ?? null;
  function setAuth(status: WorkAuthStatus) {
    const others = profile.identity.workAuthorization.filter((w) => w.countryCode !== authCountry);
    const items = authStatus === status ? others : [...others, { countryCode: authCountry, status, note: null }];
    void save({ op: "workAuthorization", items: items.map((i) => ({ countryCode: i.countryCode, status: i.status })) }, { ...profile, identity: { ...profile.identity, workAuthorization: items } });
  }

  async function answer(q: GapQuestion, values: string[]) {
    const res = await api<PatchResponse>(ENDPOINTS[mode].profile, { method: "PATCH", json: { patch: { op: "answer", questionId: q.id, values }, locale } }, msgs);
    setGaps(res.gaps);
    onChange?.(profile, res);
    return res.gaps;
  }

  const countries = useMemo(() => COUNTRIES.map((c) => ({ code: c.code, name: countryName(c.code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale === "zh" ? "zh-CN" : "en")), [locale]);

  return (
    <div className="grid gap-4">
      {/* ---------------- identities ---------------- */}
      <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="card-who">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{t("whoEyebrow")}</p>
            <h2 id="card-who" className="title mt-1.5 text-[1.3rem] text-ink">
              {profile.identity.name ? t("whoTitleNamed", { name: profile.identity.name }) : t("whoTitle")}
            </h2>
            {profile.identity.headline ? <p className="mt-1 truncate text-[0.95rem] text-ink-3">{profile.identity.headline}</p> : null}
          </div>
          {building ? (
            <Tag tone="pine" dot>
              {t("building")}
            </Tag>
          ) : null}
        </div>

        <ul className="mt-5 grid gap-3">
          {profile.roles.map((r) => {
            const hint = roleHints[r.code];
            return (
              <li key={r.code} className="pane-inset min-w-0 p-3.5 sm:p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Chip selected onClick={() => toggleRole(r.code)} aria-label={t("removeRole", { role: identityLabel(r.code, locale) })} icon={<X size={14} aria-hidden />}>
                    {identityLabel(r.code, locale)}
                  </Chip>
                  {r.inferred ? (
                    <Tag tone="accent">
                      <Sparkles size={12} aria-hidden />
                      {t("suggested")}
                    </Tag>
                  ) : null}
                </div>
                {hint && r.inferred ? <p className="mt-2 text-[0.85rem] leading-snug text-ink-3">{t("why", { why: hint.why })}</p> : null}
                <div className="scroll-row mt-3 -mx-1 px-1" role="group" aria-label={t("stageFor", { role: identityLabel(r.code, locale) })}>
                  {stagesFor(r.code).map((s) => (
                    <Chip key={s.id} size="sm" selected={r.stage === s.id} onClick={() => setStage(r.code, s.id)}>
                      {localize(s.label, locale)}
                    </Chip>
                  ))}
                </div>
              </li>
            );
          })}
          {!profile.roles.length ? (
            building ? (
              <li aria-hidden="true" className="flex gap-2">
                <Skeleton className="block h-10 rounded-full" width={150} />
                <Skeleton className="block h-10 rounded-full" width={110} />
              </li>
            ) : (
              <li className="text-[0.95rem] text-ink-3">{t("noRoles")}</li>
            )
          ) : null}
        </ul>

        <div className="mt-5">
          <p className="text-[0.9rem] font-medium text-ink-2">{profile.roles.length ? t("addAnother") : t("pickGroup")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {USER_GROUPS.map((g) => (
              <Chip key={g.id} size="sm" selected={openGroup === g.id} onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)} aria-expanded={openGroup === g.id}>
                {localize(g.label, locale)}
              </Chip>
            ))}
          </div>
          {openGroup ? (
            <div className="mt-3 flex flex-wrap gap-2 animate-pop">
              {identitiesInGroup(openGroup).map((d) => (
                <Chip key={d.code} selected={selectedCodes.includes(d.code)} onClick={() => toggleRole(d.code)}>
                  {localize(d.label, locale)}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------- field ---------------- */}
      <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="card-field">
        <p className="eyebrow">{t("fieldEyebrow")}</p>
        <h2 id="card-field" className="title mt-1.5 text-[1.3rem] text-ink">
          {t("fieldTitle")}
        </h2>

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">{t("industries")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {industries.filter(isIndustryCode).map((c) => (
            <Chip key={c} selected onClick={() => toggleIndustry(c)}>
              {industryLabel(c, locale)}
            </Chip>
          ))}
          {industryChoices.map((c) => (
            <Chip key={c} onClick={() => toggleIndustry(c)}>
              {industryLabel(c, locale)}
            </Chip>
          ))}
          <button type="button" className="link px-1 text-[0.88rem]" onClick={() => setShowAllIndustries((v) => !v)}>
            {showAllIndustries ? tc("buttons.showLess") : tc("buttons.showMore")}
          </button>
        </div>

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">{t("functions")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {functions.map((id) => (
            <Chip key={id} selected onClick={() => toggleFunction(id)}>
              {functionLabel(id, locale)}
            </Chip>
          ))}
          {functionChoices.map((id) => (
            <Chip key={id} onClick={() => toggleFunction(id)}>
              {functionLabel(id, locale)}
            </Chip>
          ))}
          <button type="button" className="link px-1 text-[0.88rem]" onClick={() => setShowAllFunctions((v) => !v)}>
            {showAllFunctions ? tc("buttons.showLess") : tc("buttons.showMore")}
          </button>
        </div>

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">
          <label htmlFor="occ-search">{t("occupation")}</label>
        </h3>
        {occupations.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {occupations.map((c) => (
              <Chip key={c} selected onClick={() => toggleOccupation(c)} icon={<X size={14} aria-hidden />} aria-label={t("removeOccupation", { name: occupationLabel(c, locale) })}>
                {occupationLabel(c, locale)}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="relative mt-2">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
          <Input id="occ-search" value={occQuery} onChange={(e) => setOccQuery(e.target.value)} placeholder={t("occupationPlaceholder")} className="pl-11" autoComplete="off" />
        </div>
        {occResults.length ? (
          <div className="mt-2 flex flex-wrap gap-2 animate-pop" role="group" aria-label={t("occupationResults")}>
            {occResults.map((c) => (
              <Chip key={c} onClick={() => toggleOccupation(c)}>
                {occupationLabel(c, locale)}
              </Chip>
            ))}
          </div>
        ) : occQuery.trim().length >= 2 ? (
          <p className="mt-2 text-[0.86rem] text-ink-4">{t("occupationNone")}</p>
        ) : null}
      </section>

      {/* ---------------- where ---------------- */}
      <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="card-where">
        <p className="eyebrow">{t("whereEyebrow")}</p>
        <h2 id="card-where" className="title mt-1.5 text-[1.3rem] text-ink">
          {t("whereTitle")}
        </h2>

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">
          <label htmlFor="loc-input">{t("location")}</label>
        </h3>
        {profile.identity.location && !locEditing ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip selected icon={<MapPin size={14} aria-hidden />} onClick={() => setLocEditing(true)}>
              {profile.identity.location}
            </Chip>
            <button type="button" className="link px-1 text-[0.88rem]" onClick={() => setLocEditing(true)}>
              {t("change")}
            </button>
          </div>
        ) : (
          <>
            <Input
              id="loc-input"
              className="mt-2"
              value={locQuery}
              onChange={(e) => setLocQuery(e.target.value)}
              placeholder={t("locationPlaceholder")}
              autoComplete="address-level2"
              onKeyDown={(e) => {
                if (e.key === "Enter" && locQuery.trim()) {
                  e.preventDefault();
                  setLocation(locQuery.trim(), null, countryOfLocation(locQuery));
                }
              }}
            />
            {locQuery.trim().length >= 2 ? (
              <div className="mt-2 flex flex-wrap gap-2 animate-pop">
                {suggestions.map((s) => (
                  <Chip key={s.location} onClick={() => setLocation(s.location, s.city, s.countryCode)} icon={<MapPin size={14} aria-hidden />}>
                    {s.location}
                  </Chip>
                ))}
                <Chip onClick={() => setLocation(locQuery.trim(), null, countryOfLocation(locQuery))}>{t("useTyped", { text: locQuery.trim() })}</Chip>
              </div>
            ) : null}
          </>
        )}

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">{t("remote")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {REMOTE.map((r) => (
            <Chip key={r} selected={remote === r} onClick={() => setRemote(r)}>
              {t(`remoteOptions.${r}`)}
            </Chip>
          ))}
        </div>

        <h3 className="mt-5 text-[0.9rem] font-medium text-ink-2">
          <label htmlFor="auth-country">{t("workAuth")}</label>
        </h3>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select id="auth-country" value={authCountry} onChange={(e) => setAuthCountry(e.target.value)} className="sm:max-w-[260px]">
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className={cx("mt-2 flex flex-wrap gap-2")}>
          {AUTH_STATUSES.map((s) => (
            <Chip key={s} size="sm" selected={authStatus === s} onClick={() => setAuth(s)}>
              {t(`authOptions.${s}`)}
            </Chip>
          ))}
        </div>
      </section>

      <GapQuestions questions={gaps} locale={locale} onAnswer={answer} />
    </div>
  );
}
