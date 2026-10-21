/*
 * Shared mapping helpers for every source: HTML → clean text, summaries, slugs, job type
 * detection, functions / industries / tags, money and fee parsing, materials, hashes and
 * quality scores. Pure functions (node:crypto for hashing only); tested in
 * tests/sources-normalize.test.ts.
 *
 * Honesty: these helpers only restate what the source says. When a value cannot be read with
 * confidence it is null / empty ("check the official page"), never a plausible guess.
 */
import { createHash } from "node:crypto";
import { mapFunction } from "@/lib/core/functions";
import { mapIndustry } from "@/lib/core/industries";
import type { BENEFIT_MONEY_KINDS, FunctionId, MaterialId, Money, OpportunityTypeId, RemoteMode } from "@/lib/core/types";
import { isMaterialId } from "@/lib/core/materials";
import type { JobType } from "./types";

/* ================================================================== text */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", prime: "′",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢", times: "×", divide: "÷",
  laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", sect: "§", para: "¶", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", ograve: "ò", ugrave: "ù", acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", ntilde: "ñ", Ntilde: "Ñ",
  ccedil: "ç", Ccedil: "Ç", atilde: "ã", otilde: "õ", aring: "å", Aring: "Å", aelig: "æ", oslash: "ø", Oslash: "Ø", zwj: "", zwnj: "", lrm: "", rlm: "",
};

/** Decodes HTML entities (named, decimal, hex). Unknown named entities are left as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,8});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

const BLOCK_TAGS = "p|div|section|article|header|footer|aside|main|h[1-6]|ul|ol|table|tr|blockquote|pre|hr|figure|figcaption|dl|dt|dd|details|summary";

/**
 * HTML → paragraphs of plain text. Handles HTML that arrives entity-escaped once more
 * (Greenhouse `content`), lists ("• item"), line breaks and headings (kept as their own
 * paragraph so section detection works). Never throws on broken markup.
 */
export function htmlToParagraphs(input: string | null | undefined): string[] {
  if (!input) return [];
  let html = input;
  // Escaped once more than normal: "&lt;p&gt;Hello&lt;/p&gt;".
  if (!/<[a-z!/]/i.test(html) && /&lt;\/?[a-z]/i.test(html)) html = decodeEntities(html);
  html = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n\n")
    .replace(/<(?:td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(html)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    // "<li><p>text</p></li>": keep the bullet on the same line as its text.
    .replace(/\u2022[ \t]*\n+[ \t\n]*/g, "\u2022 ");
  return plainToParagraphs(text);
}

/** Plain text → paragraphs (blank-line separated; bullet lines become their own paragraphs). */
export function plainToParagraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/)) {
    const lines = block
      .split("\n")
      .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
      .filter((l) => l.length > 0 && !/^[•·\-–—*]+$/.test(l));
    if (!lines.length) continue;
    // A block of bullet lines stays one line per bullet; prose lines are joined.
    const bullets = lines.filter((l) => /^[•·\-–*]\s/.test(l)).length;
    if (bullets >= Math.max(1, lines.length / 2)) {
      for (const l of lines) out.push(l.replace(/^[•·\-–*]\s*/, "• "));
    } else {
      out.push(lines.join(" "));
    }
  }
  return out;
}

export function htmlToText(input: string | null | undefined): string {
  return htmlToParagraphs(input).join("\n\n");
}

/** Clips at a sentence (or word) boundary, never mid-word; adds "…" when anything was cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("。"));
  if (sentenceEnd >= max * 0.5) return window.slice(0, sentenceEnd + 1).trim();
  const space = window.lastIndexOf(" ");
  const cut = space >= max * 0.6 ? window.slice(0, space) : window.slice(0, max - 1);
  return `${cut.replace(/[\s,;:–—-]+$/, "")}…`;
}

const ROLE_HEADING_RE =
  /^(?:#+\s*)?(?:about (?:the|this) (?:role|job|position|opportunity|team)|the role|role overview|role summary|your role|the opportunity|the position|position (?:summary|overview|description)|job (?:summary|description|overview|purpose)|what you(?:'|’)?ll do|what you will do|what you(?:'|’)ll be doing|what you will be doing|what will you be doing|what you(?:'|’)ll work on|your mission|the mission|overview of the role|role description|in this role|meet the team|the team|your team|your responsibilities|your tasks|your impact|your role|responsibilities|key responsibilities|你的职责|岗位职责|职位描述|工作职责)\b/i;
/** Sentences that introduce the role itself. */
const STRONG_ROLE_CUE_RE =
  /\b(?:we(?:'|’)re (?:looking|hiring|seeking|searching)|we are (?:looking|hiring|seeking|searching)|is (?:looking|seeking|hiring) (?:for )?(?:a|an)\b|are looking for|this role|in this role|this position|as (?:a|an|our) [A-Z])|岗位职责|职位描述/;
/** Sentences that talk to the candidate (weaker: companies say "you'll" about culture too). */
const WEAK_ROLE_CUE_RE = /\b(?:you will|you(?:'|’)ll|will be responsible|responsible for)\b|负责/i;
const COMPANY_INTRO_RE =
  /\b(?:is a (?:global|leading|fast[- ]growing|world|pioneering|next[- ]generation|venture)|founded in|founded by|our (?:goal|mission|vision|purpose|values) (?:is|are)|we are a|we(?:'|’)re a (?:global|leading|team)|backed by|headquartered|for more than a decade|trusted by|our customers include|category[- ]defining company|what sets us apart|why (?:join|work (?:at|with))|life at|our culture|we(?:'|’)re on (?:a|an) (?:mission|journey|adventure|exciting)|what it(?:'|’)s like to work)\b/i;

/** A paragraph about the company rather than the role. */
function isCompanyIntro(p: string, org: string): boolean {
  const lower = p.toLowerCase();
  return COMPANY_INTRO_RE.test(p) || (org.length > 1 && new RegExp(`^${org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:is|was) (?:a|an|the|one)\\b`).test(lower)) || /^at [^,]{2,40}, (?:we|you|our)/i.test(p);
}
const TITLE_STOP = new Set(["senior", "junior", "lead", "staff", "principal", "head", "the", "and", "for", "with", "remote", "hybrid", "contract", "full", "time", "part", "intern", "internship", "team", "level"]);
const BOILERPLATE_RE =
  /(equal (?:employment )?opportunity|\beeo\b|reasonable accommodation|without regard to|privacy (?:notice|policy)|cookie|e-?verify|right to work|background check|pay transparency|salary range|compensation range|benefits include|we offer|our benefits|perks|#li-|applicants (?:with|who)|data protection|recruitment fraud|agency|by applying|applicant privacy)/i;

function isHeading(p: string): boolean {
  if (p.startsWith("• ")) return false;
  return p.length <= 70 && !/[.!?。:：]$/.test(p) && p.split(/\s+/).length <= 9;
}

function isMeaningful(p: string, min = 60): boolean {
  // A lead-in to a list ("As a Senior Engineer, you will:") or a shouted line is not a summary.
  const shouted = p.replace(/[^A-Za-z]/g, "").length > 20 && p === p.toUpperCase();
  return p.length >= min && !p.startsWith("• ") && !/[:：]\s*$/.test(p) && !shouted && !BOILERPLATE_RE.test(p) && !isHeading(p);
}

/** Index of the first paragraph of the role section ("About the role", "What you'll do"…), or -1. */
export function roleSectionStart(paragraphs: string[]): number {
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].replace(/[:：]\s*$/, "");
    if (p.length <= 80 && ROLE_HEADING_RE.test(p)) return i;
  }
  return -1;
}

/**
 * The first meaningful paragraph about the role, ≤ `max` characters: the paragraph after a
 * role heading ("The Role", "Your responsibilities"…); else the best paragraph that talks about
 * the role (role cues, the title's own words) rather than the company ("X is a global…",
 * "our mission is…"); else the first substantial non-boilerplate paragraph. Null when nothing qualifies.
 */
export function summarize(paragraphs: string[], opts: { max?: number; title?: string; org?: string } | number = {}): string | null {
  const o = typeof opts === "number" ? { max: opts } : opts;
  const max = o.max ?? 320;
  const org = (o.org ?? "").toLowerCase().trim();
  const strip = (p: string) => p.replace(ROLE_HEADING_RE, "").replace(/^[\s:：–—-]+/, "").trim();
  const start = roleSectionStart(paragraphs);
  if (start >= 0) {
    const inline = strip(paragraphs[start]);
    if (inline.length >= 60) return clip(inline, max);
    for (let i = start + 1; i < Math.min(paragraphs.length, start + 6); i++) {
      const p = paragraphs[i];
      if (isMeaningful(p, 50) && !isCompanyIntro(p, org)) return clip(p, max);
      if (p.startsWith("• ")) {
        // The role section opens with its duties: the first two say what the job is.
        const duties = paragraphs.slice(i, i + 2).filter((x) => x.startsWith("• ")).map((x) => x.slice(2).replace(/[.;]?$/, "."));
        const joined = duties.join(" ");
        if (joined.length >= 40) return clip(joined, max);
        break;
      }
      if (isHeading(p)) break;
    }
  }
  const titleWords = (o.title ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}&+#]+/u)
    .filter((w) => w.length >= 3 && !TITLE_STOP.has(w));
  let best: { p: string; score: number } | null = null;
  paragraphs.slice(0, 30).forEach((p, i) => {
    if (!isMeaningful(p)) return;
    const lower = p.toLowerCase();
    let score = 0;
    if (STRONG_ROLE_CUE_RE.test(p)) score += 3;
    else if (WEAK_ROLE_CUE_RE.test(p)) score += 1;
    if (titleWords.some((w) => lower.includes(w))) score += 2;
    if (isCompanyIntro(p, org)) score -= 3;
    score -= i / 20;
    if (score >= 2.5 && (!best || score > best.score)) best = { p, score };
  });
  if (best) return clip((best as { p: string }).p, max);
  // Nothing about the role itself: better no summary (callers state the facts) than company boilerplate.
  const first = paragraphs.find((p) => isMeaningful(p, 80) && !isCompanyIntro(p, org) && STRONG_ROLE_CUE_RE.test(p));
  return first ? clip(first, max) : null;
}

/**
 * Stored description: from the role section when there is one (company boilerplate repeats on
 * every posting), else from the start; boilerplate paragraphs dropped; at most `max` characters,
 * cut at a paragraph boundary.
 */
export function describe(paragraphs: string[], max = 1600): string | null {
  const start = roleSectionStart(paragraphs);
  const body = (start >= 0 ? paragraphs.slice(start) : paragraphs).filter((p) => !BOILERPLATE_RE.test(p) || p.length > 400);
  const out: string[] = [];
  let len = 0;
  for (const p of body) {
    if (len + p.length + 2 > max) {
      if (!out.length) out.push(clip(p, max));
      else if (len < max * 0.6) out.push(clip(p, max - len - 2));
      break;
    }
    out.push(p);
    len += p.length + 2;
  }
  const text = out.join("\n\n").trim();
  return text.length ? text : null;
}

/* ================================================================== slugs, hashes */

/** URL-safe kebab slug (ASCII); empty string when nothing Latin remains. */
export function slugify(input: string, max = 80): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dash = cut.lastIndexOf("-");
  return (dash > max * 0.5 ? cut.slice(0, dash) : cut).replace(/-+$/, "");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** JSON with sorted keys, so equal values always hash the same. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function contentHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/** Organisation slug used across sources (`/organizations/<slug>`). */
export function orgSlugOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = slugify(name, 60);
  return s || `org-${sha256Hex(name).slice(0, 10)}`;
}

/** Job slug: title + org + a short stable hash of (provider, board, posting) — unique across boards. */
export function jobSlug(title: string, org: string, provider: string, board: string, postingId: string): string {
  const base = [slugify(title, 60), slugify(org, 30)].filter(Boolean).join("-") || "job";
  return `${base}-${sha256Hex(`${provider}:${board}:${postingId}`).slice(0, 8)}`;
}

/* ================================================================== jobs */

const INTERN_RE = /\b(?:interns?|internships?|co-?op|werkstudent(?:in)?|working student|praktikant(?:in)?|praktikum|stagiaire|apprentice(?:ship)?s?|summer analyst|summer associate)\b|\bstage\s*(?:\(h\/f\)|h\/f|de fin d['’]études)|实习|インターン/i;
const PART_TIME_RE = /\b(part[- ]?time|teilzeit|temps partiel|medio tiempo|tiempo parcial)\b|兼职|パートタイム|アルバイト/i;

/** job / internship / part_time / remote_job, from the title, the provider's employment type and the remote mode. */
export function detectJobType(input: { title: string; employmentType?: string | null; remote?: RemoteMode | null }): JobType {
  const et = (input.employmentType ?? "").toLowerCase().replace(/[_\s-]+/g, "");
  if (/intern|apprentice|coop|werkstudent/.test(et) || INTERN_RE.test(input.title)) {
    // "Intern Program Manager" / "Internship Coordinator" are jobs that manage interns.
    if (!/\b(intern(?:ship)?s?\s+(program|programme|recruit|coordinator|manager|lead))\b/i.test(input.title) || /intern/.test(et)) return "internship";
  }
  if (/parttime/.test(et) || PART_TIME_RE.test(input.title)) return "part_time";
  if (input.remote === "remote") return "remote_job";
  return "job";
}

/** Postings that are talent pools, not roles ("Join our Talent Community", "General Application"). */
export function isGeneralApplication(title: string): boolean {
  return /\b(talent (?:community|pool|network|pipeline)|general (?:application|interest)|open application|future (?:opportunities|roles|openings)|don(?:'|’)?t see (?:a|the|your) (?:role|job|position)|spontaneous application|initiativbewerbung|expression of interest)\b/i.test(title);
}

const SENIORITY: Array<[RegExp, string]> = [
  [/\b(interns?|internships?|co-?op|werkstudent|working student|praktik)/i, "internship"],
  [/\b(new grad(?:uate)?|graduate|entry[- ]level|junior|jr\.?)\b|^associate\b(?! (?:director|manager|partner|principal|general counsel|vice))/i, "entry-level"],
  [/\b(senior|sr\.?)\b/i, "senior"],
  [/\b(staff)\b/i, "staff"],
  [/\b(principal|distinguished)\b/i, "principal"],
  [/\b(lead|tech lead)\b(?! generation)/i, "lead"],
  [/\b(manager|management)\b/i, "manager"],
  [/\b(director|head of)\b/i, "director"],
  [/\b(vp|vice president|chief|cto|ceo|cfo|coo|cmo|cpo)\b/i, "executive"],
];

/** Skills and domains worth a tag when a posting names them. Order = tag priority; `text` = also read from descriptions. */
const SKILLS: Array<[tag: string, re: RegExp, text: boolean]> = [
  ["machine learning", /\bmachine learning\b|\bml (?:engineer|infrastructure|platform|research)/i, true], ["ai", /\b(artificial intelligence|ai|genai|generative ai)\b/i, false],
  ["llm", /\b(llms?|large language models?)\b/i, true], ["computer vision", /\bcomputer vision\b/i, true], ["nlp", /\b(nlp|natural language processing)\b/i, true],
  ["data science", /\bdata scien(?:ce|tist)\b/i, true], ["data engineering", /\bdata engineer(?:ing)?\b/i, true], ["analytics", /\banalytics\b/i, false],
  ["python", /\bpython\b/i, true], ["java", /\bjava\b(?!script)/i, true], ["javascript", /\bjavascript\b/i, true], ["typescript", /\btypescript\b/i, true],
  ["go", /\bgolang\b|\(go\)|\bgo (?:developer|engineer)\b|,\s*go$/i, true], ["rust", /\brust\b/i, true], ["c++", /\bc\+\+/i, true], ["c#", /\bc#/i, true],
  ["kotlin", /\bkotlin\b/i, true], ["swift", /\bswift\b/i, true], ["ruby", /\bruby\b/i, true], ["php", /\bphp\b/i, true], ["scala", /\bscala\b/i, true],
  ["react", /\breact(?:\.js|js)?\b(?! native)/i, true], ["react native", /\breact native\b/i, true], ["node.js", /\bnode(?:\.js|js)\b/i, true],
  ["vue", /\bvue(?:\.js)?\b/i, true], ["angular", /\bangular\b/i, true], ["ios", /\bios\b/i, true], ["android", /\bandroid\b/i, true], ["sql", /\bsql\b/i, true],
  ["postgresql", /\bpostgres(?:ql)?\b/i, true], ["spark", /\b(?:apache )?spark\b/i, true], ["kafka", /\bkafka\b/i, true], ["aws", /\b(?:aws|amazon web services)\b/i, true],
  ["gcp", /\b(?:gcp|google cloud)\b/i, true], ["azure", /\bazure\b/i, true], ["kubernetes", /\b(?:kubernetes|k8s)\b/i, true], ["docker", /\bdocker\b/i, true],
  ["terraform", /\bterraform\b/i, true], ["linux", /\blinux\b/i, true], ["distributed systems", /\bdistributed systems\b/i, true],
  ["security", /\b(?:security|infosec|appsec)\b/i, false], ["devops", /\b(?:devops|sre|site reliability)\b/i, true], ["embedded", /\b(?:embedded|firmware)\b/i, true],
  ["robotics", /\brobotics?\b/i, false], ["hardware", /\bhardware\b/i, false], ["fpga", /\bfpga\b/i, true], ["figma", /\bfigma\b/i, true],
  ["ux", /\b(?:ux|user experience)\b/i, false], ["product design", /\bproduct design(?:er)?\b/i, false], ["seo", /\bseo\b/i, true], ["salesforce", /\bsalesforce\b/i, true],
  ["excel", /\bexcel\b/i, false], ["financial modeling", /\bfinancial model(?:l)?ing\b/i, true], ["accounting", /\baccounting\b/i, false], ["b2b", /\bb2b\b/i, false],
  ["saas", /\bsaas\b/i, false], ["enterprise sales", /\benterprise (?:sales|account)/i, false], ["customer support", /\b(?:customer|technical) support\b/i, false],
  ["content", /\bcontent (?:writer|writing|strategy|marketing|creator)\b/i, false], ["copywriting", /\bcopywrit(?:ing|er)\b/i, false],
  ["video", /\bvideo (?:editor|editing|production)\b/i, false], ["research", /\bresearch(?:er)?\b/i, false], ["phd", /\bph\.?d\b/i, false], ["clinical", /\bclinical\b/i, false],
  ["nursing", /\bnurs(?:e|ing)\b/i, false], ["legal", /\b(?:counsel|attorney|paralegal)\b/i, false],
];

/** Tags from the title (all skills found) and the description (only strong signals). At most 12. */
export function jobTags(input: { title: string; text?: string | null; employmentType?: string | null; remote?: RemoteMode | null; regions?: string[]; general?: boolean }): string[] {
  const tags: string[] = [];
  const add = (t: string) => {
    if (t && !tags.includes(t)) tags.push(t);
  };
  for (const [re, tag] of SENIORITY) if (re.test(input.title)) add(tag);
  const et = (input.employmentType ?? "").toLowerCase();
  if (/contract|freelance|temporary|temp\b|fixed[- ]term/.test(et) || /\b(contract|fixed[- ]term|temporary|freelance)\b/i.test(input.title)) add("contract");
  else if (/part/.test(et)) add("part-time");
  else if (/full/.test(et)) add("full-time");
  if (input.remote) add(input.remote);
  for (const r of input.regions ?? []) if (r !== "Worldwide") add(r.toLowerCase());
  if (input.general) add("general application");
  for (const [tag, re] of SKILLS) if (re.test(input.title)) add(tag);
  const text = (input.text ?? "").slice(0, 4000);
  if (text) {
    const counts = SKILLS.filter(([, , fromText]) => fromText)
      .map(([tag, re]) => [tag, (text.match(new RegExp(re.source, "gi")) ?? []).length] as const)
      .filter(([, n]) => n >= 2);
    counts.sort((a, b) => b[1] - a[1]);
    for (const [tag] of counts.slice(0, 6)) add(tag);
  }
  return tags.slice(0, 12);
}

/** Department names that `mapFunction` reads poorly ("People", "G&A", "IT", "Account Executives"). */
const GENERAL_DEPARTMENT_RE = /\b(?:applications? \(general\)|general applications?|talent community|talent pool)/i;
const FUNCTION_RULES: Array<[RegExp, FunctionId[]]> = [
  [/\b(account executives?|account management|sales development|sdr|bdr|business development|partnerships?|alliances|revenue)\b/i, ["sales"]],
  [/\b(people|talent acquisition|recruit(ing|ment)|hr|human resources|workplace)\b/i, ["people"]],
  [/\b(g&a|general (and|&) administrative|administration|office)\b/i, ["admin"]],
  [/\b(it|information technology|corporate systems|helpdesk)\b/i, ["engineering", "operations"]],
  [/\b(security|infosec|trust (and|&) safety)\b/i, ["engineering"]],
  [/\b(technical support|support|customer experience|cx|customer success|solutions)\b/i, ["customer-success"]],
  [/\b(engineering|software|platform|infrastructure|r&d|developer)\b/i, ["engineering"]],
  [/\b(data|analytics|business intelligence)\b/i, ["data"]],
  [/\b(product management|product)\b/i, ["product"]],
  [/\b(design|ux|ui|creative)\b/i, ["design"]],
  [/\b(marketing|growth|brand|communications|comms|pr)\b/i, ["marketing"]],
  [/\b(finance|accounting|fp&a|treasury|tax|payroll)\b/i, ["finance"]],
  [/\b(legal|compliance|policy|regulatory)\b/i, ["legal"]],
  [/\b(operations|ops|bizops|strategy)\b/i, ["operations"]],
  [/\b(research|science|scientist|lab)\b/i, ["research"]],
  [/\b(manufacturing|production|assembly|machining)\b/i, ["manufacturing"]],
  [/\b(supply chain|procurement|logistics|sourcing)\b/i, ["supply-chain"]],
  [/\b(quality|qa|test)\b/i, ["quality"]],
  [/\b(clinical|medical|nursing|care)\b/i, ["clinical"]],
];

/** Function ids for a posting: what the title says (one), then the department/team names. At most 2. */
export function jobFunctions(departments: string[], title: string): FunctionId[] {
  const out: FunctionId[] = [];
  const push = (ids: readonly string[]) => {
    for (const id of ids) if (!out.includes(id as FunctionId) && out.length < 2) out.push(id as FunctionId);
  };
  if (!isGeneralApplication(title)) {
    const byTitle = mapFunction(title, { limit: 1, minScore: 0.9 }).map((m) => m.code);
    if (byTitle.length && byTitle[0] !== "executive") push(byTitle);
    else push(FUNCTION_RULES.find(([re]) => re.test(title))?.[1] ?? []);
  }
  for (const d of departments) {
    if (GENERAL_DEPARTMENT_RE.test(d)) continue;
    const rules = FUNCTION_RULES.filter(([re]) => re.test(d));
    if (rules.length) for (const [, ids] of rules) push(ids);
    else push(mapFunction(d, { limit: 2, minScore: 0.9 }).map((m) => m.code));
  }
  return out;
}

/** Free-text industry words the core matcher reads poorly → industry codes. */
const INDUSTRY_ALIASES: Record<string, string[]> = {
  any: [], "any tech": [], technology: ["software-internet"], tech: ["software-internet"], "deep tech": ["advanced-manufacturing", "basic-sciences"],
  "frontier tech": ["advanced-manufacturing"], "emerging tech": ["software-internet"], "digital tech": ["software-internet"], digital: ["software-internet"],
  health: ["life-sciences-healthcare"], "health care": ["life-sciences-healthcare"], healthtech: ["life-sciences-healthcare.digital-health"],
  biomedical: ["life-sciences-healthcare"], medicine: ["life-sciences-healthcare"], therapeutics: ["life-sciences-healthcare.pharma"], oncology: ["life-sciences-healthcare"],
  data: ["ai-data.data-science"], "data science": ["ai-data.data-science"], ml: ["ai-data"], agents: ["ai-data.generative-ai"], "ai infrastructure": ["ai-data.ml-platforms"],
  mobility: ["transport-logistics", "advanced-manufacturing.automotive-ev"], automotive: ["advanced-manufacturing.automotive-ev"], transportation: ["transport-logistics"],
  research: ["basic-sciences"], "computer science": ["software-internet", "basic-sciences"], computing: ["software-internet"], hpc: ["software-internet.cloud-infrastructure"],
  "scientific computing": ["basic-sciences"], "theoretical computer science": ["basic-sciences.mathematics"], hr: ["professional-services.hr-recruiting"], talent: ["professional-services.hr-recruiting"],
  engineering: ["advanced-manufacturing"], consumer: ["consumer-retail"], creator: ["media-entertainment.live-streaming-short-video"], "creator economy": ["media-entertainment.live-streaming-short-video"],
  food: ["agriculture-food"], agrifood: ["agriculture-food"], "food systems": ["agriculture-food"], agritech: ["agriculture-food.agtech"], materials: ["advanced-manufacturing.advanced-materials"],
  "new materials": ["advanced-manufacturing.advanced-materials"], "raw materials": ["advanced-manufacturing.advanced-materials"], mining: ["energy-environment"],
  "public service": ["law-government.government"], "public sector": ["law-government.government"], "public administration": ["law-government.government"], govtech: ["law-government.government"],
  "social impact": ["public-nonprofit"], "international development": ["law-government.international-organizations"], development: ["law-government.international-organizations"],
  "sustainable development": ["energy-environment.environment-carbon"], sdgs: ["public-nonprofit"], humanitarian: ["law-government.ngo"], "human rights": ["law-government.ngo"],
  tv: ["media-entertainment.film-tv"], documentary: ["media-entertainment.film-tv"], animation: ["media-entertainment.film-tv"], video: ["media-entertainment.film-tv"],
  environment: ["energy-environment.environment-carbon"], water: ["energy-environment.environment-carbon"], "nature tech": ["energy-environment.environment-carbon"],
  trading: ["finance.securities-ib"], investing: ["finance.asset-management"], "investment management": ["finance.asset-management"], "venture capital": ["finance.vc-pe"],
  defense: ["advanced-manufacturing.aerospace"], defence: ["advanced-manufacturing.aerospace"], adtech: ["media-entertainment.advertising-marketing"],
  martech: ["media-entertainment.advertising-marketing"], marketing: ["media-entertainment.advertising-marketing"], business: ["professional-services"], management: ["professional-services.management-consulting"],
  consulting: ["professional-services.management-consulting"], dance: ["design-arts.visual-arts"], performance: ["media-entertainment"], theatre: ["media-entertainment"],
  creative: ["design-arts"], curating: ["design-arts.visual-arts"], "media art": ["design-arts.visual-arts"], "digital art": ["design-arts.visual-arts"], "media arts": ["design-arts.visual-arts"],
  legal: ["law-government"], law: ["law-government"], devops: ["software-internet.cloud-infrastructure"], enterprise: ["software-internet.saas"], "enterprise software": ["software-internet.saas"],
  "b2b software": ["software-internet.saas"], b2b: ["software-internet.saas"], automation: ["advanced-manufacturing.industrial-software"], web: ["software-internet"], productivity: ["software-internet.application-software"],
  privacy: ["software-internet.cybersecurity"], policy: ["law-government.policy-research"], stem: ["basic-sciences"], "international affairs": ["social-sciences-humanities.politics-ir"],
  startups: [], entrepreneurship: [], "small business": [], "rural development": ["agriculture-food"], "digital assets": ["software-internet.blockchain"], xr: ["hardware-electronics.consumer-electronics"],
  vr: ["hardware-electronics.consumer-electronics"], ar: ["hardware-electronics.consumer-electronics"], "ar/vr": ["hardware-electronics.consumer-electronics"], connectivity: ["hardware-electronics.telecom-equipment"],
  "low-altitude economy": ["advanced-manufacturing.aerospace"], "smart cities": ["real-estate-construction.urban-planning"], proptech: ["real-estate-construction"], "real-estate": ["real-estate-construction"],
  javascript: ["software-internet.developer-tools"], react: ["software-internet.developer-tools"], java: ["software-internet.developer-tools"], ".net": ["software-internet.developer-tools"],
  linux: ["software-internet.developer-tools"], "low-code": ["software-internet.developer-tools"], microsoft: ["software-internet"], social: ["software-internet.social-content"],
  search: ["software-internet.consumer-internet"], language: ["professional-services.translation-localization"], languages: ["social-sciences-humanities.language-literature"], audio: ["media-entertainment.music"],
  nuclear: ["energy-environment.power-grid"], "it": ["software-internet"], "it support": ["software-internet"], networking: ["hardware-electronics.telecom-equipment"], gis: ["basic-sciences.earth-space"],
  geography: ["social-sciences-humanities"], governance: ["law-government"], "civic engagement": ["public-nonprofit"], "civil society": ["public-nonprofit"], "public health": ["life-sciences-healthcare.public-health"],
  "ai safety": ["ai-data"], "public systems": ["law-government.government"], "critical infrastructure": ["energy-environment.power-grid"], "new energy": ["energy-environment"],
  "industrial decarbonization": ["energy-environment.environment-carbon"], "industrial tech": ["advanced-manufacturing"], "industry 5.0": ["advanced-manufacturing"], "digital economy": ["software-internet"],
  marketplaces: ["software-internet.consumer-internet"], commerce: ["software-internet.ecommerce"], "inclusive tech": ["software-internet"], "green jobs": ["energy-environment"],
  "skilled trades": ["advanced-manufacturing"], packaging: ["consumer-retail.fmcg"], services: ["professional-services"], "customer service": ["professional-services"],
  "business operations": ["professional-services"], "project management": ["professional-services"], product: ["software-internet"], ux: ["design-arts.ux-product-design"],
  "social media": ["software-internet.social-content"], wearables: ["hardware-electronics.consumer-electronics"], "smart home": ["hardware-electronics.iot"], iot: ["hardware-electronics.iot"],
  edtech: ["education.edtech"], entertainment: ["media-entertainment"], blockchain: ["software-internet.blockchain"], defi: ["software-internet.blockchain"], "creative tech": ["design-arts"],
  "ai-bio": ["life-sciences-healthcare", "ai-data"], "science-based": ["basic-sciences"], "computer graphics": ["software-internet"], hci: ["design-arts.ux-product-design"],
  databases: ["software-internet.cloud-infrastructure"], theory: ["basic-sciences.mathematics"], microbiology: ["basic-sciences.biology"], ecology: ["basic-sciences.biology"],
  bioinformatics: ["life-sciences-healthcare.diagnostics-genomics"], astrophysics: ["basic-sciences.earth-space"], neuroscience: ["basic-sciences.biology"], anthropology: ["social-sciences-humanities.sociology-anthropology"],
  "organizational behavior": ["social-sciences-humanities.psychology"], "international organizations": ["law-government.international-organizations"], "disaster response": ["law-government.ngo"],
  livelihoods: ["public-nonprofit"], "community development": ["public-nonprofit.community-services"], policing: ["law-government.government"], "criminal justice": ["law-government"],
  "social work": ["public-nonprofit.community-services"], "international finance": ["finance"], "economic development": ["social-sciences-humanities.economics"], sciences: ["basic-sciences"],
  "applied sciences": ["basic-sciences"], "applied science": ["basic-sciences"], "natural sciences": ["basic-sciences"], "social sciences": ["social-sciences-humanities"], "space science": ["basic-sciences.earth-space"],
  "computer architecture": ["hardware-electronics.semiconductors"], "earth science": ["basic-sciences.earth-space"], "political science": ["social-sciences-humanities.politics-ir"],
  "science policy": ["law-government.policy-research"], "basic science": ["basic-sciences"], "computational science": ["basic-sciences"], "national security": ["law-government.government"],
};

/** Free-text industries ("fintech", "deep tech", "film") → industry codes; "any" → [] (no restriction). */
export function industryCodes(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    const w = raw.toLowerCase().trim();
    if (!w) continue;
    const alias = INDUSTRY_ALIASES[w];
    const codes = alias ?? mapIndustry(w, { limit: 2, minScore: 1 }).map((m) => m.code);
    for (const c of codes) if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, 8);
}

/** "5+ years of experience" → 5. Only explicit statements; null otherwise. */
export function parseMinYears(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /\b(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)(?:'|’)?\s+(?:of\s+)?(?:[a-z/&-]+\s+){0,5}?(?:experience|exp\b)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 30 ? n : null;
}

/** Explicitly students only ("currently enrolled", "pursuing a degree"); null when not stated. */
export function statesStudentsOnly(text: string | null | undefined): boolean | null {
  if (!text) return null;
  return /\b(currently (?:enrolled|pursuing)|must be (?:a )?(?:current|enrolled) student|enrolled in (?:a|an) (?:bachelor|master|phd|degree|undergraduate|graduate)|pursuing (?:a|an|your) (?:bachelor|master|ph\.?d|degree|undergraduate|graduate))/i.test(text)
    ? true
    : null;
}

/* ================================================================== language */

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "you", "with", "for", "our", "will", "are", "your", "this", "that", "have", "experience", "team"],
  de: ["und", "der", "die", "das", "mit", "für", "wir", "sie", "ist", "eine", "ein", "auf", "bei", "erfahrung"],
  fr: ["et", "les", "des", "vous", "pour", "une", "avec", "dans", "nous", "est", "sur", "votre", "expérience"],
  es: ["y", "los", "las", "para", "con", "una", "del", "por", "experiencia", "nuestro", "equipo", "tu", "que"],
  pt: ["e", "os", "das", "para", "com", "uma", "do", "você", "experiência", "nosso", "equipe", "não", "que"],
  nl: ["en", "het", "een", "van", "voor", "met", "je", "wij", "ervaring", "zijn", "jouw", "naar"],
  it: ["e", "il", "della", "per", "con", "una", "che", "sono", "esperienza", "nostro", "del", "gli"],
};

/** Primary language of a posting: ISO 639-1 ("en", "zh", "ja", "ko", "de"…), or null when too short to tell. */
export function detectLanguage(text: string | null | undefined): string | null {
  const t = (text ?? "").slice(0, 3000);
  if (t.replace(/\s/g, "").length < 20) return null;
  const kana = (t.match(/[぀-ヿ]/g) ?? []).length;
  const hangul = (t.match(/[가-힯]/g) ?? []).length;
  const han = (t.match(/[一-鿿]/g) ?? []).length;
  const letters = (t.match(/\p{L}/gu) ?? []).length || 1;
  if (kana > 10 && kana / letters > 0.05) return "ja";
  if (hangul / letters > 0.2) return "ko";
  if (han / letters > 0.2) return "zh";
  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / words.length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 0.04 ? best : null;
}

/* ================================================================== money, fees, equity */

const CURRENCY_SIGNS: Array<[RegExp, string]> = [
  [/^(?:us\$|usd|\$)$/i, "USD"], [/^(?:€|eur)$/i, "EUR"], [/^(?:£|gbp)$/i, "GBP"], [/^(?:c\$|cad|ca\$)$/i, "CAD"], [/^(?:a\$|aud|au\$)$/i, "AUD"],
  [/^(?:hk\$|hkd)$/i, "HKD"], [/^(?:s\$|sgd)$/i, "SGD"], [/^(?:nt\$|twd)$/i, "TWD"], [/^(?:r\$|brl)$/i, "BRL"], [/^(?:nz\$|nzd)$/i, "NZD"], [/^(?:chf)$/i, "CHF"],
  [/^(?:jpy|円)$/i, "JPY"], [/^(?:cny|rmb|元|人民币)$/i, "CNY"], [/^(?:inr|₹|rs\.?)$/i, "INR"], [/^(?:krw|₩)$/i, "KRW"], [/^(?:sek)$/i, "SEK"], [/^(?:nok)$/i, "NOK"],
  [/^(?:dkk)$/i, "DKK"], [/^(?:pln|zł)$/i, "PLN"], [/^(?:aed)$/i, "AED"], [/^(?:sar)$/i, "SAR"], [/^(?:mxn)$/i, "MXN"], [/^(?:zar)$/i, "ZAR"], [/^(?:ils|₪)$/i, "ILS"],
];

function currencyOf(sign: string): string | null {
  const s = sign.trim();
  for (const [re, c] of CURRENCY_SIGNS) if (re.test(s)) return c;
  return null;
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, mn: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const AMOUNT_RE =
  /(us\$|hk\$|nt\$|nz\$|ca\$|au\$|c\$|a\$|s\$|r\$|\$|€|£|¥|₹|₩|₪|\b(?:usd|eur|gbp|cad|aud|hkd|sgd|twd|brl|nzd|chf|jpy|cny|rmb|inr|krw|sek|nok|dkk|pln|aed|sar|mxn|zar|ils)\b)\s?(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+(?!\d)|\d+(?:\.\d+)?)\s?(k|m|mm|mn|bn|b|thousand|million|billion)?\b/gi;

export interface MoneyMention {
  amount: number;
  currency: string;
  index: number;
  text: string;
}

/** Money mentions with an explicit currency ("$500,000", "CAD $70,000", "€1.5 million", "HK$344,400"). */
export function moneyMentions(text: string, opts: { countries?: readonly string[] } = {}): MoneyMention[] {
  const out: MoneyMention[] = [];
  // "¥" is yen in Japan and yuan in China: only read it when the place says which.
  const yen = opts.countries?.includes("JP") && !opts.countries.includes("CN") ? "JPY" : opts.countries?.includes("CN") && !opts.countries.includes("JP") ? "CNY" : null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    let sign = m[1];
    if (sign === "¥") {
      if (!yen) continue;
      sign = yen;
    }
    // "CAD $70,000": the code just before the sign decides.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 5), m.index ?? 0);
    const code = /\b(usd|cad|aud|hkd|sgd|nzd|twd)\s*$/i.exec(before)?.[1];
    if (code && sign === "$") sign = code;
    const currency = currencyOf(sign);
    if (!currency) continue;
    const base = Number(m[2].replace(/[,\s]/g, ""));
    const scale = m[3] ? (SCALE[m[3].toLowerCase()] ?? 1) : 1;
    if (!Number.isFinite(base) || base <= 0) continue;
    out.push({ amount: Math.round(base * scale), currency, index: m.index ?? 0, text: m[0].trim() });
  }
  return out;
}

type MoneyKind = (typeof BENEFIT_MONEY_KINDS)[number];
type MoneyPeriod = "once" | "year" | "month" | "week" | "day" | "hour" | "project";

export interface ParsedMoney {
  kind: MoneyKind;
  min: number | null;
  max: number | null;
  currency: string | null;
  period: MoneyPeriod | null;
}

/** The money kind an opportunity type pays out. */
export function moneyKindFor(type: OpportunityTypeId): MoneyKind {
  if (["accelerator", "incubator", "investor", "cofounder_match"].includes(type)) return "investment";
  if (["grant", "government_program", "residency", "open_call"].includes(type)) return "grant";
  if (["fellowship", "postdoc", "phd_position", "visiting_scholar", "exchange_program", "mentorship"].includes(type)) return "stipend";
  if (["scholarship", "degree_program", "course"].includes(type)) return "scholarship";
  if (["award", "competition", "hackathon", "startup_competition", "pitch_event"].includes(type)) return "prize";
  if (["job", "internship", "remote_job", "part_time", "graduate_program", "returnship", "ngo_job"].includes(type)) return "salary";
  return "other";
}

/**
 * Reads the headline amount of a benefits line conservatively: one currency only, "up to X"
 * → max, "X–Y" → range, a single amount → min = max. Periods only when stated
 * ("per year", "/month", "annual"). Returns null when the text is vague ("varies").
 */
export function parseMoney(text: string | null | undefined, kind: MoneyKind, opts: { countries?: readonly string[] } = {}): ParsedMoney | null {
  if (!text) return null;
  const mentions = moneyMentions(text, opts);
  if (!mentions.length) return null;
  const currencies = new Set(mentions.map((m) => m.currency));
  if (currencies.size > 1) return null;
  const first = mentions[0];
  // The headline amount leads the line ("Up to $250,000", "About HK$430,000 per year"); an
  // amount deep inside a sentence ("…some linked awards carry $10,000") is not the benefit.
  if (first.index > 30 || /\b(?:varies|varying|depending on|e\.g\.)\b/i.test(text.slice(0, first.index))) return null;
  // Credits and in-kind offers are not money paid out.
  if (/\bin-kind\b/i.test(text)) return null;
  if (/^\s*(?:\+|plus)?\s*(?:in|of|worth of)?\s*(?:[a-z]+\s+){0,2}(?:credits?|in-kind|vouchers?|perks)\b/i.test(text.slice(first.index + first.text.length, first.index + first.text.length + 40))) return null;
  const second = mentions[1];
  const head = text.slice(0, first.index).toLowerCase();
  let min: number | null = first.amount;
  let max: number | null = first.amount;
  if (second && /^\s*(?:-|–|—|to)\s*$/i.test(text.slice(first.index + first.text.length, second.index))) {
    min = Math.min(first.amount, second.amount);
    max = Math.max(first.amount, second.amount);
  } else if (/\b(up to|max(?:imum)?|as much as|no more than)\s*$/.test(head.slice(-20))) {
    min = null;
  } else if (/\b(from|at least|minimum|min\.?)\s*$/.test(head.slice(-14))) {
    max = null;
  }
  const after = text.slice(first.index, first.index + first.text.length + 40).toLowerCase();
  const period: MoneyPeriod | null = /(per|a|\/)\s?(year|yr|annum)|annual|yearly|p\.a\./.test(after) || /^annual/.test(head.trim().split(" ").pop() ?? "")
    ? "year"
    : /(per|a|\/)\s?month|monthly/.test(after)
      ? "month"
      : /(per|a|\/)\s?week|weekly/.test(after)
        ? "week"
        : /(per|a|\/)\s?day|daily/.test(after)
          ? "day"
          : /(per|an|\/)\s?hour|hourly/.test(after)
            ? "hour"
            : null;
  return { kind, min, max, currency: first.currency, period };
}

/** Application fee from a fee line ("$35 application fee", "€60 application fee (waived …)"); null otherwise. */
export function parseApplicationFee(text: string | null | undefined): Money | null {
  if (!text || !/application fee|submission fee|entry fee|per entry|报名费/i.test(text)) return null;
  if (/\bno (application|submission|entry) fee/i.test(text)) return null;
  const m = moneyMentions(text);
  if (!m.length) return null;
  return { amount: m[0].amount, currency: m[0].currency };
}

/** "7%", "Typically 5% common equity", "none" → percent; null when unstated or not a plain percentage. */
export function parseEquityPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (/^(none|no equity|0%|equity-free|no)$/.test(t)) return 0;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/* ================================================================== materials */

/** Curated material words → material ids (core/materials.ts). */
const MATERIAL_ALIASES: Record<string, MaterialId | ((type: OpportunityTypeId) => MaterialId)> = {
  references: "recommendation_letters", reference_letter: "recommendation_letters", reference_letters: "recommendation_letters", recommendations: "recommendation_letters",
  mentor_letter: "recommendation_letters", supervisor_letter: "recommendation_letters", host_letter: "recommendation_letters", host_statement: "recommendation_letters",
  invitation_letter: "recommendation_letters", institutional_endorsement: "recommendation_letters", sponsor_statement: "recommendation_letters",
  nomination: "nomination_packet", nomination_letter: "nomination_packet",
  proposal: (t) => (["grant", "government_program"].includes(t) ? "grant_application" : ["fellowship", "postdoc", "phd_position", "visiting_scholar", "conference_cfp", "journal"].includes(t) ? "research_proposal" : "project_proposal"),
  project_description: "project_proposal", policy_proposal: "project_proposal", synopsis: "project_proposal", concept_description: "project_proposal",
  research_plan: "research_proposal", research_essay: "research_proposal", data_management_plan: "research_proposal",
  deck: "pitch_deck", pitch: "pitch_deck", essays: "personal_statement", essay: "personal_statement", motivation_letter: "personal_statement",
  motivation_statement: "personal_statement", statement_of_purpose: "personal_statement", academic_statement: "personal_statement", ai_statement: "personal_statement",
  program_of_study: "personal_statement",
  statement: (t) => (["residency", "open_call", "exhibition", "award"].includes(t) ? "artist_statement" : "personal_statement"),
  director_statement: "artist_statement", company_description: "company_profile", organization_description: "company_profile",
  budget: "financial_summary", traction_metrics: "financial_summary", financial_information: "financial_summary", plan: "business_plan",
  bio: "short_bio", artist_bio: "short_bio", director_bio: "short_bio", expert_cv: "cv", biosketch: "cv", publications: "publication_list",
  work_sample: "work_samples", writing_sample: "work_samples", code_sample: "work_samples", code_repository: "work_samples", music_samples: "work_samples",
  film_screener: "work_samples", short_film: "work_samples", screenplay: "work_samples", script: "work_samples", trailer: "work_samples", artwork: "work_samples",
  project_submission: "work_samples", app_build: "work_samples", prototype: "work_samples", supplementary_material: "work_samples",
  images: (t) => (["exhibition", "startup_competition", "award"].includes(t) ? "product_images" : "work_samples"), photos: "work_samples",
  video: (t) => (["accelerator", "incubator", "startup_competition", "pitch_event", "investor"].includes(t) ? "demo_video" : "work_samples"),
  pitch_video: "demo_video", product_pitch: "one_pager", product_description: "one_pager",
  linkedin: "portfolio", website: "portfolio", work_links: "portfolio", music_links: "portfolio", channel: "portfolio", profile: "portfolio",
  online_tests: "test_scores", assessment: "test_scores", work_test: "test_scores", english_test: "test_scores", language_certificate: "test_scores",
  language_evaluation: "test_scores", csca_score: "test_scores",
  teacher_certificate: "certificate", diploma: "certificate",
  id_document: "document_checklist", id_verification: "document_checklist", passport_copy: "document_checklist", medical_certificate: "document_checklist",
  health_check: "document_checklist", medical_form: "document_checklist", photo: "document_checklist", admission_letter: "document_checklist",
  offer_letter: "document_checklist", financial_documents: "document_checklist", company_documents: "document_checklist", proof_of_work_experience: "document_checklist",
  student_id: "document_checklist", supporting_documents: "document_checklist", contribution_record: "evidence_list",
  online_application: "application_form", exhibit_application_form: "application_form", reply_form: "application_form", startup_registration_details: "application_form",
  jsp_information_sheet: "application_form", mentee_profile: "application_form", project_preferences: "application_form", business_email: "application_form",
  university_applications: "application_form", extended_abstract: "abstract", captions: "work_samples",
};

/** Maps curated material words to material ids; unknown words are returned separately (never silently lost). */
export function mapMaterials(words: readonly string[], type: OpportunityTypeId): { ids: MaterialId[]; unknown: string[] } {
  const ids: MaterialId[] = [];
  const unknown: string[] = [];
  for (const raw of words) {
    const w = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!w) continue;
    const alias = MATERIAL_ALIASES[w];
    const id = isMaterialId(w) ? w : typeof alias === "function" ? alias(type) : alias;
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else if (/letter/.test(w)) {
      if (!ids.includes("recommendation_letters")) ids.push("recommendation_letters");
    } else if (/statement/.test(w)) {
      if (!ids.includes("personal_statement")) ids.push("personal_statement");
    } else if (/sample|demo/.test(w)) {
      if (!ids.includes("work_samples")) ids.push("work_samples");
    } else {
      unknown.push(raw);
    }
  }
  return { ids, unknown };
}

/** "personal_statement" → "personal statement". */
export function humanize(word: string): string {
  return word.replace(/[_-]+/g, " ").trim();
}

/* ================================================================== quality */

/** 0–100 quality of a job posting as stored (how useful it is to show and to apply to). */
export function jobQuality(input: { descriptionLength: number; hasCountryOrRemote: boolean; hasSalary: boolean; functions: number; publishedAt: Date | null; general: boolean; now: Date }): number {
  let q = 40;
  if (input.descriptionLength >= 600) q += 15;
  else if (input.descriptionLength >= 200) q += 8;
  if (input.hasCountryOrRemote) q += 10;
  if (input.hasSalary) q += 10;
  if (input.functions > 0) q += 10;
  if (input.publishedAt) {
    const days = (input.now.getTime() - input.publishedAt.getTime()) / 86_400_000;
    if (days <= 30) q += 10;
    else if (days <= 90) q += 5;
    else if (days > 365) q -= 10;
  }
  if (input.general) q -= 35;
  return Math.max(0, Math.min(100, Math.round(q)));
}

/** 0–100 quality of a curated program entry (verified real programs start high). */
export function curatedQuality(input: { verified: boolean; hasEvidence: boolean; hasDeadlineOrRolling: boolean; hasBenefits: boolean; summaryLength: number; hasApplyUrl: boolean }): number {
  let q = 60;
  if (input.verified) q += 10;
  if (input.hasEvidence) q += 10;
  if (input.hasDeadlineOrRolling) q += 6;
  if (input.hasBenefits) q += 6;
  if (input.summaryLength >= 120) q += 4;
  if (input.hasApplyUrl) q += 4;
  return Math.max(0, Math.min(100, q));
}

/* ================================================================== dates */

/** `YYYY-MM-DD` → the end of that day in UTC (shown as that date; expiry adds a grace window). */
export function deadlineFromDate(date: string | null | undefined): Date | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T23:59:59Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date ? null : d;
}

/** Parses an ISO timestamp or epoch milliseconds; null when invalid. */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
