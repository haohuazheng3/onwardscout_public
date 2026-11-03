import type { DegreeLevel, IdentityCode, Profile } from "@/lib/core/types";

/*
 * Onboarding presets read from what the files said (pure, isomorphic, tested). A preset is never
 * an answer: it only pre-selects one ("From your résumé"), which the person confirms or changes.
 */

type Education = Profile["education"][number];

/** Degree abbreviations the level was not read from (a B.E. or B.Tech is a bachelor's degree). */
const DEGREE_TEXT: Array<[RegExp, DegreeLevel]> = [
  [/\b(ph\.?\s?d|d\.?phil|doctor of philosophy|doctorate)\b|博士/i, "doctorate"],
  [/\b(m\.?sc|m\.?s\b|m\.?a\b|m\.?eng|m\.e\b|m\.?tech|mca|m\.?com|mba|master)|硕士|研究生/i, "master"],
  [/\b(b\.?sc|b\.?s\b|b\.?a\b|b\.?eng|b\.e\b|b\.?tech|bca|b\.?com|bba|bfa|llb|bachelor|undergraduate)|本科|学士/i, "bachelor"],
  [/\b(associate|diploma|hnd)\b|专科|大专|高职/i, "associate"],
  [/\b(high school|secondary school|a-levels?|ib diploma)\b|高中/i, "high_school"],
];

function levelOf(e: Pick<Education, "level" | "degree">): DegreeLevel | null {
  if (e.level && e.level !== "none") return e.level;
  const text = e.degree ?? "";
  return DEGREE_TEXT.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Still studying there: marked current, or the end date is still ahead ("2023 – 2027" in 2026). */
export function inProgress(e: Pick<Education, "current" | "endDate">, now: Date = new Date()): boolean {
  if (e.current) return true;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(e.endDate ?? "");
  if (!m) return false;
  const end = Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 6);
  return end > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
}

const CODE_OF_LEVEL: Partial<Record<DegreeLevel, IdentityCode>> = {
  high_school: "S1",
  vocational: "S7",
  associate: "S7",
  bachelor: "S2",
  master: "S3",
  professional: "S3",
  doctorate: "S4",
};

/**
 * The study detail an education in progress points to — Undergraduate for a B.E., B.Tech, BSc or
 * BA still under way, Master's student, PhD student… — for the "What are you studying for?"
 * screen when the files' guess was another situation. Null when nothing is in progress.
 */
export function studyCodeFromEducation(profile: Pick<Profile, "education">, now: Date = new Date()): IdentityCode | null {
  for (const e of profile.education) {
    if (!inProgress(e, now)) continue;
    const code = CODE_OF_LEVEL[levelOf(e) ?? "none"];
    if (code) return code;
  }
  return null;
}
