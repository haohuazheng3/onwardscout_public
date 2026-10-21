/**
 * Candidate prefilter inputs (plan §10.4 steps 1–2): which identity targets, places and words
 * describe a person, so one SQL query can pull the ≤ 600 most plausible open opportunities
 * before the intelligence layer scores them. Pure; tested in tests/matching-ranking.test.ts.
 */
import { groupsOf, isIdentityCode } from "@/lib/core/identities";
import type { GoalConstraints, IdentityCode, Profile } from "@/lib/core/types";

/** Audience values an opportunity may list that include this person ("ALL", their groups, their codes). Empty = unknown. */
export function identityTargets(profile: Pick<Profile, "roles">): string[] {
  const codes = profile.roles.map((r) => r.code).filter(isIdentityCode) as IdentityCode[];
  if (!codes.length) return [];
  return ["ALL", ...groupsOf(codes), ...new Set(codes)];
}

/** Country code from a goal geo entry: "US", "us", "Berlin, DE" → "DE"; anything else → null. */
export function countryFromGeo(entry: string): string | null {
  const s = entry.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const last = /,\s*([A-Za-z]{2})$/.exec(s)?.[1];
  return last ? last.toUpperCase() : null;
}

export interface GeoConstraint {
  /** Every goal asks for remote only: drop on-site and hybrid roles. */
  remoteOnly: boolean;
  /** Accepted countries; null = anywhere (no goal limits places, or one goal accepts anywhere). */
  countries: string[] | null;
}

export function geoConstraint(goals: { constraints?: Partial<GoalConstraints> | null }[]): GeoConstraint {
  if (!goals.length) return { remoteOnly: false, countries: null };
  const remoteOnly = goals.every((g) => g.constraints?.remote === "remote_only");
  const out = new Set<string>();
  for (const g of goals) {
    const geo = g.constraints?.geo ?? [];
    const codes = geo.map(countryFromGeo).filter((c): c is string => Boolean(c));
    if (!codes.length) return { remoteOnly, countries: null };
    codes.forEach((c) => out.add(c));
  }
  return { remoteOnly, countries: [...out] };
}

const STOP = new Set(["and", "or", "the", "of", "for", "with", "in", "at", "to", "a", "an", "&"]);

/**
 * Words that describe what the person does (skills, recent titles, target roles, research
 * fields, headline), at most `max`, longest-signal first. Used to order candidates by text
 * relevance before scoring, never to exclude anyone.
 */
export function profileTerms(profile: Profile, max = 16): string[] {
  const raw: string[] = [
    ...(profile.packs.jobSeeker?.targetOccupations ?? []),
    ...profile.experience.slice(0, 3).map((e) => e.title),
    ...(profile.packs.researcher?.fields ?? []),
    ...profile.skills.slice(0, 12).map((s) => s.name),
    ...(profile.identity.headline ? [profile.identity.headline] : []),
  ];
  const out: string[] = [];
  for (const item of raw) {
    const clean = String(item ?? "")
      .replace(/["'()|&!:<>*\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (clean.length < 2 || clean.length > 60 || STOP.has(clean)) continue;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/** A websearch_to_tsquery string that matches any of the terms (multi-word terms as phrases). */
export function anyOfQuery(terms: string[]): string | null {
  const parts = terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).filter(Boolean);
  return parts.length ? parts.join(" OR ") : null;
}
