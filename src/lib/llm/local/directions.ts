import { functionLabel } from "@/lib/core/functions";
import { identityLabel, stagesFor } from "@/lib/core/identities";
import { localize } from "@/lib/core/labels";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import type { DegreeLevel, FunctionId, IdentityCode, Profile } from "@/lib/core/types";
import { professionalYears } from "../build";
import {
  DirectionPlan,
  LIFE_PATHS,
  RecommendDirectionsInput,
  SCORED_PATHS,
  readProfile,
  type DirectionCandidate,
  type GapAction,
  type Language,
  type LifePath,
  type PlanStage,
} from "../types";

/*
 * The person's plan, the deterministic way: every candidate direction gets a score from what the
 * profile says (identity and stage, field, publications, a venture, years of work); directions
 * with nothing open in the catalog are never suggested. The strongest direction picks the life
 * path (unless the person chose one), up to three directions of that path become the plan, and
 * the roadmap, strengths and gaps are built from templates and the person's own facts. Claude
 * writes the same shape with its own reasoning when it is enabled; `finishPlan` checks its
 * answer against the candidates and fills anything missing from this one.
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

/**
 * What the person told us, in words (the model sees identity codes in the profile; this says
 * "Master's student, final year" so it never has to decode them).
 */
export function personFacts(p: Profile, lang: Language): { identities: string[]; field: string | null; industries: string[]; city: string | null } {
  return {
    identities: p.roles.map((r) => {
      const stage = r.stage ? stagesFor(r.code).find((x) => x.id === r.stage) : null;
      return [identityLabel(r.code, lang), stage ? localize(stage.label, lang) : null].filter(Boolean).join(lang === "zh" ? "，" : ", ");
    }),
    field: p.functions[0] ? functionLabel(p.functions[0], lang) : null,
    industries: p.industries.filter(isIndustryCode).map((c) => industryLabel(c, lang)),
    city: p.identity.city ?? p.identity.location ?? null,
  };
}

/** One sentence on where the person stands (the dashboard's line above their directions). */
export function profileSummary(profile: Profile, lang: Language): string {
  return summaryOf(profile, signalsOf(profile), lang);
}

/* ------------------------------------------------------------------ the plan */

interface Ranked {
  c: DirectionCandidate;
  score: number;
}

function rank(candidates: readonly DirectionCandidate[], s: Signals): Ranked[] {
  return candidates
    .filter((c) => c.id !== "other" && c.open > 0)
    .map((c) => ({ c, score: score(c.id, s) + (c.forThem ? 1 : -2) + (c.open < 5 ? -1 : 0) }))
    .sort((a, b) => b.score - a.score || b.c.open - a.c.open);
}

/**
 * How strongly the profile points to a path: its best direction plus half the next one (a path
 * with two good directions beats one with a single good one), and that best score alone.
 */
function pathStrength(ranked: readonly Ranked[], path: LifePath): { strength: number; best: number } {
  const [a = 0, b = 0] = ranked.filter((x) => x.c.paths.includes(path)).map((x) => Math.max(0, x.score));
  return { strength: a + b / 2, best: a };
}

/** The compass: each scored path's strength on a 0..1 scale. */
function pathScoresOf(ranked: readonly Ranked[]): Array<{ path: LifePath; score: number }> {
  return SCORED_PATHS.map((path) => ({ path, score: Math.round(Math.min(1, pathStrength(ranked, path).strength / 11) * 100) / 100 }));
}

/** Months a plan looks ahead: 3, 6 or 12. */
export function snapPlanHorizon(months: number): 3 | 6 | 12 {
  return months <= 4 ? 3 : months <= 9 ? 6 : 12;
}

const HORIZON: Record<string, number> = { phd: 12, grant: 12, fellowship: 12, hackathon: 3 };

function headlineFor(id: string, p: Profile, field: string | null, months: number, lang: Language): string {
  const zh = lang === "zh";
  const venture = p.packs.founder?.ventures[0]?.company ?? null;
  const within = zh ? `${months} 个月内` : `within ${months} months`;
  const inField = field ? (zh ? `「${field}」方向的` : ` in ${field}`) : "";
  switch (id) {
    case "job":
      return zh ? `${within}拿到${inField}全职工作` : `A full-time role${inField} ${within}`;
    case "internship":
      return zh ? `${within}拿到${inField}实习` : `An internship${inField} ${within}`;
    case "graduate":
      return zh ? `${within}拿到校招或管培 offer` : `A graduate-program offer ${within}`;
    case "scholarship":
      return zh ? `${within}拿到奖学金` : `Scholarship funding ${within}`;
    case "fellowship":
      return zh ? `${within}拿到有资助的 Fellowship` : `A funded fellowship ${within}`;
    case "accelerator":
      return zh ? `${within}让${venture ? `「${venture}」` : "你的项目"}进入加速器` : `${venture ?? "Your startup"} in an accelerator ${within}`;
    case "investors":
      return zh ? `${within}为${venture ? `「${venture}」` : "你的项目"}约到投资人` : `Investor meetings for ${venture ?? "your startup"} ${within}`;
    case "pitch":
      return zh ? `${within}登上路演舞台、争取奖金` : `Stage time and prize money ${within}`;
    case "phd":
      return zh ? `${within}拿到有资助的博士或博士后职位` : `A funded PhD or postdoc ${within}`;
    case "grant":
      return zh ? `${within}为你的研究拿到资助` : `Funding for your research ${within}`;
    case "cfp":
      return zh ? `${within}让你的研究登上学术会议` : `Your work at a conference ${within}`;
    case "art":
      return zh ? `${within}拿到驻留、资助或奖项` : `A residency, grant or prize ${within}`;
    case "hackathon":
      return zh ? `${within}参加黑客松，做出作品` : `A hackathon project shipped ${within}`;
    default:
      return zh ? "每周为你找到合适的机会" : "Openings that fit you, every week";
  }
}

/** Stage templates per path: title, detail, and the share of the horizon each spans. */
const STAGES: Record<LifePath, Array<{ en: [string, string]; zh: [string, string] }>> = {
  work: [
    { en: ["Get ready", "Résumé and answers drafted from your profile"], zh: ["准备材料", "根据你的资料准备简历和常见问答"] },
    { en: ["Apply every week", "Best-fit openings first; you tap to send"], zh: ["每周投递", "先投最合适的，你点确认才会发出"] },
    { en: ["Interviews", "Prepare for each one as replies arrive"], zh: ["面试", "回复一来，就为每场面试做准备"] },
    { en: ["Offer", "Compare offers and decide"], zh: ["拿到 offer", "比较 offer，做出选择"] },
  ],
  startup: [
    { en: ["Sharpen the story", "Deck and one-pager from your materials"], zh: ["打磨项目叙事", "用你的材料整理路演稿和一页纸"] },
    { en: ["Apply to programs", "Accelerators and competitions open now"], zh: ["申请项目", "正在开放的加速器和创业比赛"] },
    { en: ["Meet investors", "One personal email at a time, never bulk"], zh: ["见投资人", "一对一个性化联系，绝不群发"] },
    { en: ["Get in or raise", "Pick the program or round that fits"], zh: ["入营或融资", "选定合适的项目或融资"] },
  ],
  research: [
    { en: ["Research statement", "Statement and CV from your work"], zh: ["研究陈述", "根据你的成果整理研究陈述和 CV"] },
    { en: ["Apply", "Positions, grants and calls open now"], zh: ["申请", "正在开放的职位、基金和征稿"] },
    { en: ["Reviews and interviews", "Answer reviewers, prepare interviews"], zh: ["评审与面谈", "回应评审，准备面谈"] },
    { en: ["Funded start", "Accept the offer that fits"], zh: ["带资助开始", "接受最合适的录用"] },
  ],
  study: [
    { en: ["Materials", "Statement, CV and transcripts in order"], zh: ["准备材料", "整理个人陈述、简历和成绩单"] },
    { en: ["Apply", "Scholarships and programs, deadlines first"], zh: ["申请", "按截止日期先后申请奖学金和项目"] },
    { en: ["Decisions", "Follow up and answer requests"], zh: ["等待结果", "跟进进度，回应补材料请求"] },
    { en: ["Funded", "Choose the offer that fits"], zh: ["拿到资助", "选择最合适的录取或资助"] },
  ],
  create: [
    { en: ["Portfolio ready", "Your best work and statement, in order"], zh: ["作品集就绪", "整理代表作和创作陈述"] },
    { en: ["Open calls", "Residencies, grants and prizes open now"], zh: ["投递征集", "正在开放的驻留、资助与奖项"] },
    { en: ["Shortlists", "Answer requests, prepare interviews"], zh: ["入围", "回应补充材料，准备面谈"] },
    { en: ["Selected", "Take the residency or award"], zh: ["入选", "接受驻留或奖项"] },
  ],
  explore: [
    { en: ["Complete your profile", "A résumé or links sharpen every pick"], zh: ["完善资料", "上传简历或链接，推荐会更准"] },
    { en: ["Try the best picks", "Apply to a few and see what lands"], zh: ["试投最佳推荐", "先投几个，看看反馈"] },
    { en: ["Follow up", "Follow-ups drafted for you"], zh: ["跟进", "跟进邮件帮你写好"] },
    { en: ["Choose a path", "Focus where the replies are"], zh: ["选定方向", "哪里有回应，就专注哪里"] },
  ],
};
const SPANS: Array<[number, number]> = [
  [0, 0.17],
  [0.08, 0.67],
  [0.42, 0.92],
  [0.83, 1],
];

const half = (n: number) => Math.round(n * 2) / 2;

function roadmapFor(path: LifePath, months: number, lang: Language): PlanStage[] {
  return STAGES[path].map((st, i) => {
    const [title, detail] = lang === "zh" ? st.zh : st.en;
    const [a, b] = SPANS[i]!;
    return { title, detail, startMonth: half(a * months), endMonth: Math.max(half(b * months), half(a * months) + 0.5) };
  });
}

const LEVEL: Partial<Record<DegreeLevel, [string, string]>> = {
  high_school: ["High school", "高中"],
  vocational: ["Vocational study", "职业教育"],
  associate: ["Associate degree", "专科"],
  bachelor: ["Bachelor's", "本科"],
  master: ["Master's", "硕士"],
  professional: ["Professional degree", "专业学位"],
  doctorate: ["PhD", "博士"],
};

type Strength = { label: string; evidence: string };
type StrengthKind = "education" | "experience" | "skills" | "publications" | "venture" | "projects" | "awards" | "languages";

const STRENGTH_ORDER: Record<LifePath, StrengthKind[]> = {
  work: ["education", "experience", "skills", "projects", "awards", "languages"],
  startup: ["venture", "experience", "skills", "projects", "awards", "education"],
  research: ["publications", "education", "awards", "projects", "skills", "languages"],
  study: ["education", "awards", "languages", "projects", "experience", "skills"],
  create: ["projects", "awards", "skills", "experience", "education", "languages"],
  explore: ["education", "experience", "skills", "projects", "awards", "languages"],
};

function strengthsFor(path: LifePath, p: Profile, s: Signals, lang: Language): Strength[] {
  const zh = lang === "zh";
  const make: Record<StrengthKind, () => Strength | null> = {
    education: () => {
      const e = p.education.find((x) => x.current) ?? p.education[0];
      if (!e) return null;
      const level = e.level ? LEVEL[e.level]?.[zh ? 1 : 0] : null;
      const label = [level ?? e.degree, e.field].filter(Boolean).join(" · ") || e.institution;
      const when = e.current ? (zh ? "在读" : "in progress") : e.endDate ? e.endDate.slice(0, 4) : "";
      return { label, evidence: [e.institution, when].filter(Boolean).join(zh ? " · " : ", ") };
    },
    experience: () => {
      const x = p.experience.find((e) => e.current) ?? p.experience[0];
      if (!x) return null;
      const yrs = Math.round(s.years);
      const label = yrs >= 1 ? (zh ? `${yrs} 年工作经验` : `${yrs} year${yrs === 1 ? "" : "s"} of work`) : zh ? "实习与工作经历" : "Work experience";
      return { label, evidence: zh ? `${x.organization} · ${x.title}` : `${x.title}, ${x.organization}` };
    },
    skills: () => {
      const order = ["technical", "tool", "domain", "creative", "language", "other", "soft"];
      const names = [...p.skills].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)).map((k) => k.name);
      return names.length ? { label: zh ? "技能" : "Skills", evidence: names.slice(0, 4).join(zh ? "、" : ", ") } : null;
    },
    publications: () => (s.publications ? { label: zh ? `${s.publications} 项发表成果` : `${s.publications} publication${s.publications === 1 ? "" : "s"}`, evidence: p.publications[0]!.title } : null),
    venture: () => {
      const v = p.packs.founder?.ventures[0];
      if (!v) return null;
      return { label: zh ? "在做的项目" : "A venture underway", evidence: [v.company, v.oneLiner].filter(Boolean).join(zh ? "：" : ": ") };
    },
    projects: () => (p.projects[0] ? { label: zh ? "项目经历" : "Projects", evidence: p.projects.slice(0, 2).map((x) => x.name).join(zh ? "、" : ", ") } : null),
    awards: () => (p.achievements[0] ? { label: zh ? "获奖与荣誉" : "Awards", evidence: p.achievements[0].title } : null),
    languages: () => (p.identity.languages.length >= 2 ? { label: zh ? "多语言" : "Languages", evidence: p.identity.languages.map((l) => l.code.toUpperCase()).join(" · ") } : null),
  };
  const out = STRENGTH_ORDER[path].map((k) => make[k]()).filter((x): x is Strength => Boolean(x && x.label && x.evidence));
  if (!out.length && s.codes[0]) out.push({ label: identityLabel(s.codes[0], lang), evidence: zh ? "来自你的回答" : "From your answers" });
  return out.slice(0, 4).map((x) => ({ label: clip(x.label, 40), evidence: clip(x.evidence, 100) }));
}

function gapsFor(path: LifePath, p: Profile, s: Signals, lang: Language): Array<{ label: string; action: GapAction }> {
  const zh = lang === "zh";
  const out: Array<{ label: string; action: GapAction }> = [];
  const add = (en: string, cn: string, action: GapAction) => out.push({ label: zh ? cn : en, action });
  const empty = !p.education.length && !p.experience.length && !p.skills.length;
  if (empty) add("Add your résumé", "上传简历", "upload_resume");
  if (path === "startup" && !s.hasVenture) add("Add your pitch deck", "上传路演稿", "upload_deck");
  if (path === "research" && !s.publications) add("List your publications", "补充发表成果", "add_publications");
  if (path === "create" && !p.identity.links.length) add("Add your portfolio link", "添加作品集链接", "add_portfolio");
  if (path === "work" && !p.identity.links.length && s.functions.some((f) => f === "engineering" || f === "design" || f === "data")) add("Add a portfolio or GitHub link", "添加作品集或 GitHub 链接", "add_portfolio");
  if (!empty && !p.skills.length) add("List your key skills", "补充核心技能", "add_skills");
  if (!empty && !p.experience.length && !s.groups.has("S")) add("Add your work history", "补充工作经历", "add_experience");
  return out.slice(0, 3);
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:，。；：、]+$/, "")}…`;
}

export function localRecommendDirections(raw: RecommendDirectionsInput): DirectionPlan {
  const input = RecommendDirectionsInput.parse(raw);
  const p = readProfile(input.profile);
  const s = signalsOf(p);
  const ranked = rank(input.candidates, s);
  const pathScores = pathScoresOf(ranked);

  let path: LifePath = input.preferredPath ?? "explore";
  if (!input.preferredPath) {
    // The strongest path whose best direction clearly fits (ties: the stronger single direction).
    const scored = SCORED_PATHS.map((p) => ({ p, ...pathStrength(ranked, p) }))
      .filter((x) => x.best >= 3)
      .sort((a, b) => b.strength - a.strength || b.best - a.best);
    path = scored[0]?.p ?? "explore";
  }
  // A path the person chose shows its directions even when the profile points elsewhere.
  const inPath = path === "explore" ? [] : ranked.filter((x) => x.c.paths.includes(path) && (input.preferredPath ? true : x.score >= 2));
  let picks = inPath.slice(0, 3);
  const other = input.candidates.find((c) => c.id === "other");
  if (!picks.length) {
    picks = other ? [{ c: other, score: 3 }] : [];
    if (!input.preferredPath) path = "explore";
  }
  const top = Math.max(picks[0]?.score ?? 1, 1);
  const lead = picks[0]?.c ?? null;
  const months = snapPlanHorizon(lead ? (HORIZON[lead.id] ?? 6) : 6);
  const directions = picks.map(({ c, score: sc }) => ({ id: c.id, reason: reasonFor(c, s, p, input.language), strength: Math.max(0.2, Math.min(1, sc / top)) }));
  return DirectionPlan.parse({
    summary: summaryOf(p, s, input.language),
    path,
    pathReason: directions[0]?.reason ?? "",
    headline: headlineFor(lead?.id ?? "other", p, lead?.field ?? null, months, input.language),
    horizonMonths: months,
    pathScores,
    directions,
    roadmap: roadmapFor(path, months, input.language),
    strengths: strengthsFor(path, p, s, input.language),
    gaps: gapsFor(path, p, s, input.language),
  });
}

/**
 * A model's plan made safe to show: the chosen path wins, directions must be real candidates of
 * that path with something open (else the deterministic ones for the path), text is clipped to
 * the dashboard's space, the roadmap fits the horizon, and anything missing comes from the
 * deterministic plan.
 */
export function finishPlan(model: Partial<DirectionPlan>, raw: RecommendDirectionsInput): DirectionPlan {
  const input = RecommendDirectionsInput.parse(raw);
  const path: LifePath = input.preferredPath ?? (model.path && (LIFE_PATHS as readonly string[]).includes(model.path) ? model.path : "explore");
  const fallback = localRecommendDirections({ ...input, preferredPath: path });
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const directions = (model.directions ?? [])
    .filter((d) => {
      const c = byId.get(d.id);
      if (!c || c.open <= 0 || seen.has(d.id)) return false;
      seen.add(d.id);
      return path === "explore" ? c.id === "other" || c.forThem : c.paths.includes(path);
    })
    .slice(0, 3)
    .map((d) => ({ id: d.id, reason: clip(d.reason, 220), strength: Math.max(0, Math.min(1, Number.isFinite(d.strength) ? d.strength : 0.5)) }));
  const months = snapPlanHorizon(model.horizonMonths ?? fallback.horizonMonths);
  const roadmap = (model.roadmap ?? [])
    .filter((st) => st.title?.trim() && Number.isFinite(st.startMonth) && Number.isFinite(st.endMonth))
    .map((st) => {
      const start = Math.max(0, Math.min(months - 0.5, half(st.startMonth)));
      return { title: clip(st.title, 40), detail: clip(st.detail ?? "", 100), startMonth: start, endMonth: Math.max(start + 0.5, Math.min(months, half(st.endMonth))) };
    })
    .sort((a, b) => a.startMonth - b.startMonth || a.endMonth - b.endMonth)
    .slice(0, 5);
  const scores = new Map((model.pathScores ?? []).map((x) => [x.path, x.score]));
  const strengths = (model.strengths ?? []).filter((x) => x.label?.trim() && x.evidence?.trim()).slice(0, 4).map((x) => ({ label: clip(x.label, 40), evidence: clip(x.evidence, 110) }));
  const usable = directions.length > 0;
  return DirectionPlan.parse({
    summary: clip(model.summary?.trim() || fallback.summary, 200),
    path,
    pathReason: clip((usable && model.pathReason?.trim()) || fallback.pathReason, 220),
    headline: clip((usable && model.headline?.trim()) || fallback.headline, 80),
    horizonMonths: months,
    pathScores: fallback.pathScores.map((x) => {
      const v = scores.get(x.path);
      return { path: x.path, score: typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : x.score };
    }),
    directions: usable ? directions : fallback.directions,
    roadmap: roadmap.length >= 2 ? roadmap : roadmapFor(path, months, input.language),
    strengths: strengths.length ? strengths : fallback.strengths,
    gaps: (() => {
      const gaps = (model.gaps ?? []).filter((g) => g.label?.trim()).slice(0, 3).map((g) => ({ label: clip(g.label, 60), action: g.action }));
      return gaps.length ? gaps : fallback.gaps;
    })(),
  });
}
