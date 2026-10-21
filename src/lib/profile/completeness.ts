import { groupOfIdentity, type IdentityGroup, type PackKey, type Profile } from "@/lib/core/types";

/*
 * How complete a profile is, 0–100 — pure, tested (tests/profile-completeness.test.ts).
 * It measures what the scout can work with (contact, focus, background, evidence and the
 * identity pack that matters for the person), not how impressive anyone is. The breakdown
 * lets the UI say what would help most next.
 */

export type CompletenessKey =
  | "name"
  | "contact"
  | "location"
  | "headline"
  | "roles"
  | "focus"
  | "experience"
  | "education"
  | "skills"
  | "evidence"
  | "links"
  | "languages"
  | "workAuthorization"
  | "pack";

export interface CompletenessPart {
  key: CompletenessKey;
  weight: number;
  /** 0–1 */
  score: number;
}

export const COMPLETENESS_WEIGHTS: Readonly<Record<CompletenessKey, number>> = {
  name: 6,
  contact: 5,
  location: 5,
  headline: 4,
  roles: 10,
  focus: 10,
  experience: 12,
  education: 10,
  skills: 8,
  evidence: 10,
  links: 6,
  languages: 3,
  workAuthorization: 3,
  pack: 8,
};

/** Which identity pack matters for which identity group. */
export const PACK_FOR_GROUP: Readonly<Partial<Record<IdentityGroup, PackKey>>> = {
  S: "student",
  E: "jobSeeker",
  T: "jobSeeker",
  F: "founder",
  R: "researcher",
  C: "creator",
  P: "professional",
};

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(filled);
  return true;
};

const ratio = (n: number, full: number) => Math.max(0, Math.min(1, full > 0 ? n / full : 0));

/** Share (0–1) of a pack's key fields that are known. */
export function packFill(profile: Profile, pack: PackKey): number {
  const p = profile.packs;
  switch (pack) {
    case "jobSeeker": {
      const j = p.jobSeeker;
      if (!j) return 0;
      return ratio([j.targetOccupations.length || j.targetFunctions.length, j.locations.length || j.remote, j.salaryMin ?? j.salaryMax, j.availableFrom].filter(filled).length, 4);
    }
    case "founder": {
      const v = p.founder?.ventures[0];
      if (!v) return 0;
      return ratio([v.oneLiner ?? v.product, v.stage, v.teamSize, v.traction, v.currentRound ?? (v.fundingHistory.length ? v.fundingHistory : null)].filter(filled).length, 5);
    }
    case "researcher": {
      const r = p.researcher;
      if (!r) return profile.publications.length ? 0.25 : 0;
      return ratio([r.fields, r.targetTier ?? (r.targetVenues.length ? r.targetVenues : null), r.orcid ?? r.scholarUrl, profile.publications].filter(filled).length, 4);
    }
    case "student": {
      const s = p.student;
      const current = profile.education.find((e) => e.current);
      return ratio([s?.graduationDate ?? current?.endDate, s?.targetDegree, s?.targetFields, s?.gpa ?? (s?.testScores.length ? s.testScores : null)].filter(filled).length, 4);
    }
    case "creator": {
      const c = p.creator;
      if (!c) return 0;
      return ratio([c.disciplines.length ? c.disciplines : c.styles, c.rates, c.audienceMetrics, c.portfolioUrls.length ? c.portfolioUrls : c.brandsWorkedWith].filter(filled).length, 4);
    }
    case "professional": {
      const pr = p.professional;
      if (!pr) return profile.certifications.length ? 0.25 : 0;
      return ratio([pr.licenses, pr.practiceLocation, pr.yearsInPractice, pr.specialties].filter(filled).length, 4);
    }
  }
}

/** Packs relevant to the person's identities (in role order, without repeats). */
export function relevantPacks(profile: Profile): PackKey[] {
  const out: PackKey[] = [];
  for (const r of profile.roles) {
    const pack = PACK_FOR_GROUP[groupOfIdentity(r.code)];
    if (pack && !out.includes(pack)) out.push(pack);
  }
  return out;
}

export function completenessBreakdown(profile: Profile): CompletenessPart[] {
  const id = profile.identity;
  const evidence = profile.projects.length + profile.achievements.length + profile.publications.length + profile.certifications.length;
  const packs = relevantPacks(profile);
  const packScore = packs.length ? packs.reduce((s, k) => s + packFill(profile, k), 0) / packs.length : 0;
  const scores: Record<CompletenessKey, number> = {
    name: filled(id.name) ? 1 : 0,
    contact: filled(id.email) ? 1 : filled(id.phone) ? 0.6 : 0,
    location: filled(id.location) || filled(id.countryCode) ? 1 : 0,
    headline: filled(id.headline) || filled(profile.summary) ? 1 : 0,
    roles: profile.roles.length ? (profile.roles.some((r) => !r.inferred) ? 1 : 0.8) : 0,
    focus: ratio([profile.functions, profile.industries, profile.occupations].filter(filled).length, 3),
    experience: profile.experience.length >= 2 ? 1 : profile.experience.length === 1 ? 0.7 : (profile.packs.founder?.ventures.length ?? 0) > 0 ? 0.7 : 0,
    education: profile.education.length ? 1 : 0,
    skills: ratio(profile.skills.length, 5),
    evidence: ratio(evidence, 3),
    links: profile.identity.links.length ? 1 : 0,
    languages: id.languages.length ? 1 : 0,
    workAuthorization: id.workAuthorization.length ? 1 : 0,
    pack: packScore,
  };
  return (Object.keys(COMPLETENESS_WEIGHTS) as CompletenessKey[]).map((key) => ({ key, weight: COMPLETENESS_WEIGHTS[key], score: scores[key] }));
}

/** 0–100, rounded. */
export function completenessScore(profile: Profile): number {
  const parts = completenessBreakdown(profile);
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const got = parts.reduce((s, p) => s + p.weight * p.score, 0);
  return Math.round((got / total) * 100);
}

/** The parts that would add the most, biggest first (for "what would help next"). */
export function completenessNext(profile: Profile, limit = 3): CompletenessKey[] {
  return completenessBreakdown(profile)
    .map((p) => ({ key: p.key, gain: p.weight * (1 - p.score) }))
    .filter((p) => p.gain > 0.5)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit)
    .map((p) => p.key);
}
