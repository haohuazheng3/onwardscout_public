/**
 * The eligibility checklist on the detail page: each rule the organiser states, checked against
 * the person's profile, in plain words — ✓ (meets it), ✗ (doesn't, per the profile) or ? (we
 * can't tell: confirm it). Never guesses: a rule we can't check from the profile is "?", and the
 * organiser's free-text note is always "?" ("read it on the official page").
 * Pure (no I/O); the words are in messages/<locale>/scout.json under `eligibility.*`.
 */
import { IDENTITY_GROUP_DEFS, IDENTITIES, audienceIncludes, identityLabel, isIdentityCode } from "@/lib/core/identities";
import { localize, type Locale } from "@/lib/core/labels";
import type { DegreeLevel, Eligibility, IdentityCode, IdentityTarget, OpportunityGeo, Profile } from "@/lib/core/types";
import { professionalYears } from "@/lib/llm/build";
import { countryOfLocation } from "@/lib/llm/local/geo";
import { countryLabel } from "./present";

export type CheckStatus = "yes" | "no" | "unknown";

export interface EligibilityCheck {
  /** Message key under scout.eligibility.<key>.<status>. */
  key:
    | "who"
    | "stage"
    | "degree"
    | "experienceMin"
    | "experienceMax"
    | "nationality"
    | "residency"
    | "age"
    | "students"
    | "companyAge"
    | "location"
    | "language"
    | "notes";
  status: CheckStatus;
  values: Record<string, string | number>;
}

const DEGREE_RANK: Record<DegreeLevel, number> = { none: 0, high_school: 1, vocational: 2, associate: 2, bachelor: 3, master: 4, professional: 5, doctorate: 5 };

const DEGREE_LABELS: Record<DegreeLevel, { en: string; zh: string }> = {
  none: { en: "no degree", zh: "无学历要求" },
  high_school: { en: "a high-school diploma", zh: "高中学历" },
  vocational: { en: "a vocational qualification", zh: "职业教育学历" },
  associate: { en: "an associate degree", zh: "专科学历" },
  bachelor: { en: "a bachelor's degree", zh: "本科学历" },
  master: { en: "a master's degree", zh: "硕士学历" },
  professional: { en: "a professional degree", zh: "专业学位" },
  doctorate: { en: "a doctorate", zh: "博士学位" },
};

function list(items: string[], locale: Locale): string {
  if (!items.length) return "";
  try {
    return new Intl.ListFormat(locale === "zh" ? "zh-CN" : "en", { style: "long", type: "disjunction" }).format(items);
  } catch {
    return items.join(locale === "zh" ? "、" : ", ");
  }
}

function audienceLabel(target: IdentityTarget, locale: Locale): string {
  if (target === "ALL") return locale === "zh" ? "所有人" : "everyone";
  if (target.length === 1) {
    const g = IDENTITY_GROUP_DEFS.find((d) => d.id === target);
    return g ? localize(g.label, locale).toLowerCase() : target;
  }
  return isIdentityCode(target) ? identityLabel(target, locale) : target;
}

function stageLabel(stage: string, locale: Locale): string {
  for (const g of IDENTITY_GROUP_DEFS) {
    const s = g.stages.find((x) => x.id === stage);
    if (s) return localize(s.label, locale).toLowerCase();
  }
  for (const d of IDENTITIES) {
    const s = d.stages?.find((x) => x.id === stage);
    if (s) return localize(s.label, locale).toLowerCase();
  }
  return stage.replace(/[_-]+/g, " ");
}

function yearsSince(partial: string | null, now: Date): number | null {
  if (!partial) return null;
  const [y, m] = partial.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y)) return null;
  const start = Date.UTC(y, Number.isFinite(m) ? m - 1 : 0, 1);
  return (now.getTime() - start) / (365.25 * 86_400_000);
}

/**
 * Checks an opportunity's rules against a profile. Returns only the rules the organiser states
 * (plus location and language when the opportunity lists them). An empty list means "no rules
 * listed": the page then says to check the official page.
 */
export function eligibilityChecklist(
  input: { eligibility: Eligibility | null; geo?: OpportunityGeo | null; languages?: string[] },
  profile: Profile,
  locale: Locale,
  now: Date = new Date(),
): EligibilityCheck[] {
  const el = input.eligibility;
  const out: EligibilityCheck[] = [];
  const codes = profile.roles.map((r) => r.code).filter(isIdentityCode) as IdentityCode[];

  if (el?.identities?.length) {
    const who = list(el.identities.map((t) => audienceLabel(t, locale)), locale);
    const status: CheckStatus = !codes.length ? (el.identities.includes("ALL") ? "yes" : "unknown") : audienceIncludes(el.identities, codes) ? "yes" : "no";
    out.push({ key: "who", status, values: { who } });
  }

  if (el?.stages?.length) {
    const stages = list(el.stages.map((s) => stageLabel(s, locale)), locale);
    const mine = [...profile.roles.map((r) => r.stage), ...(profile.packs.founder?.ventures.map((v) => v.stage) ?? [])].filter((s): s is string => Boolean(s));
    const status: CheckStatus = !mine.length ? "unknown" : mine.some((s) => el.stages.includes(s)) ? "yes" : "no";
    out.push({ key: "stage", status, values: { stages } });
  }

  if (el?.degree && el.degree !== "none") {
    const need = DEGREE_RANK[el.degree];
    const levels = profile.education.map((e) => e.level).filter((l): l is DegreeLevel => Boolean(l));
    const completed = profile.education.filter((e) => !e.current && e.level).map((e) => DEGREE_RANK[e.level as DegreeLevel]);
    const studying = profile.education.some((e) => e.current && e.level && DEGREE_RANK[e.level] >= need);
    const status: CheckStatus = !levels.length ? "unknown" : completed.some((r) => r >= need) ? "yes" : studying ? "unknown" : "no";
    out.push({ key: "degree", status, values: { degree: DEGREE_LABELS[el.degree][locale === "zh" ? "zh" : "en"] } });
  }

  const years = profile.experience.length ? professionalYears(profile, now) : null;
  if (typeof el?.minYears === "number" && el.minYears > 0) {
    const status: CheckStatus = years === null ? "unknown" : years >= el.minYears ? "yes" : years + 1 >= el.minYears ? "unknown" : "no";
    out.push({ key: "experienceMin", status, values: { years: el.minYears, have: years === null ? 0 : Math.floor(years) } });
  }
  if (typeof el?.maxYears === "number") {
    const status: CheckStatus = years === null ? "unknown" : years <= el.maxYears ? "yes" : years <= el.maxYears + 1 ? "unknown" : "no";
    out.push({ key: "experienceMax", status, values: { years: el.maxYears, have: years === null ? 0 : Math.floor(years) } });
  }

  const citizen = profile.identity.workAuthorization.filter((w) => w.status === "citizen" || w.status === "permanent_resident").map((w) => w.countryCode);
  if (el?.nationality?.length) {
    const status: CheckStatus = citizen.some((c) => el.nationality.includes(c)) ? "yes" : citizen.length ? "no" : "unknown";
    out.push({ key: "nationality", status, values: { countries: list(el.nationality.map((c) => countryLabel(c, locale)), locale) } });
  }
  if (el?.residency?.length) {
    const places = [profile.identity.countryCode, ...profile.identity.workAuthorization.map((w) => w.countryCode)].filter((c): c is string => Boolean(c));
    const status: CheckStatus = places.some((c) => el.residency.includes(c)) ? "yes" : "unknown";
    out.push({ key: "residency", status, values: { countries: list(el.residency.map((c) => countryLabel(c, locale)), locale) } });
  }

  if (typeof el?.ageMin === "number" || typeof el?.ageMax === "number") {
    const by = profile.identity.birthYear;
    let status: CheckStatus = "unknown";
    if (by) {
      const age = now.getUTCFullYear() - by;
      const tooYoung = typeof el.ageMin === "number" && age < el.ageMin - 1;
      const tooOld = typeof el.ageMax === "number" && age > el.ageMax + 1;
      const edge = (typeof el.ageMin === "number" && Math.abs(age - el.ageMin) <= 1) || (typeof el.ageMax === "number" && Math.abs(age - el.ageMax) <= 1);
      status = tooYoung || tooOld ? "no" : edge ? "unknown" : "yes";
    }
    const range =
      typeof el.ageMin === "number" && typeof el.ageMax === "number"
        ? `${el.ageMin}–${el.ageMax}`
        : typeof el.ageMax === "number"
          ? locale === "zh"
            ? `${el.ageMax} 岁及以下`
            : `${el.ageMax} or under`
          : locale === "zh"
            ? `${el.ageMin} 岁及以上`
            : `${el.ageMin} or over`;
    out.push({ key: "age", status, values: { range } });
  }

  if (el?.studentsOnly) {
    const student = codes.some((c) => c.startsWith("S")) || profile.education.some((e) => e.current);
    const status: CheckStatus = student ? "yes" : codes.length || profile.education.length ? "no" : "unknown";
    out.push({ key: "students", status, values: {} });
  }

  if (typeof el?.companyMaxAgeYears === "number") {
    const ages = (profile.packs.founder?.ventures ?? []).map((v) => yearsSince(v.founded, now)).filter((a): a is number => a !== null);
    const status: CheckStatus = !ages.length ? "unknown" : ages.some((a) => a <= el.companyMaxAgeYears!) ? "yes" : "no";
    out.push({ key: "companyAge", status, values: { years: el.companyMaxAgeYears } });
  }

  const geo = input.geo;
  if (geo && (geo.remote === "remote" || geo.worldwide)) {
    out.push({ key: "location", status: "yes", values: { place: locale === "zh" ? (geo.worldwide ? "全球" : "远程") : geo.worldwide ? "anywhere in the world" : "remote" } });
  } else if (geo && (geo.countries.length || geo.cities.length)) {
    const place = list([...geo.cities.slice(0, 2), ...geo.countries.slice(0, 3).map((c) => countryLabel(c, locale))], locale);
    const mine = profile.identity.countryCode ?? (profile.identity.location ? countryOfLocation(profile.identity.location) : null);
    const city = profile.identity.city?.toLowerCase() ?? null;
    const status: CheckStatus = (city && geo.cities.some((c) => c.toLowerCase() === city)) || (mine && geo.countries.includes(mine)) ? "yes" : "unknown";
    out.push({ key: "location", status, values: { place } });
  }

  const langs = (input.languages ?? []).map((l) => l.toLowerCase().slice(0, 2)).filter(Boolean);
  if (langs.length) {
    const mine = profile.identity.languages.map((l) => l.code.toLowerCase().slice(0, 2));
    let names = langs;
    try {
      const dn = new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "language" });
      names = langs.map((l) => dn.of(l) ?? l);
    } catch {
      /* keep codes */
    }
    const status: CheckStatus = !mine.length ? "unknown" : langs.some((l) => mine.includes(l)) ? "yes" : "no";
    out.push({ key: "language", status, values: { languages: list([...new Set(names)], locale) } });
  }

  if (el?.notes?.trim()) out.push({ key: "notes", status: "unknown", values: { note: el.notes.trim().slice(0, 400) } });

  return out;
}
