import type { IdentityCode, Profile } from "./types";

/*
 * Does a person fit an opportunity's stage list? Opportunities speak a career vocabulary
 * ("undergraduate", "phd", "early-career", "pre-seed", "series-a"; curated seed data and crawled
 * pages alike), while a profile holds identity codes and per-identity stage ids ("year_3",
 * "actively_looking", "pre_seed"). Both sides are translated into one set of tags, grouped in
 * three domains (education level, career level, venture stage). A stage list is an "or": the person
 * is excluded only when every stage on it is in a domain their profile speaks and none of them fits
 * ("PhD or postdoc" for an undergraduate). A list that reaches into a domain the profile says
 * nothing about ("master's, PhD or early-career" for a mid-level professional) is left to the
 * person to check, never silently filtered out.
 */

export type StageVerdict = "match" | "mismatch" | "unknown";

type Domain = "education" | "career" | "venture";

const DOMAIN_TAGS: Record<Domain, readonly string[]> = {
  education: ["high_school", "undergraduate", "masters", "mba", "phd", "postdoc", "student"],
  career: ["early_career", "mid_career", "senior"],
  venture: ["idea", "pre_seed", "seed", "series_a", "series_b", "growth"],
};

/** Tags an identity code implies on its own. */
const CODE_TAGS: Partial<Record<IdentityCode, string[]>> = {
  S1: ["high_school", "student"],
  S2: ["undergraduate", "student"],
  S3: ["masters", "student"],
  S4: ["phd", "student"],
  S5: ["early_career"],
  S6: ["student"],
  S7: ["student"],
  E1: ["early_career"],
  E2: ["mid_career"],
  E3: ["senior"],
  E4: ["senior"],
  E5: ["senior"],
  R1: ["postdoc", "early_career"],
  R2: ["early_career"],
  R3: ["senior"],
};

/** A founder code's stage when neither the role nor a venture names one. */
const FOUNDER_DEFAULT: Partial<Record<IdentityCode, string[]>> = {
  F1: ["idea"],
  F2: ["pre_seed", "seed"],
  F3: ["series_a", "series_b", "growth"],
};

/** Profile stage ids → tags ("mvp" sits between an idea and a pre-seed round). */
const STAGE_TAGS: Record<string, string[]> = {
  undergraduate: ["undergraduate"],
  masters: ["masters"],
  doctoral: ["phd"],
  early_career: ["early_career"],
  mid_career: ["mid_career"],
  senior: ["senior"],
  idea: ["idea"],
  mvp: ["idea", "pre_seed"],
  pre_seed: ["pre_seed"],
  seed: ["seed"],
  series_a: ["series_a"],
  series_b_plus: ["series_b", "growth"],
  profitable: ["growth"],
};

/** "Pre-seed", "pre seed", "series-b" → "pre_seed", "series_b". */
export function normalizeStage(stage: string): string {
  return stage.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function stageVerdict(opportunityStages: readonly string[], profile: Pick<Profile, "roles" | "packs">): StageVerdict {
  const wanted = opportunityStages.map(normalizeStage).filter(Boolean);
  if (!wanted.length || wanted.includes("any") || wanted.includes("all")) return "match";

  const tags = new Set<string>();
  const add = (list: readonly string[] | undefined) => list?.forEach((t) => tags.add(t));
  const ventureStages: string[] = (profile.packs.founder?.ventures ?? []).flatMap((v) => (v.stage ? [v.stage] : []));
  for (const v of ventureStages) add(STAGE_TAGS[normalizeStage(v)] ?? [normalizeStage(v)]);
  for (const r of profile.roles) {
    add(CODE_TAGS[r.code as IdentityCode]);
    if (r.stage) add(STAGE_TAGS[normalizeStage(r.stage)] ?? [normalizeStage(r.stage)]);
    else if (!ventureStages.length) add(FOUNDER_DEFAULT[r.code as IdentityCode]);
  }

  if (wanted.some((w) => tags.has(w))) return "match";
  // The domains the profile actually speaks, from its level tags ("student" alone says no level).
  const spoken = new Set([...tags].filter((t) => t !== "student").map(domainOf).filter(Boolean));
  return wanted.every((w) => spoken.has(domainOf(w))) ? "mismatch" : "unknown";
}

function domainOf(tag: string): Domain | undefined {
  return (Object.keys(DOMAIN_TAGS) as Domain[]).find((d) => DOMAIN_TAGS[d].includes(tag));
}
