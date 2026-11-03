import { getOccupation, isOccupationCode, mapOccupation } from "@/lib/core/occupations";
import type { Profile } from "@/lib/core/types";

/*
 * Which of a person's roles speak for them (pure, isomorphic: the identity inference and the goal
 * wording both use it). Internships, volunteering and — while someone studies — teaching or research
 * assistantships are experience, but not the person's job: a student whose internship ended is
 * not "working", and an internship goal is named after the main role in their field, never after
 * a side role like a teaching assistantship.
 */

type Experience = Profile["experience"][number];

const INTERN_TITLE = /\b(intern|internship|summer analyst|summer associate|co-?op student|working student)\b|实习/i;
const STUDENT_JOB_TITLE =
  /\b(teaching assistant|teaching fellow|graduate assistant|research assistant|lab assistant|student assistant|student (?:ambassador|representative|researcher|worker)|campus ambassador|peer tutor|class representative)\b|助教|助研|学生助理/i;

/** A role line that is the career break itself ("Full-time parent and carer", "Career break"). */
const BREAK_ROLE = /career break|sabbatical|family leave|parental leave|time off|full[- ]time (parent|carer|caregiver|mum|mom|mother|father|dad)|stay[- ]at[- ]home|\bcaregiver\b|职业空窗|全职(妈妈|爸爸)/i;

/** The career break written as a role: on the timeline, but neither a job nor years of experience. */
export function isBreakRole(e: { title?: string | null; organization?: string | null }): boolean {
  return BREAK_ROLE.test(`${e.title ?? ""} ${e.organization ?? ""}`);
}

/** An internship, a volunteer role, the career break, or (for a student) an assistantship or campus role. */
export function isSideRole(e: Pick<Experience, "title" | "employmentType"> & { organization?: string | null }, opts: { student?: boolean } = {}): boolean {
  if (e.employmentType === "internship" || e.employmentType === "volunteer" || INTERN_TITLE.test(e.title ?? "") || isBreakRole(e)) return true;
  return Boolean(opts.student) && STUDENT_JOB_TITLE.test(e.title ?? "");
}

/** A role held alongside study or for a cause — an assistantship, a campus role, volunteering — never what a goal is named after. */
export function isAssistantship(e: Pick<Experience, "title" | "employmentType">): boolean {
  return e.employmentType === "volunteer" || STUDENT_JOB_TITLE.test(e.title ?? "");
}

/** Most recent first: current roles, then by end date, then by start date. */
export function byRecency<T extends Pick<Experience, "current" | "startDate" | "endDate">>(list: readonly T[]): T[] {
  return [...list].sort(
    (a, b) => Number(b.current) - Number(a.current) || (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999") || (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  );
}

/** Intern titles name the discipline, not the role: "Software Engineering Intern" → "Software Engineer". */
const DISCIPLINE_TO_ROLE: Array<[RegExp, string]> = [
  [/\bengineering\b/gi, "Engineer"],
  [/\bscience\b/gi, "Scientist"],
  [/\bdevelopment\b/gi, "Developer"],
  [/\bmanagement\b/gi, "Manager"],
  [/\bdesign\b/gi, "Designer"],
  [/\banaly(?:tics|sis)\b/gi, "Analyst"],
  [/\bresearch\b/gi, "Researcher"],
  [/\baccounting\b/gi, "Accountant"],
  [/\bconsulting\b/gi, "Consultant"],
];

export function roleNoun(title: string): string {
  let t = title.replace(/\b(summer|winter|spring|autumn|fall|intern(?:ship)?|trainee|co-?op|apprentice(?:ship)?)\b/gi, " ");
  for (const [re, noun] of DISCIPLINE_TO_ROLE) t = t.replace(re, noun);
  return t.replace(/[,()|/–—-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The occupation a role maps to (the parser's mapping, else its title read as a role noun). */
export function occupationOfRole(e: Pick<Experience, "occupation" | "title">): string | null {
  if (e.occupation && isOccupationCode(e.occupation)) return e.occupation;
  const title = e.title ?? "";
  for (const t of [title, roleNoun(title)]) {
    if (!t) continue;
    const hit = mapOccupation(t, { limit: 1, minScore: 0.7 })[0];
    if (hit) return hit.code;
  }
  return null;
}

const SIDE_OCCUPATIONS = new Set(["teaching-assistant", "research-assistant"]);

/**
 * The occupation a goal is named after ("Land a Software Engineer internship…"): the most recent
 * role in the person's field (an internship counts: it names the work); an assistantship or
 * volunteer role only when it is the field itself (a teaching assistant whose field is teaching);
 * with no field, the most recent role that isn't one. Null when no role fits — the goal then reads
 * without one ("Land an internship…"), never with a wrong one.
 */
export function goalOccupation(profile: Pick<Profile, "experience" | "functions" | "occupations">): string | null {
  const field = profile.functions[0] ?? null;
  const inField = (code: string) => !field || getOccupation(code).function === field;
  const ranked = byRecency(profile.experience)
    .map((e) => ({ side: isAssistantship(e), code: occupationOfRole(e) }))
    .filter((x): x is { side: boolean; code: string } => x.code !== null);
  const pick = ranked.find((x) => !x.side && inField(x.code)) ?? (field ? ranked.find((x) => inField(x.code)) : undefined);
  if (pick) return pick.code;
  return profile.occupations.find((c) => isOccupationCode(c) && inField(c) && !SIDE_OCCUPATIONS.has(c)) ?? null;
}
