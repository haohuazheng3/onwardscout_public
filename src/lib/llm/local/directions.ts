import { functionLabel } from "@/lib/core/functions";
import { identityLabel } from "@/lib/core/identities";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import type { FunctionId, IdentityCode, Profile } from "@/lib/core/types";
import { professionalYears } from "../build";
import { DirectionPlan, RecommendDirectionsInput, readProfile, type DirectionCandidate, type Language } from "../types";

/*
 * Where should this person go next? The deterministic answer: every candidate direction gets a
 * score from what the profile says (identity and stage, field, publications, a venture, years of
 * work), directions with nothing open in the catalog are never suggested, and the best (up to
 * three) come back with a reason built from the person's own facts and the live count. Claude
 * gives the same answer shape with its own reasoning when it is enabled.
 */

interface Signals {
  codes: IdentityCode[];
  groups: Set<string>;
  finalYear: boolean;
  years: number;
  publications: number;
  hasVenture: boolean;
  functions: FunctionId[];
}

function signalsOf(p: Profile): Signals {
  const codes = p.roles.map((r) => r.code);
  const finalYear = p.roles.some((r) => r.code.startsWith("S") && (r.stage === "final_year" || r.stage === "year_4_plus" || r.stage === "within_6_months" || r.stage === "within_12_months"));
  return {
    codes,
    groups: new Set(codes.map((c) => c.charAt(0))),
    finalYear,
    years: professionalYears(p),
    publications: p.publications.length,
    hasVenture: (p.packs.founder?.ventures.length ?? 0) > 0,
    functions: p.functions,
  };
}

const has = (s: Signals, ...codes: string[]) => s.codes.some((c) => codes.includes(c) || codes.includes(c.charAt(0)));

/** How strongly each direction follows from the profile (0 = no reason to suggest it). */
function score(id: string, s: Signals): number {
  switch (id) {
    case "job":
      return (has(s, "E", "T", "P", "S5") ? 5 : 0) + (s.years >= 1 ? 1 : 0) + (s.finalYear ? 3 : 0);
    case "internship":
      return has(s, "S1", "S2", "S3", "S6", "S7") ? (s.finalYear ? 3 : 5) : 0;
    case "graduate":
      return s.finalYear || has(s, "S5") ? 4 : has(s, "S2", "S3") ? 1 : 0;
    case "scholarship":
      return has(s, "S1", "S2", "S3", "S6", "S7") ? 4 : has(s, "S4") ? 2 : 0;
    case "fellowship":
      return (has(s, "R", "S4") ? 3 : has(s, "E1", "E2", "S3", "S5") ? 2 : 1) + (s.publications ? 1 : 0);
    case "accelerator":
      return has(s, "F1", "F2", "F5") ? 5 : has(s, "F") ? 3 : s.hasVenture ? 3 : 0;
    case "investors":
      return has(s, "F2", "F3") ? 5 : 0;
    case "pitch":
      return (has(s, "F") || s.hasVenture ? 3 : 0) + (has(s, "S") && s.functions.includes("engineering") ? 1 : 0);
    case "phd":
      return has(s, "S3", "R1") ? 3 : has(s, "S4") ? 4 : has(s, "S2") && s.finalYear && s.publications ? 2 : 0;
    case "grant":
      return has(s, "R") ? 5 : 0;
    case "cfp":
      return (has(s, "R", "S4") ? 3 : 0) + (s.publications ? 2 : 0);
    case "art":
      return has(s, "C1", "C2", "C3", "C5") ? 5 : 0;
    case "hackathon":
      return has(s, "S", "C6", "F5") && (s.functions.includes("engineering") || s.functions.includes("data") || s.functions.includes("product")) ? 2 : 0;
    default:
      return 0;
  }
}

function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) && !/^(?:uni|use|eu|one)/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

function count(n: number, lang: Language): string {
  return n.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
}

/** The reason for one direction, from the person's facts and what is open. */
function reasonFor(c: DirectionCandidate, s: Signals, p: Profile, lang: Language): string {
  const zh = lang === "zh";
  const who = s.codes[0] ? identityLabel(s.codes[0], lang) : "";
  const whoEn = who ? article(who.charAt(0).toLowerCase() + who.slice(1).replace(/\s*\(.*\)$/, "")) : "";
  // A field is named only when the count was taken in it.
  const fn = c.field ?? "";
  const n = count(c.open, lang);
  switch (c.id) {
    case "job":
      return zh
        ? `${s.years >= 1 ? `你有约 ${Math.round(s.years)} 年工作经验，` : ""}目前有 ${n} 个${fn ? `「${fn}」方向的` : ""}在招职位可以申请。`
        : `${s.years >= 1 ? `With about ${Math.round(s.years)} years of work behind you, ` : ""}${s.years >= 1 ? "there are" : "There are"} ${n} open roles${fn ? ` in ${fn}` : ""} you can apply to now.`;
    case "internship":
      return zh ? `${who ? `作为${who}，` : ""}实习是通往全职的常见一步；目前有 ${n} 个${fn ? `「${fn}」方向的` : ""}实习开放。` : `${whoEn ? `As ${whoEn}, ` : ""}an internship is the usual way into a full-time role; ${n}${fn ? ` in ${fn}` : ""} are open now.`;
    case "graduate":
      return zh ? `校招和管培项目面向即将毕业的学生，目前有 ${n} 个开放。` : `Graduate and trainee programs recruit students close to graduating; ${n} are open now.`;
    case "scholarship":
      return zh ? `${who ? `作为${who}，` : ""}你可以申请奖学金来支持学业；目前有 ${n} 个开放。` : `${whoEn ? `As ${whoEn}, ` : ""}you can apply for scholarships to fund your studies; ${n} are open now.`;
    case "fellowship":
      return zh
        ? `${s.publications ? `你有 ${s.publications} 项发表成果，` : ""}有 ${n} 个 Fellowship 项目面向你所处的阶段。`
        : `${s.publications ? `With ${s.publications} publication${s.publications === 1 ? "" : "s"}, ` : ""}${s.publications ? "you" : "You"} fit ${n} open fellowships for people at your stage.`;
    case "accelerator": {
      const venture = p.packs.founder?.ventures[0]?.company;
      return zh ? `${venture ? `你在做「${venture}」，` : "你在创业，"}有 ${n} 个加速器和孵化器接收你这样的团队。` : `${venture ? `You're building ${venture}; ` : "You're building a startup; "}${n} accelerators and incubators take teams like yours.`;
    }
    case "investors":
      return zh ? `以你的融资阶段，下一步是找投资人；目录里有 ${n} 位投资方。` : `At your stage the next step is raising; ${n} investors are in the catalog.`;
    case "pitch":
      return zh ? `创业比赛和路演能带来奖金和曝光；目前有 ${n} 个开放。` : `Startup competitions and pitch events bring prizes and visibility; ${n} are open now.`;
    case "phd":
      return zh ? `${who ? `作为${who}，` : ""}学术上的下一步是有资助的博士或博士后职位；目前列出 ${n} 个。` : `${whoEn ? `As ${whoEn}, ` : ""}the next academic step is a funded PhD or postdoc; ${n} openings are listed.`;
    case "grant":
      return zh ? `科研基金资助你这类研究；目前有 ${n} 个开放。` : `Research grants fund work like yours; ${n} are open now.`;
    case "cfp":
      return zh
        ? `${s.publications ? `你已有 ${s.publications} 项发表成果，` : ""}目前有 ${n} 个会议正在征稿。`
        : `${s.publications ? `You have ${s.publications} publication${s.publications === 1 ? "" : "s"} already; ` : ""}${n} conferences are taking papers now.`;
    case "art":
      return zh ? `${who ? `作为${who}，` : ""}驻留、资助和奖项是作品获得支持的主要途径；目前有 ${n} 个开放。` : `${whoEn ? `As ${whoEn}, ` : ""}residencies, grants and prizes are where work like yours gets funded; ${n} are open.`;
    case "hackathon": {
      const area = s.functions[0] ? functionLabel(s.functions[0], lang) : "";
      return zh ? `${area ? `你的方向是「${area}」，` : ""}黑客松和奖金赛能快速做出作品并被看见；目前有 ${n} 个开放。` : `${area ? `With a background in ${area}, ` : ""}${area ? "hackathons" : "Hackathons"} and prize competitions are a fast way to build and get noticed; ${n} are open.`;
    }
    default:
      return zh ? "按你的资料，把所有适合你的机会都列出来。" : "Everything open that fits your profile.";
  }
}

/** One sentence on where the person stands. */
function summaryOf(p: Profile, s: Signals, lang: Language): string {
  const zh = lang === "zh";
  const who = s.codes[0] ? identityLabel(s.codes[0], lang) : "";
  const area = s.functions[0] ? functionLabel(s.functions[0], lang) : p.industries.find(isIndustryCode) ? industryLabel(p.industries.find(isIndustryCode)!, lang) : "";
  const place = p.identity.city ?? p.identity.location ?? "";
  if (zh) return `你是${who || "正在寻找机会的人"}${area ? `，方向是${area}` : ""}${place ? `，在${place}` : ""}。`;
  const whoEn = who ? article(who.charAt(0).toLowerCase() + who.slice(1).replace(/\s*\(.*\)$/, "")) : "someone looking for their next step";
  return `You're ${whoEn}${area ? ` in ${area}` : ""}${place ? `, based in ${place}` : ""}.`;
}

/** One sentence on where the person stands (the dashboard's line above their directions). */
export function profileSummary(profile: Profile, lang: Language): string {
  return summaryOf(profile, signalsOf(profile), lang);
}

export function localRecommendDirections(raw: RecommendDirectionsInput): DirectionPlan {
  const input = RecommendDirectionsInput.parse(raw);
  const p = readProfile(input.profile);
  const s = signalsOf(p);
  const ranked = input.candidates
    .filter((c) => c.id !== "other" && c.open > 0)
    .map((c) => ({ c, score: score(c.id, s) + (c.forThem ? 1 : -2) + (c.open < 5 ? -1 : 0) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || b.c.open - a.c.open);
  const picks = ranked.slice(0, 3);
  // Nothing stands out (no identity yet, or nothing open for it): show everything that fits instead.
  const other = input.candidates.find((c) => c.id === "other");
  const chosen = picks.length ? picks : other ? [{ c: other, score: 3 }] : [];
  const top = chosen[0]?.score ?? 1;
  return DirectionPlan.parse({
    summary: summaryOf(p, s, input.language),
    directions: chosen.map(({ c, score: sc }) => ({ id: c.id, reason: reasonFor(c, s, p, input.language), strength: Math.max(0.2, Math.min(1, sc / Math.max(top, 1))) })),
  });
}
