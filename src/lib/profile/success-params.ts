import { getSubGoal, subGoalAppliesTo, subGoalsOf } from "@/lib/core/goals";
import { groupOfIdentity } from "@/lib/core/types";
import { defaultGoalsFor } from "@/lib/core/matrix";
import { isOccupationCode, occupationLabel } from "@/lib/core/occupations";
import { renderSuccessDefinitions, type RenderedSuccess, type SuccessParams } from "@/lib/core/success";
import type { GoalFamily, IdentityCode, IdentityGroup, Profile, SubGoalId } from "@/lib/core/types";

/*
 * Step 3 helpers (pure, isomorphic, tested): which goal families and sub-goals to pre-select
 * for a person, and the success-definition placeholders we can fill honestly from their
 * profile (anything we don't know stays neutral wording, never a guess).
 */

/** The family each identity group most often comes for (each is "primary" in the matrix). */
const LEAD_FAMILY: Record<Exclude<IdentityGroup, "I">, GoalFamily> = { S: "G1", E: "G1", F: "G3", R: "G4", C: "G6", P: "G1", T: "G1" };

/** Families to pre-select: the lead family of the person's strongest identities (at most two). */
export function leadFamilies(codes: readonly IdentityCode[], max = 2): GoalFamily[] {
  const out: GoalFamily[] = [];
  const primary = defaultGoalsFor(codes).primary;
  for (const code of codes) {
    const group = groupOfIdentity(code);
    if (group === "I") continue;
    const fam = LEAD_FAMILY[group];
    if (!out.includes(fam) && primary.includes(fam)) out.push(fam);
    if (out.length >= max) break;
  }
  return out;
}

/** Sub-goals of a family the person can pursue (all of them when none fit their identities). */
export function applicableSubGoals(family: GoalFamily, codes: readonly IdentityCode[]) {
  const all = subGoalsOf(family);
  const fit = all.filter((s) => subGoalAppliesTo(s.id, codes));
  return fit.length ? fit : all;
}

/**
 * The sub-goal to pre-select in a family: the first one aimed at the person (their code or
 * group), else the first open to everyone; founders raising (F2/F3) start with fundraising,
 * other founders with programs (accelerators, incubators).
 */
export function defaultSubGoal(family: GoalFamily, codes: readonly IdentityCode[]): SubGoalId {
  const subs = applicableSubGoals(family, codes);
  if (family === "G3") {
    if (codes.some((c) => c === "F2" || c === "F3") && subs.some((s) => s.id === "G3.2")) return "G3.2";
    if (subs.some((s) => s.id === "G3.4")) return "G3.4";
  }
  const groups = new Set(codes.map(groupOfIdentity));
  const score = (id: SubGoalId) => {
    const aud = getSubGoal(id).audience;
    if (aud.some((a) => codes.includes(a as IdentityCode) || (a.length === 1 && groups.has(a as IdentityGroup)))) return 2;
    return aud.includes("ALL") ? 1 : 0;
  };
  return [...subs].sort((a, b) => score(b.id) - score(a.id) || subs.indexOf(a) - subs.indexOf(b))[0]!.id;
}

const DEGREE: Record<string, { en: string; zh: string }> = {
  bachelor: { en: "bachelor's", zh: "本科" },
  master: { en: "master's", zh: "硕士" },
  doctorate: { en: "PhD", zh: "博士" },
  professional: { en: "professional degree", zh: "专业学位" },
};

/** Placeholders we know from the profile. Unknown ones are left out (neutral wording). */
export function successParams(profile: Profile, locale: "en" | "zh"): SuccessParams {
  const p: SuccessParams = {};
  const j = profile.packs.jobSeeker;
  const target = j?.targetOccupations.find(isOccupationCode);
  const occ = profile.occupations.find(isOccupationCode);
  if (target) p.role = occupationLabel(target, locale);
  else if (occ) p.role = occupationLabel(occ, locale);
  const venture = profile.packs.founder?.ventures[0];
  if (j?.salaryMin) {
    p.salary = j.salaryMin;
    if (j.currency) p.currency = j.currency;
  }
  if (venture?.currentRound?.amount) {
    p.amount = venture.currentRound.amount;
    if (!p.currency && venture.currentRound.currency) p.currency = venture.currentRound.currency;
  }
  const rates = profile.packs.creator?.rates;
  if (rates?.min) {
    p.rate = rates.min;
    if (!p.currency && rates.currency) p.currency = rates.currency;
  }
  const field = profile.packs.researcher?.fields[0] ?? profile.packs.student?.targetFields[0];
  if (field) p.field = field;
  const degree = profile.packs.student?.targetDegree;
  if (degree && DEGREE[degree]) p.degree = DEGREE[degree][locale];
  if (profile.identity.city) p.city = profile.identity.city;
  return p;
}

/** Snaps a template's horizon to the choices the UI offers (3, 6, 12 months). */
export function snapHorizon(months: number): 3 | 6 | 12 {
  return months <= 4 ? 3 : months <= 8 ? 6 : 12;
}

/** The three candidate success definitions for a sub-goal and horizon. */
export function successOptions(sub: SubGoalId, profile: Profile, horizon: number, locale: "en" | "zh"): RenderedSuccess[] {
  return renderSuccessDefinitions(sub, { ...successParams(profile, locale), months: horizon }, locale);
}

/**
 * A success definition with its deadline moved to a new horizon ("within 6 months" →
 * "within 12 months", "6 个月内" → "12 个月内"). Text without a month deadline is unchanged.
 */
export function retimeDefinition(text: string, months: number): string {
  return text
    .replace(/\bwithin \d{1,2} months?\b/gi, `within ${months} ${months === 1 ? "month" : "months"}`)
    .replace(/\d{1,2}\s?个月内/g, `${months} 个月内`);
}
