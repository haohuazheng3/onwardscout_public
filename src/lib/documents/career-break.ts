import type { Profile } from "@/lib/core/types";
import { FactView } from "@/lib/llm/local/factview";
import { isBreakRole } from "@/lib/llm/local/roles";
import type { FactRef } from "@/lib/llm/types";
import { formatPartialDate } from "./resume";

/*
 * The career break, for returnships (pure). Why someone stepped away is theirs to say: the
 * reason is always the person's own answer (one tap on a plain choice, or their own words),
 * never inferred. When the break started comes from their documents: the end of their most
 * recent role, when no role is current. Both feed the career-break note and the "Career break"
 * line of the returner résumé.
 */

type Lang = "en" | "zh";

export const CAREER_BREAK_KEY = "career_break";

export const CAREER_BREAK_REASONS = [
  { value: "caregiving", label: { en: "Caring for children or family", zh: "照顾孩子或家人" }, phrase: { en: "to care for my family", zh: "照顾家人" } },
  { value: "health", label: { en: "My health or recovery", zh: "身体原因或康复" }, phrase: { en: "to focus on my health", zh: "专注于身体康复" } },
  { value: "relocation", label: { en: "A move (mine or my partner's)", zh: "搬迁（我或伴侣的工作调动）" }, phrase: { en: "for a family relocation", zh: "随家庭搬迁" } },
  { value: "study", label: { en: "Study or retraining", zh: "进修或转型学习" }, phrase: { en: "to study and retrain", zh: "进修和学习新技能" } },
  { value: "venture", label: { en: "My own project or business", zh: "做自己的项目或生意" }, phrase: { en: "to work on my own venture", zh: "做自己的项目" } },
  { value: "personal", label: { en: "Personal reasons (I'd rather not say more)", zh: "个人原因（不想细说）" }, phrase: { en: "for personal reasons", zh: "出于个人原因" } },
] as const;

export type CareerBreakReason = (typeof CAREER_BREAK_REASONS)[number]["value"];

/** Plain statements of why someone stepped away, as people write them in a résumé summary. */
const REASON_CUES: Array<[CareerBreakReason, RegExp]> = [
  ["caregiving", /\b(car(e|ing) for (my |our |a )?([a-z]+ ){0,2}(family|children|kids|child|baby|parents?|mother|father|son|daughter|relative)|caregiv\w*|parental leave|maternity|paternity|raising (my |our )?(children|kids|family|son|daughter)|stay[- ]at[- ]home (parent|mom|mum|dad)|full[- ]time (parent|mom|mum|dad))\b|照顾(家人|孩子|老人|父母)|育儿|全职妈妈|全职爸爸/i],
  ["health", /\b(health reasons|medical (leave|reasons)|recover(y|ing) from (an? )?(illness|injury|surgery))\b|身体原因|养病/i],
  ["relocation", /\b(relocat(ed|ion) (with|for) (my )?(family|spouse|partner)|(spouse|partner)['’]?s? (job|posting|relocation))\b|随迁|随配偶/i],
  ["study", /\b(went back to (school|university|college)|full[- ]time (study|student))\b|全职读书|全职进修/i],
];

/**
 * The reason, when the person's own documents state it outright ("returning after a career break
 * to care for my family"): exactly one plain statement, else null (then we ask). Never a guess.
 */
export function careerBreakFromProfile(profile: Pick<Profile, "summary" | "experience">): CareerBreakReason | null {
  // Only the person's description of themselves, or a résumé line that IS the break ("Career
  // break — caring for my parents"): a job bullet about building tools for caregivers is not a reason.
  const breakEntries = profile.experience.filter(isBreakRole);
  const texts = [profile.summary ?? "", ...breakEntries.map((e) => [e.title ?? "", e.summary ?? "", ...e.highlights].join(" "))].filter(Boolean);
  const hits = REASON_CUES.filter(([, re]) => texts.some((t) => re.test(t))).map(([reason]) => reason);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * When the break began: the start of a résumé line that is the break itself, else the end of the
 * most recent paid role, if none is current (else null). Volunteering during the break (a
 * parents' association treasurer) neither ends nor interrupts it.
 */
export function careerBreakSince(profile: Profile, facts: FactRef[]): { date: string; ids: string[] } | null {
  const exps = new FactView(profile, facts).experiences();
  const stated = exps.find((e) => isBreakRole(e.value) && e.value.startDate);
  if (stated?.value.startDate) return { date: stated.value.startDate, ids: stated.ids };
  const work = exps.filter((e) => !isBreakRole(e.value) && e.value.employmentType !== "volunteer");
  if (!work.length || work.some((e) => e.value.current)) return null;
  const ended = work.filter((e) => e.value.endDate).sort((a, b) => (b.value.endDate ?? "").localeCompare(a.value.endDate ?? ""));
  const last = ended[0];
  return last?.value.endDate ? { date: last.value.endDate, ids: last.ids } : null;
}

/** The reason as the person gave it: a known choice's phrase, or their own words. */
function reasonText(answer: string, lang: Lang): { text: string; known: boolean } {
  const v = answer.trim();
  const hit = CAREER_BREAK_REASONS.find((r) => r.value === v || r.label.en.toLowerCase() === v.toLowerCase() || r.label.zh === v);
  return hit ? { text: hit.phrase[lang], known: true } : { text: v.replace(/[.。!！\s]+$/u, ""), known: false };
}

/** One honest sentence for the note: "I stepped away from work in March 2021 to care for my family." */
export function careerBreakSentence(answer: string, since: string | null, lang: Lang): string {
  const { text, known } = reasonText(answer, lang);
  const when = formatPartialDate(since, lang);
  if (lang === "zh") {
    const head = when ? `我在 ${when} 离开职场` : "我曾暂时离开职场";
    return known ? `${head}，${text}。` : `${head}。${text}。`;
  }
  const head = when ? `I stepped away from work in ${when}` : "I took a career break";
  return known ? `${head} ${text}.` : `${head}: ${lowerFirst(text)}.`;
}

/** The résumé line's detail: the choice's label, or the person's own words. */
export function careerBreakDetail(answer: string, lang: Lang): string {
  const v = answer.trim();
  const hit = CAREER_BREAK_REASONS.find((r) => r.value === v || r.label.en.toLowerCase() === v.toLowerCase() || r.label.zh === v);
  return hit ? hit.label[lang].replace(/\s*\(.*\)$|（.*）$/u, "") : v.replace(/[.。]+$/u, "");
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
