import { mapFunction } from "@/lib/core/functions";
import { mapIndustry } from "@/lib/core/industries";
import { mapOccupation } from "@/lib/core/occupations";
import {
  ACHIEVEMENT_KINDS,
  EMPLOYMENT_TYPES,
  LINK_KINDS,
  PUBLICATION_KINDS,
  PUBLICATION_STATUSES,
  SKILL_CATEGORIES,
  SKILL_LEVELS,
  VENTURE_STAGES,
  WORK_AUTH_STATUSES,
  profileSchema,
  type DegreeLevel,
  type FunctionId,
  type LinkKind,
  type Profile,
  type Traction,
} from "@/lib/core/types";
import { sha256 } from "@/lib/ids";
import { classifyLink } from "@/lib/ingest/url";
import { countryCodeFromName, countryOfLocation } from "./local/geo";
import { findMoney, totalYears } from "./local/text";
import type { ExtractDocument, ExtractedFact, ExtractionIR, Src } from "./types";

/*
 * Extraction IR → Profile (F2's schema) + facts. Shared by the local engine and the Claude
 * provider so both produce the same shapes, the same stable item ids and the same fact paths.
 *
 *  - Item ids are derived from the item's identity (organisation + title + start…), so a
 *    re-extraction of the same résumé yields the same ids and facts keep pointing at them.
 *  - Duplicates across documents are merged (highlights unioned); the first source wins.
 *  - Every quote is checked against its document's text; a quote that can't be found loses
 *    confidence (≤ 0.35) instead of being trusted.
 *  - Values outside F2's enums are mapped or dropped, never forced.
 */

type Lang = "en" | "zh";

/* ------------------------------------------------------------------ quote verification */

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export class QuoteChecker {
  private readonly texts = new Map<string, string>();
  constructor(documents: ExtractDocument[]) {
    for (const d of documents) this.texts.set(d.id, normalizeForMatch(d.text ?? ""));
  }

  /** True when every " / "-separated segment of the quote occurs in the document. */
  found(docId: string | null, quote: string): boolean {
    if (!docId) return false;
    const text = this.texts.get(docId);
    if (!text) return false;
    const segments = quote
      .split(/\s+\/\s+|…/)
      .map((s) => normalizeForMatch(s))
      .filter((s) => s.length >= 2);
    return segments.length > 0 && segments.every((s) => text.includes(s));
  }

  /** Fixes the document id when the quote is found in another document; lowers confidence when nowhere. */
  verify(src: Src): Src {
    if (this.found(src.docId, src.quote)) return src;
    for (const id of this.texts.keys()) if (this.found(id, src.quote)) return { ...src, docId: id };
    // Images and scans have no text to check against: keep the model's confidence, capped.
    if (src.docId && this.texts.get(src.docId) === "") return { ...src, confidence: Math.min(src.confidence, 0.7) };
    return { ...src, confidence: Math.min(src.confidence, 0.35) };
  }
}

/* ------------------------------------------------------------------ value mapping */

function itemId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const key = parts
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${prefix}_${sha256(key).slice(0, 10)}`;
}

const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
function date(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (PARTIAL_DATE.test(s)) return s;
  const m = /^(\d{4})[-./](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const y = /\b(19|20)\d{2}\b/.exec(s);
  return y ? y[0] : null;
}

function inEnum<T extends string>(values: readonly T[], v: string | null | undefined): T | null {
  return v && (values as readonly string[]).includes(v) ? (v as T) : null;
}

const LINK_KIND_MAP: Record<string, LinkKind> = { appstore: "app_store", producthunt: "product_hunt", googleplay: "other", arxiv: "other" };

export function linkKind(url: string): LinkKind {
  const k = classifyLink(url);
  const mapped = LINK_KIND_MAP[k] ?? k;
  return inEnum(LINK_KINDS, mapped) ?? "other";
}

const LANGUAGE_CODES: Array<[RegExp, string]> = [
  [/^(english|英语|英文)/i, "en"],
  [/^(mandarin|chinese|putonghua|普通话|中文|汉语|国语)/i, "zh"],
  [/^(cantonese|粤语|广东话)/i, "yue"],
  [/^(spanish|español|西班牙语)/i, "es"],
  [/^(french|français|法语)/i, "fr"],
  [/^(german|deutsch|德语)/i, "de"],
  [/^(japanese|日本語|日语)/i, "ja"],
  [/^(korean|한국어|韩语)/i, "ko"],
  [/^(portuguese|português|葡萄牙语)/i, "pt"],
  [/^(italian|italiano|意大利语)/i, "it"],
  [/^(russian|русский|俄语)/i, "ru"],
  [/^(arabic|阿拉伯语)/i, "ar"],
  [/^(hindi|印地语)/i, "hi"],
  [/^(dutch|nederlands|荷兰语)/i, "nl"],
  [/^(swedish|瑞典语)/i, "sv"],
  [/^(turkish|土耳其语)/i, "tr"],
  [/^(vietnamese|越南语)/i, "vi"],
  [/^(thai|泰语)/i, "th"],
  [/^(indonesian|bahasa indonesia|印尼语)/i, "id"],
  [/^(malay|bahasa melayu|马来语)/i, "ms"],
  [/^(polish|波兰语)/i, "pl"],
  [/^(ukrainian|乌克兰语)/i, "uk"],
  [/^(hebrew|希伯来语)/i, "he"],
  [/^(greek|希腊语)/i, "el"],
  [/^(tagalog|filipino)/i, "tl"],
  [/^(ielts|toefl|cet|tem|雅思|托福|四级|六级|专八|专四)/i, "en"],
  [/^(hsk)/i, "zh"],
  [/^(jlpt)/i, "ja"],
  [/^(delf|dalf)/i, "fr"],
  [/^(dele)/i, "es"],
  [/^(testdaf|goethe)/i, "de"],
];

export function languageCode(name: string): string | null {
  const s = name.trim();
  for (const [re, code] of LANGUAGE_CODES) if (re.test(s)) return code;
  return null;
}

export function languageLevel(text: string | null | undefined): "native" | "fluent" | "professional" | "conversational" | "basic" | null {
  const t = (text ?? "").toLowerCase();
  if (/native|mother tongue|first language|bilingual|母语/.test(t)) return "native";
  if (/fluent|proficient|c2|c1|流利|精通/.test(t)) return "fluent";
  if (/professional|working|business|advanced|b2|cet-?6|tem-?8|ielts\s*[7-9]|toefl\s*1[01]\d|专八|六级|熟练/.test(t)) return "professional";
  if (/conversational|intermediate|b1|日常|中级|cet-?4|四级/.test(t)) return "conversational";
  if (/basic|beginner|elementary|a1|a2|基础|入门|初级/.test(t)) return "basic";
  return null;
}

const LEVEL_MAP: Record<string, DegreeLevel> = {
  high_school: "high_school",
  associate: "associate",
  vocational: "vocational",
  bachelor: "bachelor",
  master: "master",
  mba: "master",
  phd: "doctorate",
  doctorate: "doctorate",
  md: "professional",
  jd: "professional",
  professional: "professional",
  none: "none",
};

function gpa(text: string | null | undefined): { value: number; scale: number } | null {
  if (!text) return null;
  const m = /(\d(?:\.\d{1,2})?|\d{2}(?:\.\d)?)\s*(?:\/\s*(\d(?:\.\d{1,2})?|100))?/.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  let scale = m[2] ? Number(m[2]) : value <= 4.3 ? 4 : value <= 5 ? 5 : value <= 10 ? 10 : 100;
  if (scale < value) scale = value <= 100 ? 100 : value;
  return Number.isFinite(value) && scale > 0 ? { value, scale } : null;
}

const EMPLOYMENT_MAP: Record<string, string> = { founder: "self_employed", activity: "volunteer", research: "full_time", teaching: "part_time" };

function employmentType(v: string | null): Profile["experience"][number]["employmentType"] {
  if (!v) return null;
  return inEnum(EMPLOYMENT_TYPES, EMPLOYMENT_MAP[v] ?? v);
}

const TOOL_NAMES = /^(figma|sketch|adobe|photoshop|illustrator|indesign|after effects|premiere|final cut|davinci|blender|maya|unity|unreal|jira|confluence|notion|asana|trello|slack|excel|powerpoint|word|google (sheets|docs|analytics)|tableau|power bi|looker|amplitude|mixpanel|hubspot|salesforce|sap|quickbooks|xero|git|github|gitlab|docker|kubernetes|aws|gcp|azure|terraform|jenkins|postman|axure|canva|wordpress|shopify|zapier|airtable|qgis|arcgis|matlab|spss|stata|autocad|revit|solidworks|google earth engine|kafka|redis|postgresql|mysql|mongodb|elasticsearch|snowflake|databricks|airflow|dbt|figjam|miro|framer|webflow)\b/i;
const TECH_NAMES = /^(python|java(script)?|typescript|go|golang|rust|c\+\+|c#|c|ruby|php|swift|kotlin|scala|r|sql|html|css|html\/css|react|vue|angular|node(\.js)?|django|flask|spring|pytorch|tensorflow|pandas|numpy|spark|hadoop|graphql|rest|linux|bash|machine learning|deep learning|nlp|computer vision|data analysis|statistics|a\/b testing|mixed-effects models)\b/i;
const SOFT = /^(leadership|communication|teamwork|collaboration|problem solving|negotiation|public speaking|mentoring|stakeholder management|time management|沟通|团队合作|领导力|演讲)/i;
const CREATIVE = /\b(design|illustration|photography|video|animation|typography|branding|drawing|painting|writing|copywriting|storytelling|music|editing|prototyping|interaction design|ux|ui)\b|设计|摄影|插画|剪辑|写作|文案/i;

function skillCategory(name: string, hint: string | null): Profile["skills"][number]["category"] {
  const h = (hint ?? "").toLowerCase();
  if (inEnum(SKILL_CATEGORIES, h)) return h as Profile["skills"][number]["category"];
  // A known product or language name is more telling than the résumé's own grouping ("Design: Figma").
  if (TOOL_NAMES.test(name)) return "tool";
  if (TECH_NAMES.test(name)) return "technical";
  if (/tool|software|platform|infra|devops|cloud|工具|软件|平台/.test(h)) return "tool";
  if (/language/.test(h) && !/programming/.test(h)) return "language";
  if (/programming|technical|tech|engineering|development|data|技术|编程|开发/.test(h)) return "technical";
  if (/design|creative|art|设计|创意/.test(h)) return "creative";
  if (/soft|interpersonal|leadership|软技能/.test(h)) return "soft";
  if (/research|domain|industry|methods|knowledge|专业|行业|研究/.test(h)) return "domain";
  if (TOOL_NAMES.test(name)) return "tool";
  if (TECH_NAMES.test(name)) return "technical";
  if (SOFT.test(name)) return "soft";
  if (CREATIVE.test(name)) return "creative";
  return "other";
}

function skillLevel(v: string | null): Profile["skills"][number]["level"] {
  if (!v) return null;
  const t = v.toLowerCase();
  if (inEnum(SKILL_LEVELS, t)) return t as Profile["skills"][number]["level"];
  if (/expert|精通|专家/.test(t)) return "expert";
  if (/advanced|proficient|高级/.test(t)) return "advanced";
  if (/intermediate|familiar|熟悉|熟练|中级/.test(t)) return "intermediate";
  if (/basic|beginner|了解|入门/.test(t)) return "beginner";
  return null;
}

function achievementKind(title: string, hint: string | null): Profile["achievements"][number]["kind"] {
  if (inEnum(ACHIEVEMENT_KINDS, hint)) return hint as Profile["achievements"][number]["kind"];
  if (/scholarship|奖学金|bursary/i.test(title)) return "scholarship";
  if (/\bgrant\b|funding|基金|资助/i.test(title)) return "grant";
  if (/competition|challenge|hackathon|olympiad|contest|cup|大赛|竞赛|比赛|挑战赛/i.test(title)) return "competition";
  if (/featured|press|interview|forbes|30 under 30|报道/i.test(title)) return "press";
  if (/rank|top \d+|dean'?s list|排名|前\d+%/i.test(title)) return "ranking";
  if (/award|prize|honou?r|medal|winner|notable|奖|荣誉/i.test(title)) return "award";
  return "other";
}

function money(text: string | null | undefined): { amount: number | null; currency: string | null } | null {
  if (!text) return null;
  const m = findMoney(text)[0];
  return m ? { amount: m.amount, currency: m.currency } : null;
}

const STAGE_MAP: Record<string, string> = { pre_seed: "pre_seed", seed: "seed", series_a: "series_a", series_b_plus: "series_b_plus", bootstrapped: "bootstrapped", idea: "idea", mvp: "mvp", profitable: "profitable" };

/** Parses "$73K ARR", "41 paying restaurants", "growing 14% month over month" into F2's traction shape. */
export function parseTraction(lines: string[]): Traction {
  let revenue: Traction["revenue"] = null;
  let users: Traction["users"] = null;
  let growth: Traction["growth"] = null;
  for (const line of lines) {
    if (!revenue && /\b(arr|mrr|revenue|run[- ]rate|gmv|sales)\b|营收|收入|流水/i.test(line)) {
      const m = findMoney(line)[0];
      if (m) {
        const period = /\bmrr\b|per month|monthly|月/i.test(line) ? "month" : /\barr\b|annual|per year|yearly|年/i.test(line) ? "year" : "total";
        revenue = { amount: m.amount, currency: m.currency, period, text: line };
      }
    }
    if (!users) {
      const u = /(\d[\d,.]*\s*[km万]?)\+?\s+((?:paying |active |monthly active |registered |enterprise |b2b )?(?:customers|users|clients|restaurants|merchants|stores|schools|hospitals|teams|companies|businesses|members|subscribers|downloads|mau|dau|pilots))|(\d[\d,.]*)\s*(?:家|个|名|位)?\s*(付费客户|客户|用户|商户|门店|企业|学校|医院)/i.exec(line);
      if (u) {
        const raw = (u[1] ?? u[3] ?? "").replace(/,/g, "").trim();
        const scale = /k$/i.test(raw) ? 1e3 : /m$/i.test(raw) ? 1e6 : /万$/.test(raw) ? 1e4 : 1;
        const count = Math.round(parseFloat(raw) * scale);
        if (Number.isFinite(count)) users = { count, label: (u[2] ?? u[4] ?? "").trim() || null, text: line };
      }
    }
    if (!growth) {
      const g = /(\d+(?:\.\d+)?)\s*%\s*(?:growth\s*)?(month[- ]over[- ]month|mom\b|per month|monthly|week[- ]over[- ]week|wow\b|weekly|quarter[- ]over[- ]quarter|qoq\b|year[- ]over[- ]year|yoy\b|annually|per year)|(月|周|季度|年)(?:环比|同比)?增长\s*(\d+(?:\.\d+)?)\s*%/i.exec(line);
      if (g) {
        const word = (g[2] ?? g[3] ?? "").toLowerCase();
        const period = /month|mom|月/.test(word) ? "month" : /week|wow|周/.test(word) ? "week" : /quarter|qoq|季/.test(word) ? "quarter" : "year";
        growth = { percent: Number(g[1] ?? g[4]), period, text: line };
      }
    }
  }
  return { revenue, users, growth };
}

/* ------------------------------------------------------------------ claims */

function span(start: string | null, end: string | null, current: boolean, lang: Lang): string {
  const fmt = (d: string) => d.replace(/^(\d{4})-(\d{2}).*$/, lang === "zh" ? "$1年$2月" : "$2/$1").replace(/^0/, "");
  if (!start && !end) return "";
  if (!start && end && !current) return lang === "zh" ? `（${fmt(end)}）` : ` (${fmt(end)})`;
  const s = start ? fmt(start) : "?";
  const e = current ? (lang === "zh" ? "至今" : "present") : end ? fmt(end) : lang === "zh" ? "?" : "?";
  return lang === "zh" ? `（${s}–${e}）` : ` (${s}–${e})`;
}

const C = {
  name: (v: string, l: Lang) => (l === "zh" ? `姓名：${v}` : `Name: ${v}`),
  headline: (v: string, l: Lang) => (l === "zh" ? `职业定位：${v}` : `Headline: ${v}`),
  email: (v: string, l: Lang) => (l === "zh" ? `邮箱：${v}` : `Email: ${v}`),
  phone: (v: string, l: Lang) => (l === "zh" ? `电话：${v}` : `Phone: ${v}`),
  location: (v: string, l: Lang) => (l === "zh" ? `所在地：${v}` : `Based in ${v}`),
  birthYear: (v: string, l: Lang) => (l === "zh" ? `出生年份：${v}` : `Born in ${v}`),
  summary: (_v: string, l: Lang) => (l === "zh" ? "个人简介（原文）" : "Profile summary (as written)"),
};

/* ------------------------------------------------------------------ builder */

export interface BuildOptions {
  locale: Lang;
  documents: ExtractDocument[];
  /** Links the person pasted (kept even when not fetched). */
  links?: Array<{ url: string; label?: string | null }>;
  now?: Date;
}

export interface BuildResult {
  profile: Profile;
  facts: ExtractedFact[];
}

function normKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "");
}

export function buildProfile(ir: ExtractionIR, opts: BuildOptions): BuildResult {
  const lang = opts.locale;
  const checker = new QuoteChecker(opts.documents);
  const facts: ExtractedFact[] = [];
  const fact = (path: string, claim: string, value: unknown, s: Src) => {
    const v = checker.verify(s);
    facts.push({ path, claim, value, sourceDocId: v.docId, quote: v.quote.slice(0, 300), confidence: v.confidence });
  };
  const p = profileSchema.parse({});

  /* identity */
  const identityFields = ["name", "headline", "email", "phone", "location", "birthYear", "summary"] as const;
  for (const field of identityFields) {
    const candidates = ir.identity.filter((i) => i.field === field && i.value.trim());
    if (!candidates.length) continue;
    // Prefer the highest-confidence source; ties keep document order (résumés first).
    const best = [...candidates].sort((a, b) => b.src.confidence - a.src.confidence)[0];
    const value = best.value.trim();
    if (field === "summary") {
      p.summary = value.slice(0, 2000);
      fact("/summary", C.summary(value, lang), p.summary, best.src);
    } else if (field === "birthYear") {
      const y = Number(value);
      if (Number.isInteger(y) && y >= 1900 && y <= 2100) {
        p.identity.birthYear = y;
        fact("/identity/birthYear", C.birthYear(value, lang), y, best.src);
      }
    } else if (field === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
      p.identity.email = value.toLowerCase();
      fact("/identity/email", C.email(value, lang), p.identity.email, best.src);
    } else {
      p.identity[field] = value.slice(0, 200);
      fact(`/identity/${field}`, C[field](value, lang), p.identity[field], best.src);
    }
  }
  if (p.identity.location) {
    const cc = countryOfLocation(p.identity.location);
    if (cc) {
      p.identity.countryCode = cc;
      p.identity.city = p.identity.location.split(/[,，]/)[0].trim() || null;
    }
  }

  /* links */
  const seenLinks = new Set<string>();
  const addLink = (url: string, label: string | null, s: Src | null) => {
    const key = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (!url || seenLinks.has(key)) return;
    seenLinks.add(key);
    const kind = linkKind(url);
    p.identity.links.push({ kind, url, label: label ?? null });
    const i = p.identity.links.length - 1;
    if (s) fact(`/identity/links/${i}`, lang === "zh" ? `链接（${kind}）：${url}` : `Link (${kind}): ${url}`, p.identity.links[i], s);
  };
  for (const l of ir.links) addLink(l.url, l.label, l.src);
  for (const l of opts.links ?? []) {
    // Pasted links are the person's own statement: no document quote, confirmed by the act of adding them.
    const before = p.identity.links.length;
    addLink(l.url, l.label ?? null, null);
    if (p.identity.links.length > before) {
      const i = p.identity.links.length - 1;
      facts.push({ path: `/identity/links/${i}`, claim: lang === "zh" ? `本人提供的链接：${l.url}` : `Link added by the person: ${l.url}`, value: p.identity.links[i], sourceDocId: null, quote: l.url, confidence: 1 });
    }
  }

  /* languages */
  const seenLang = new Set<string>();
  for (const l of ir.languages) {
    const code = languageCode(l.name);
    if (!code || seenLang.has(code)) continue;
    seenLang.add(code);
    p.identity.languages.push({ code, level: languageLevel(`${l.level ?? ""} ${l.name}`) });
    const i = p.identity.languages.length - 1;
    fact(`/identity/languages/${i}`, lang === "zh" ? `语言：${l.name}` : `Language: ${l.name}`, p.identity.languages[i], l.src);
  }

  /* work authorization */
  const seenAuth = new Set<string>();
  for (const w of ir.workAuthorization) {
    const cc = (w.countryCode.length === 2 ? w.countryCode : countryCodeFromName(w.countryCode) ?? "").toUpperCase();
    const status = inEnum(WORK_AUTH_STATUSES, w.status);
    if (!/^[A-Z]{2}$/.test(cc) || !status || seenAuth.has(`${cc}:${status}`)) continue;
    seenAuth.add(`${cc}:${status}`);
    p.identity.workAuthorization.push({ countryCode: cc, status, note: w.note });
    const i = p.identity.workAuthorization.length - 1;
    fact(`/identity/workAuthorization/${i}`, lang === "zh" ? `工作许可：${cc} ${status}` : `Work authorization: ${cc} (${status.replace(/_/g, " ")})`, p.identity.workAuthorization[i], w.src);
  }

  /* experience */
  const expIndex = new Map<string, number>();
  for (const e of ir.experience) {
    const organization = e.organization?.trim();
    const title = e.title?.trim();
    if (!organization || !title) continue; // both are required; gaps ask for the rest
    const startDate = date(e.startDate);
    const key = `${normKey(organization)}|${normKey(title)}|${startDate ?? ""}`;
    const existing = expIndex.get(key);
    if (existing !== undefined) {
      const item = p.experience[existing];
      item.highlights = [...new Set([...item.highlights, ...e.highlights])].slice(0, 15);
      continue;
    }
    const id = itemId("exp", organization, title, startDate);
    const occ = mapOccupation(title, { limit: 1, minScore: 0.7 })[0];
    const item: Profile["experience"][number] = {
      id,
      organization,
      title,
      occupation: occ?.code ?? null,
      employmentType: employmentType(e.employmentType),
      industry: null,
      location: e.location ?? null,
      startDate,
      endDate: e.current ? null : date(e.endDate),
      current: e.current,
      summary: e.summary ?? null,
      highlights: e.highlights.filter(Boolean).slice(0, 15),
      skills: e.skills.slice(0, 20),
    };
    p.experience.push(item);
    expIndex.set(key, p.experience.length - 1);
    const claim = lang === "zh" ? `在${organization}担任${title}${span(item.startDate, item.endDate, item.current, lang)}` : `${title} at ${organization}${span(item.startDate, item.endDate, item.current, lang)}`;
    fact(`/experience/${id}`, claim, item, e.src);
  }
  // Most recent first.
  p.experience.sort((a, b) => Number(b.current) - Number(a.current) || (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  /* education */
  const eduIndex = new Map<string, number>();
  for (const e of ir.education) {
    const institution = e.institution?.trim();
    if (!institution) continue;
    const level = LEVEL_MAP[(e.level ?? "").toLowerCase()] ?? null;
    const key = `${normKey(institution)}|${level ?? normKey(e.degree)}`;
    if (eduIndex.has(key)) continue;
    const id = itemId("edu", institution, e.degree ?? level, date(e.endDate));
    const item: Profile["education"][number] = {
      id,
      institution,
      degree: e.degree ?? null,
      level,
      field: e.field ?? null,
      location: e.location ?? null,
      startDate: date(e.startDate),
      endDate: date(e.endDate),
      current: e.current,
      gpa: gpa(e.gpa),
      honors: e.honors.slice(0, 10),
      courses: e.courses.slice(0, 30),
      description: e.description ?? null,
    };
    p.education.push(item);
    eduIndex.set(key, p.education.length - 1);
    const what = [item.degree, item.field].filter(Boolean).join(lang === "zh" ? " " : ", ");
    const claim = lang === "zh" ? `${institution}${what ? ` ${what}` : ""}${span(item.startDate, item.endDate, item.current, lang)}` : `${what ? `${what}, ` : "Studied at "}${institution}${span(item.startDate, item.endDate, item.current, lang)}`;
    fact(`/education/${id}`, claim, item, e.src);
  }
  p.education.sort((a, b) => Number(b.current) - Number(a.current) || (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"));

  /* projects */
  const projSeen = new Set<string>();
  for (const pr of ir.projects) {
    const name = pr.name.trim();
    if (!name || projSeen.has(normKey(name))) continue;
    projSeen.add(normKey(name));
    const id = itemId("prj", name, pr.url);
    const item: Profile["projects"][number] = { id, name, role: pr.role, url: pr.url, startDate: date(pr.startDate), endDate: date(pr.endDate), summary: pr.summary, highlights: pr.highlights.slice(0, 10), skills: pr.skills.slice(0, 15) };
    p.projects.push(item);
    fact(`/projects/${id}`, lang === "zh" ? `项目：${name}${pr.summary ? `——${pr.summary}` : ""}` : `Project: ${name}${pr.summary ? ` — ${pr.summary}` : ""}`, item, pr.src);
  }

  /* skills */
  const skillSeen = new Set<string>();
  for (const s of ir.skills) {
    const name = s.name.trim();
    if (!name || name.length > 60 || skillSeen.has(name.toLowerCase())) continue;
    skillSeen.add(name.toLowerCase());
    p.skills.push({ name, category: skillCategory(name, s.category), level: skillLevel(s.level), years: null });
    const i = p.skills.length - 1;
    fact(`/skills/${i}`, lang === "zh" ? `技能：${name}` : `Skill: ${name}`, p.skills[i], s.src);
  }

  /* achievements */
  const achSeen = new Set<string>();
  for (const a of ir.achievements) {
    const title = a.title.trim();
    if (!title || achSeen.has(normKey(title))) continue;
    achSeen.add(normKey(title));
    const id = itemId("ach", title, a.date);
    const m = money(a.amountText);
    const item: Profile["achievements"][number] = { id, title, kind: achievementKind(title, a.kind), issuer: a.issuer, date: date(a.date), amount: m && m.amount !== null ? { amount: m.amount, currency: m.currency } : null, description: a.description };
    p.achievements.push(item);
    fact(`/achievements/${id}`, lang === "zh" ? `获奖：${title}${a.issuer ? `（${a.issuer}）` : ""}${item.date ? ` ${item.date.slice(0, 4)}` : ""}` : `Award: ${title}${a.issuer ? `, ${a.issuer}` : ""}${item.date ? ` (${item.date.slice(0, 4)})` : ""}`, item, a.src);
  }

  /* publications */
  const pubSeen = new Set<string>();
  const surname = p.identity.name ? p.identity.name.split(/\s+/).pop()!.toLowerCase() : null;
  for (const pb of ir.publications) {
    const title = pb.title.trim();
    if (!title || pubSeen.has(normKey(title))) continue;
    pubSeen.add(normKey(title));
    const id = itemId("pub", title);
    const pos = surname ? pb.authors.findIndex((a) => a.toLowerCase().includes(surname)) : -1;
    const item: Profile["publications"][number] = {
      id,
      title,
      kind: inEnum(PUBLICATION_KINDS, pb.kind) ?? "other",
      status: inEnum(PUBLICATION_STATUSES, pb.status) ?? "published",
      venue: pb.venue,
      year: pb.year && pb.year >= 1900 && pb.year <= 2100 ? pb.year : null,
      authors: pb.authors.slice(0, 30),
      authorPosition: pos >= 0 ? pos + 1 : null,
      doi: pb.doi,
      url: pb.url,
      citations: null,
    };
    p.publications.push(item);
    fact(`/publications/${id}`, lang === "zh" ? `论文：${title}${pb.venue ? `，${pb.venue}` : ""}${item.year ? `（${item.year}）` : ""}` : `Publication: "${title}"${pb.venue ? `, ${pb.venue}` : ""}${item.year ? ` (${item.year})` : ""}`, item, pb.src);
  }

  /* certifications */
  const certSeen = new Set<string>();
  for (const c of ir.certifications) {
    const name = c.name.trim();
    if (!name || certSeen.has(normKey(name))) continue;
    certSeen.add(normKey(name));
    const id = itemId("cer", name, c.issuer);
    const item: Profile["certifications"][number] = { id, name, issuer: c.issuer, credentialId: c.credentialId, jurisdiction: null, issuedAt: date(c.issuedAt), expiresAt: date(c.expiresAt), url: null };
    p.certifications.push(item);
    fact(`/certifications/${id}`, lang === "zh" ? `证书：${name}${c.issuer ? `（${c.issuer}）` : ""}` : `Certification: ${name}${c.issuer ? ` (${c.issuer})` : ""}`, item, c.src);
  }

  /* packs: founder */
  for (const v of ir.ventures) {
    const company = v.company.trim();
    if (!company) continue;
    p.packs.founder ??= { ventures: [] };
    if (p.packs.founder.ventures.some((x) => normKey(x.company) === normKey(company))) continue;
    const id = itemId("ven", company);
    const get = (f: string) => v.fields.find((x) => x.field === f);
    const raising = get("raising");
    const raisingMoney = money(raising?.value);
    const stageField = get("stage")?.value ?? null;
    const teamSizeRaw = get("teamSize")?.value;
    const teamSize = teamSizeRaw && /^\d+$/.test(teamSizeRaw) && Number(teamSizeRaw) > 0 ? Number(teamSizeRaw) : null;
    const industryText = [get("industry")?.value, get("oneLiner")?.value, get("product")?.value].filter(Boolean).join(" ");
    const industry = industryText ? (mapIndustry(industryText, { limit: 1 })[0]?.code ?? null) : null;
    const venture: NonNullable<Profile["packs"]["founder"]>["ventures"][number] = {
      id,
      company,
      oneLiner: get("oneLiner")?.value ?? null,
      website: get("website")?.value ?? null,
      industry,
      stage: inEnum(VENTURE_STAGES, STAGE_MAP[stageField ?? ""] ?? stageField),
      teamSize,
      founded: date(get("founded")?.value),
      location: get("location")?.value ?? null,
      product: get("product")?.value ?? null,
      businessModel: get("businessModel")?.value ?? null,
      traction: parseTraction(v.traction.map((t) => t.text)),
      fundingHistory: [],
      currentRound: raisingMoney && raisingMoney.amount !== null ? { amount: raisingMoney.amount, currency: raisingMoney.currency, instrument: null, valuationCap: null, committed: null } : null,
      role: get("role")?.value ?? null,
      deckDocumentId: v.src.docId,
    };
    p.packs.founder.ventures.push(venture);
    const base = `/packs/founder/ventures/${id}`;
    fact(base, lang === "zh" ? `创办/参与公司：${company}${venture.oneLiner ? `——${venture.oneLiner}` : ""}` : `Company: ${company}${venture.oneLiner ? ` — ${venture.oneLiner}` : ""}`, { company, oneLiner: venture.oneLiner }, v.src);
    const label: Record<string, [string, string]> = {
      oneLiner: ["One-liner", "一句话介绍"],
      website: ["Website", "官网"],
      stage: ["Stage", "阶段"],
      round: ["Round", "轮次"],
      teamSize: ["Team size", "团队规模"],
      product: ["Product / solution", "产品与方案"],
      problem: ["Problem", "要解决的问题"],
      market: ["Market", "市场"],
      businessModel: ["Business model", "商业模式"],
      useOfFunds: ["Use of funds", "资金用途"],
      raising: ["Raising", "本轮融资"],
      role: ["Role", "职务"],
    };
    for (const f of v.fields) {
      if (!label[f.field]) continue;
      const path = f.field === "raising" ? `${base}/currentRound` : `${base}/${f.field}`;
      const value = f.field === "raising" ? venture.currentRound ?? f.value : f.field === "teamSize" ? teamSize ?? f.value : f.value;
      fact(path, `${label[f.field][lang === "zh" ? 1 : 0]}${lang === "zh" ? "：" : ": "}${f.value}`, value, f.src);
    }
    v.traction.forEach((t, i) => fact(`${base}/traction/items/${i}`, lang === "zh" ? `进展：${t.text}` : `Traction: ${t.text}`, t.text, t.src));
    v.team.forEach((m, i) => fact(`${base}/team/${i}`, lang === "zh" ? `团队成员：${m.name}${m.role ? `，${m.role}` : ""}` : `Team: ${m.name}${m.role ? `, ${m.role}` : ""}${m.background ? ` (${m.background})` : ""}`, m, m.src));
  }

  /* packs: job seeker */
  if (ir.jobSeeker.targetTitles.length || ir.jobSeeker.locations.length) {
    const js = (p.packs.jobSeeker ??= { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null });
    for (const t of ir.jobSeeker.targetTitles) {
      // Occupation codes when the title maps cleanly, the person's words otherwise.
      const code = mapOccupation(t.value, { limit: 1, minScore: 0.85 })[0]?.code ?? t.value;
      if (js.targetOccupations.includes(code)) continue;
      js.targetOccupations.push(code);
      fact(`/packs/jobSeeker/targetOccupations/${js.targetOccupations.length - 1}`, lang === "zh" ? `求职意向：${t.value}` : `Target role: ${t.value}`, t.value, t.src);
      for (const f of mapFunction(t.value, { limit: 1 })) if (!js.targetFunctions.includes(f.code as FunctionId)) js.targetFunctions.push(f.code as FunctionId);
    }
    for (const l of ir.jobSeeker.locations) {
      if (js.locations.includes(l.value)) continue;
      js.locations.push(l.value);
      fact(`/packs/jobSeeker/locations/${js.locations.length - 1}`, lang === "zh" ? `期望城市：${l.value}` : `Wants to work in ${l.value}`, l.value, l.src);
    }
    if (p.identity.workAuthorization.some((w) => w.status === "needs_sponsorship")) js.needsSponsorship = true;
  }

  /* packs: student */
  const currentStudy = p.education.find((e) => e.current);
  if (currentStudy || ir.testScores.length) {
    const st = (p.packs.student ??= { gpa: null, testScores: [], targetDegree: null, targetFields: [], targetCountries: [], budget: null, graduationDate: null, internshipMonths: null, availableFrom: null });
    if (currentStudy) {
      st.gpa = currentStudy.gpa;
      st.graduationDate = currentStudy.endDate;
    }
    for (const t of ir.testScores) {
      if (st.testScores.some((x) => x.test === t.test)) continue;
      st.testScores.push({ test: t.test, score: t.score || "—", date: null });
      fact(`/packs/student/testScores/${st.testScores.length - 1}`, lang === "zh" ? `考试成绩：${t.test} ${t.score}` : `Test score: ${t.test} ${t.score}`, st.testScores[st.testScores.length - 1], t.src);
    }
  }

  /* packs: researcher */
  const r = ir.research;
  if (r.fields.length || r.hIndex || r.orcid || r.grants.length || p.publications.length >= 2) {
    const rp = (p.packs.researcher ??= { fields: [], hIndex: null, citations: null, grants: [], advisors: [], scholarUrl: null, orcid: null, targetVenues: [], targetTier: null });
    for (const f of r.fields) {
      if (rp.fields.includes(f.value)) continue;
      rp.fields.push(f.value);
      fact(`/packs/researcher/fields/${rp.fields.length - 1}`, lang === "zh" ? `研究方向：${f.value}` : `Research area: ${f.value}`, f.value, f.src);
    }
    if (r.hIndex) {
      rp.hIndex = r.hIndex.value;
      fact("/packs/researcher/hIndex", `h-index: ${r.hIndex.value}`, r.hIndex.value, r.hIndex.src);
    }
    if (r.orcid) {
      rp.orcid = r.orcid.value;
      fact("/packs/researcher/orcid", `ORCID iD: ${r.orcid.value}`, r.orcid.value, r.orcid.src);
    }
    rp.scholarUrl = p.identity.links.find((l) => l.kind === "scholar")?.url ?? null;
    for (const g of r.grants) {
      const m = money(g.amountText);
      rp.grants.push({ title: g.title, funder: g.funder, amount: m && m.amount !== null ? { amount: m.amount, currency: m.currency } : null, role: null, startDate: g.year ? String(g.year) : null, endDate: null });
      fact(`/packs/researcher/grants/${rp.grants.length - 1}`, lang === "zh" ? `基金/资助：${g.title}${g.funder ? `（${g.funder}）` : ""}` : `Grant: ${g.title}${g.funder ? ` (${g.funder})` : ""}${g.year ? `, ${g.year}` : ""}`, rp.grants[rp.grants.length - 1], g.src);
    }
  }

  /* packs: creator */
  if (ir.creator.audience.length || ir.creator.brands.length) {
    const cp = (p.packs.creator ??= { disciplines: [], styles: [], audienceMetrics: [], rates: null, brandsWorkedWith: [], portfolioUrls: [] });
    for (const a of ir.creator.audience) {
      cp.audienceMetrics.push({ platform: a.platform, handle: null, url: a.url, followers: a.followers === null ? null : Math.round(a.followers), avgViews: null, engagementRate: null });
      fact(`/packs/creator/audienceMetrics/${cp.audienceMetrics.length - 1}`, lang === "zh" ? `受众：${a.platform} ${a.followers ?? ""}` : `Audience: ${a.followers ?? "?"} on ${a.platform}`, cp.audienceMetrics[cp.audienceMetrics.length - 1], a.src);
    }
    for (const b of ir.creator.brands) {
      if (cp.brandsWorkedWith.includes(b.value)) continue;
      cp.brandsWorkedWith.push(b.value);
      fact(`/packs/creator/brandsWorkedWith/${cp.brandsWorkedWith.length - 1}`, lang === "zh" ? `合作品牌/客户：${b.value}` : `Worked with ${b.value}`, b.value, b.src);
    }
    cp.portfolioUrls = p.identity.links.filter((l) => ["portfolio", "behance", "dribbble", "website"].includes(l.kind)).map((l) => l.url);
  }

  /* packs: professional */
  if (ir.licenses.length) {
    const pp = (p.packs.professional ??= { licenses: [], practiceLocation: null, yearsInPractice: null, specialties: [] });
    for (const l of ir.licenses) {
      pp.licenses.push({ type: l.type, number: l.number, jurisdiction: l.jurisdiction, issuedAt: null, expiresAt: date(l.expiresAt), status: null });
      fact(`/packs/professional/licenses/${pp.licenses.length - 1}`, lang === "zh" ? `执业资格：${l.type}` : `License: ${l.type}`, pp.licenses[pp.licenses.length - 1], l.src);
    }
  }

  /* functions & industries (mapped, never asked) */
  const functions = new Set<FunctionId>();
  for (const e of p.experience.slice(0, 4)) for (const f of mapFunction(e.title, { limit: 1 })) functions.add(f.code as FunctionId);
  if (p.identity.headline) for (const f of mapFunction(p.identity.headline, { limit: 1 })) functions.add(f.code as FunctionId);
  p.functions = [...functions].slice(0, 5);
  p.occupations = [...new Set(p.experience.slice(0, 4).map((e) => e.occupation).filter((o): o is string => Boolean(o)))];
  const industries = new Set<string>();
  for (const v of p.packs.founder?.ventures ?? []) if (v.industry) industries.add(v.industry);
  // Organisation names and the person's own summary; bullet points are too noisy ("built an app").
  for (const e of p.experience.slice(0, 3)) {
    const m = mapIndustry(e.organization, { limit: 1, minScore: 0.6 })[0];
    if (m) industries.add(m.code);
  }
  if (p.summary) for (const m of mapIndustry(p.summary.slice(0, 300), { limit: 2, minScore: 0.7 })) industries.add(m.code);
  p.industries = [...industries].slice(0, 5);

  /* professional years (for E stages and matching) */
  const workYears = totalYears(
    p.experience.filter((e) => e.employmentType !== "internship" && e.employmentType !== "volunteer").map((e) => ({ start: e.startDate, end: e.endDate, current: e.current })),
    opts.now,
  );
  if (p.packs.professional && workYears > 0) p.packs.professional.yearsInPractice = workYears;

  const parsed = profileSchema.safeParse(p);
  if (!parsed.success) {
    // Construction should never produce an invalid profile; if it does, keep what validates.
    console.error("[llm/build] profile failed validation", parsed.error.issues.slice(0, 5));
    return { profile: profileSchema.parse(JSON.parse(JSON.stringify({ ...p, packs: {} }))), facts };
  }
  return { profile: parsed.data, facts };
}

/** Years of professional experience (internships and volunteering excluded, overlaps merged). */
export function professionalYears(profile: Profile, now?: Date): number {
  return totalYears(
    profile.experience.filter((e) => e.employmentType !== "internship" && e.employmentType !== "volunteer").map((e) => ({ start: e.startDate, end: e.endDate, current: e.current })),
    now,
  );
}
