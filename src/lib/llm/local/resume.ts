import { countryOfLocation, looksLikeLocation } from "./geo";
import {
  clip,
  collapse,
  detectLanguage,
  findDateRange,
  findEmail,
  findPhone,
  findSingleDate,
  findUrls,
  hasCjk,
  isBulletLine,
  lines as splitLines,
  stripBullet,
  titleCase,
  uniq,
  type DateRange,
} from "./text";

/** Parse-level shapes (dates as "YYYY[-MM]"); src/lib/llm/local/ir.ts maps them to the extraction IR. */
export interface ExperienceEntry {
  organization: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  current: boolean;
  location: string | null;
  /** internship | part_time | contract | freelance | founder | volunteer | activity | research | teaching | null */
  type: string | null;
  highlights: string[];
}
export interface EducationEntry {
  institution: string;
  degree: string | null;
  /** high_school | associate | bachelor | master | mba | phd | md | jd | certificate */
  level: string | null;
  field: string | null;
  start: string | null;
  end: string | null;
  current: boolean;
  gpa: string | null;
  location: string | null;
  highlights: string[];
}
export interface ProjectEntry {
  name: string;
  role: string | null;
  url: string | null;
  start: string | null;
  end: string | null;
  summary: string | null;
  highlights: string[];
}
export interface SkillEntry {
  name: string;
  category: string | null;
  level: string | null;
}
export interface AchievementEntry {
  title: string;
  issuer: string | null;
  date: string | null;
  description: string | null;
}
export interface CertificationEntry {
  name: string;
  issuer: string | null;
  date: string | null;
  expires: string | null;
  credentialId: string | null;
}

/*
 * Heuristic résumé / CV parser (English and Chinese). Turns extracted text into sections,
 * then sections into entries, keeping the source lines of every item so each fact can
 * carry a verbatim quote. No guessing beyond the text: a field that isn't there stays null.
 */

export type SectionKey =
  | "header"
  | "summary"
  | "objective"
  | "experience"
  | "internships"
  | "education"
  | "skills"
  | "projects"
  | "publications"
  | "awards"
  | "certifications"
  | "languages"
  | "volunteer"
  | "activities"
  | "research"
  | "teaching"
  | "grants"
  | "talks"
  | "interests"
  | "references"
  | "personal"
  | "patents"
  | "exhibitions"
  | "clients"
  | "press"
  | "coursework"
  | "research_interests";

const SECTION_ALIASES: Array<[SectionKey, string[]]> = [
  ["summary", ["summary", "professional summary", "career summary", "profile", "professional profile", "about", "about me", "overview", "personal statement", "executive summary", "bio", "个人简介", "自我评价", "个人总结", "自我介绍", "个人评价", "个人优势", "个人概述", "简介"]],
  ["objective", ["objective", "career objective", "job objective", "求职意向", "求职目标", "期望工作", "职业目标"]],
  ["experience", ["experience", "work experience", "professional experience", "employment", "employment history", "work history", "career history", "relevant experience", "professional background", "career", "positions", "academic positions", "appointments", "工作经历", "工作经验", "职业经历", "任职经历", "工作履历"]],
  ["internships", ["internships", "internship", "internship experience", "实习经历", "实习经验"]],
  ["education", ["education", "academic background", "education and training", "education & training", "academic qualifications", "qualifications", "academic history", "教育背景", "教育经历", "学历", "教育", "学习经历"]],
  ["skills", ["skills", "top skills", "skills & endorsements", "skills and endorsements", "technical skills", "core skills", "key skills", "skills & tools", "skills and tools", "tools", "technologies", "tech stack", "competencies", "core competencies", "expertise", "areas of expertise", "skills & interests", "专业技能", "技能", "技能特长", "技术栈", "专业能力", "技能证书", "掌握技能"]],
  ["projects", ["projects", "selected projects", "key projects", "personal projects", "side projects", "project experience", "academic projects", "项目经历", "项目经验", "主要项目", "项目"]],
  ["publications", ["publications", "selected publications", "papers", "journal articles", "journal publications", "conference papers", "conference publications", "peer reviewed publications", "peer-reviewed publications", "refereed publications", "preprints", "books", "book chapters", "发表论文", "论文发表", "学术成果", "科研成果", "学术论文", "论文"]],
  ["awards", ["awards", "honors", "honours", "honors awards", "honors-awards", "honors & awards", "honors and awards", "awards & honors", "awards and honors", "achievements", "accomplishments", "scholarships", "fellowships and awards", "distinctions", "获奖情况", "获奖经历", "荣誉奖项", "奖项", "荣誉", "所获荣誉", "奖励"]],
  ["certifications", ["certifications", "certificates", "licenses", "licenses & certifications", "licenses and certifications", "certifications & licenses", "credentials", "证书", "资格证书", "职业资格", "执业资格", "证书资质"]],
  ["languages", ["languages", "language skills", "language", "语言能力", "语言", "外语能力", "语言技能"]],
  ["volunteer", ["volunteer", "volunteering", "volunteer experience", "volunteer experiences", "community service", "community involvement", "志愿者经历", "志愿服务", "社会实践", "公益经历"]],
  ["activities", ["activities", "leadership", "leadership experience", "extracurricular activities", "extracurriculars", "campus involvement", "student activities", "校园经历", "社团经历", "学生工作", "课外活动", "在校经历"]],
  ["research", ["research", "research experience", "研究经历", "科研经历", "科研经验", "研究经验"]],
  ["research_interests", ["research interests", "areas of research", "research areas", "研究方向", "研究兴趣"]],
  ["teaching", ["teaching", "teaching experience", "courses taught", "教学经历", "教学经验"]],
  ["grants", ["grants", "funding", "research funding", "grants & fellowships", "grants and fellowships", "grants and awards", "fellowships", "科研项目", "基金项目", "主持项目", "承担项目"]],
  ["talks", ["talks", "invited talks", "presentations", "conference presentations", "speaking", "selected talks", "学术报告", "学术会议", "演讲"]],
  ["interests", ["interests", "hobbies", "hobbies & interests", "兴趣爱好", "爱好"]],
  ["references", ["references", "referees", "推荐人"]],
  ["personal", ["personal information", "personal info", "personal details", "contact", "contact information", "contact details", "个人信息", "基本信息", "联系方式", "个人资料"]],
  ["patents", ["patents", "专利", "发明专利"]],
  ["exhibitions", ["exhibitions", "selected exhibitions", "shows", "screenings", "展览", "展览经历"]],
  ["clients", ["clients", "selected clients", "brands", "brands worked with", "合作客户", "服务客户", "合作品牌"]],
  ["press", ["press", "media", "featured in", "in the press", "media coverage", "媒体报道"]],
  ["coursework", ["coursework", "relevant coursework", "selected coursework", "courses", "主修课程", "相关课程", "核心课程"]],
];

const ALIAS_INDEX = new Map<string, SectionKey>();
for (const [key, names] of SECTION_ALIASES) for (const n of names) ALIAS_INDEX.set(n, key);

function normHeading(s: string): string {
  return s
    .replace(/^[\s#*•●■◆▶►【\[（(〔]+|[\s】\]）)〕:：]+$/g, "")
    .replace(/^\d+[.、)]\s*/, "")
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sections whose lines are often "Category: items" — an inline "Research: …" there is a category, not a heading. */
const LIST_SECTIONS: ReadonlySet<SectionKey> = new Set(["skills", "languages", "personal", "awards", "certifications", "coursework", "interests"]);

/**
 * Recognises a section heading line; returns the key and any content after an inline
 * "Heading: …". `inside` is the current section: inline headings are not recognised
 * inside list sections (where "Tools: Figma, Jira" is a skill category).
 */
export function headingOf(line: string, inside: SectionKey | null = null): { key: SectionKey; rest: string } | null {
  const t = line.trim();
  if (!t) return null;
  if (t.length <= 60) {
    const whole = ALIAS_INDEX.get(normHeading(t));
    if (whole) return { key: whole, rest: "" };
  }
  if (inside && LIST_SECTIONS.has(inside)) return null;
  const inline = /^([^:：]{2,30})[:：]\s*(.+)$/.exec(t);
  if (inline) {
    const key = ALIAS_INDEX.get(normHeading(inline[1]));
    if (key) return { key, rest: inline[2].trim() };
  }
  return null;
}

export interface Section {
  key: SectionKey;
  heading: string;
  lines: string[];
}

/** Splits text into sections; lines before the first heading form the "header" section. */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [{ key: "header", heading: "", lines: [] }];
  for (const raw of splitLines(text)) {
    if (!raw) continue;
    if (/^\[slide \d+\]$/i.test(raw)) continue;
    const h = headingOf(raw, sections[sections.length - 1].key);
    if (h) {
      sections.push({ key: h.key, heading: raw, lines: h.rest ? [h.rest] : [] });
      continue;
    }
    sections[sections.length - 1].lines.push(raw);
  }
  return sections.filter((s) => s.key === "header" || s.lines.length > 0);
}

/* ------------------------------------------------------------------ header / contact */

export interface Sourced<T> {
  value: T;
  quote: string;
}

const NAME_STOP = /\b(resume|résumé|curriculum vitae|cv|portfolio|profile|contact|page \d|linkedin|github|email|phone|address|skills?|experience|education|summary|languages?|certifications?|honou?rs|awards?|publications?|projects?|references|interests|objective)\b|简历|履历|个人简历/i;
const CN_SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤欧司上";

function englishName(segment: string): string | null {
  const s = segment.replace(/^(name|full name)\s*[:：]\s*/i, "").replace(/\s*,?\s*(ph\.?d\.?|m\.?d\.?|mba|cpa|pe|rn|esq\.?)$/i, "").trim();
  if (!s || s.length > 50 || NAME_STOP.test(s) || /\d|@|\/|https?:/.test(s)) return null;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  const ok = words.every((w) => /^(?:[A-Z][a-zà-ÿ'’-]+|[A-Z]{2,}|[A-Z]\.|[A-Z][a-z]*[A-Z][a-z]+|(?:de|van|von|da|di|del|la|le|bin|al)|[A-Z][a-zà-ÿ'’]+-[A-Z][a-zà-ÿ'’]+)$/.test(w));
  if (!ok) return null;
  // ALL-CAPS section-like words are not names ("WORK EXPERIENCE" is caught by headings, "SENIOR DESIGNER" here).
  if (/^(senior|junior|lead|principal|staff|chief|head|product|software|data|ux|ui|graphic|marketing|sales)$/i.test(words[0])) return null;
  return titleCase(s);
}

function chineseName(segment: string): string | null {
  const labelled = /(?:姓\s*名)\s*[:：]\s*([一-鿿·]{2,5})/.exec(segment);
  if (labelled) return labelled[1];
  const s = segment.trim();
  const m = /^([一-鿿]{2,4})(?:\s|$|[|｜/,，])/.exec(s);
  if (!m) return null;
  const cand = m[1];
  if (NAME_STOP.test(cand) || headingOf(cand)) return null;
  if (!CN_SURNAMES.includes(cand[0]) && !/^(欧阳|司马|上官|诸葛|东方|皇甫|慕容|令狐)/.test(cand)) return null;
  return cand;
}

export interface HeaderInfo {
  name: Sourced<string> | null;
  headline: Sourced<string> | null;
  email: Sourced<string> | null;
  phone: Sourced<string> | null;
  location: Sourced<string> | null;
  links: Sourced<string>[];
  birthYear: Sourced<number> | null;
  /** Chinese résumés often state these in the header ("求职意向：产品经理"). */
  targetTitles: Sourced<string>[];
  targetLocations: Sourced<string>[];
}

function labelled(line: string, labels: string): string | null {
  const m = new RegExp(`(?:^|\\s|[|｜])(?:${labels})\\s*[:：]\\s*([^|｜]+?)(?=\\s{2,}|\\s*[|｜]|$|\\s+(?:[\\u4e00-\\u9fff]{2,4}|[A-Za-z ]{3,20})\\s*[:：])`, "i").exec(line);
  return m ? m[1].trim() : null;
}

/** Reads name, contact details and links from the header block (and labelled fields anywhere in the first lines). */
export function parseHeader(headerLines: string[], allText: string): HeaderInfo {
  const info: HeaderInfo = { name: null, headline: null, email: null, phone: null, location: null, links: [], birthYear: null, targetTitles: [], targetLocations: [] };
  const top = headerLines.slice(0, 14);
  const firstLines = splitLines(allText).filter(Boolean).slice(0, 16);
  const scan = top.length ? top : firstLines;
  // Contact details can sit just below an early heading ("求职意向：…" on line 2), so scan the
  // first lines of the document as well as the header block.
  const contactScan = [...new Set([...top, ...firstLines])];

  for (const line of contactScan) {
    if (!info.email) {
      const e = findEmail(line);
      if (e) info.email = { value: e, quote: line };
    }
    if (!info.phone) {
      const withoutEmail = line.replace(/[A-Za-z0-9._%+-]+@[^\s|｜,，]+/g, " ");
      const p = findPhone(withoutEmail);
      if (p) info.phone = { value: p, quote: line };
    }
    for (const u of findUrls(line)) info.links.push({ value: u, quote: line });
    const by = labelled(line, "出生年月|出生日期|出生|date of birth|dob|born");
    if (by && !info.birthYear) {
      const y = /(19[4-9]\d|20[01]\d)/.exec(by);
      if (y) info.birthYear = { value: Number(y[1]), quote: line };
    }
    const loc = labelled(line, "现居地|现居住地|现居|所在地|所在城市|居住地|城市|地址|location|address|based in");
    if (loc && !info.location) info.location = { value: loc.replace(/\s*[|｜].*$/, ""), quote: line };
    const target = labelled(line, "求职意向|期望职位|意向岗位|应聘岗位|目标岗位|desired position|target role");
    if (target) for (const t of target.split(/[、,，/]/).map((x) => x.trim()).filter(Boolean)) info.targetTitles.push({ value: t, quote: line });
    const city = labelled(line, "期望城市|意向城市|期望地点|工作地点|preferred location");
    if (city) for (const c of city.split(/[、,，/]/).map((x) => x.trim()).filter(Boolean)) info.targetLocations.push({ value: c, quote: line });
  }

  // Name: the first header line (or its first segment) that reads as a person's name.
  for (const line of scan.slice(0, 6)) {
    const segments = line.split(/\s*[|｜•·]\s*|\s{3,}|\t/).filter(Boolean);
    for (const seg of segments.slice(0, 2)) {
      const n = hasCjk(seg) ? chineseName(seg) ?? chineseName(line) : englishName(seg);
      if (n) {
        info.name = { value: n, quote: line };
        break;
      }
    }
    if (info.name) break;
  }
  if (!info.name) {
    const m = /姓\s*名\s*[:：]\s*([一-鿿·]{2,5})/.exec(allText.slice(0, 2000));
    if (m) info.name = { value: m[1], quote: m[0] };
    const e = /^\s*name\s*[:：]\s*(.+)$/im.exec(allText.slice(0, 2000));
    if (!info.name && e) {
      const n = englishName(e[1]);
      if (n) info.name = { value: n, quote: e[0].trim() };
    }
  }

  // Headline: a short non-contact line right after the name ("Senior Product Designer").
  if (info.name) {
    const idx = scan.findIndex((l) => l === info.name!.quote);
    for (const line of scan.slice(idx + 1, idx + 3)) {
      const seg = line.split(/\s*[|｜•·]\s*|\s{2,}/)[0].trim();
      if (!seg || findEmail(seg) || findPhone(seg) || findUrls(seg).length || looksLikeLocation(seg) || /[:：]/.test(seg)) continue;
      if (seg.length <= 80 && !/[.。]$/.test(seg) && !headingOf(seg)) {
        info.headline = { value: seg, quote: line };
        break;
      }
    }
  }

  // Location: a header segment that looks like a place.
  if (!info.location) {
    outer: for (const line of scan) {
      for (const seg of line.split(/\s*[|｜•·]\s*|\s{3,}|\t/)) {
        const s = seg.trim().replace(/^(location|address)\s*[:：]\s*/i, "");
        if (!s || findEmail(s) || findPhone(s) || /https?:|www\./.test(s)) continue;
        if (looksLikeLocation(s) && !/^(remote|hybrid)$/i.test(s)) {
          info.location = { value: s, quote: line };
          break outer;
        }
      }
    }
  }

  // Links anywhere in the document (portfolio, GitHub in a footer).
  for (const u of findUrls(allText.slice(0, 50_000))) {
    if (!info.links.some((l) => l.value === u)) {
      const line = splitLines(allText).find((l) => l.includes(u.replace(/^https?:\/\//, "").replace(/^www\./, "").slice(0, 30))) ?? u;
      info.links.push({ value: u, quote: line });
    }
  }
  info.links = uniq(info.links, (l) => l.value.toLowerCase()).slice(0, 15);
  return info;
}

/* ------------------------------------------------------------------ entries */

export interface RawEntry {
  header: string[];
  date: DateRange | null;
  single: { date: string; expected: boolean; matched: string } | null;
  bullets: string[];
  lines: string[];
}

const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic|conservatory|universit[éäà]t?|école|hochschule|seminary)\b|大学|学院|学校|中学|高中|研究生院|研究院|大學|職業學院|职业技术学院|技师学院/i;

function isHeaderish(line: string): boolean {
  if (line.length > 160) return false;
  if (findDateRange(line)) return true;
  if (/[.。!！]$/.test(line) && line.split(/\s+/).length > 8) return false;
  return true;
}

/** Groups section lines into entries: header lines (title/org/dates) followed by bullets. */
export function splitEntries(sectionLines: string[], opts: { splitOnInstitution?: boolean } = {}): RawEntry[] {
  const entries: RawEntry[] = [];
  let cur: RawEntry | null = null;
  const start = (): RawEntry => {
    const e: RawEntry = { header: [], date: null, single: null, bullets: [], lines: [] };
    entries.push(e);
    return e;
  };
  for (const line of sectionLines) {
    if (!line) continue;
    const bullet = isBulletLine(line);
    const range = findDateRange(line);
    if (bullet) {
      cur ??= start();
      cur.bullets.push(stripBullet(line));
      cur.lines.push(line);
      continue;
    }
    // Wrapped bullet: lowercase continuation of the previous bullet.
    if (cur && cur.bullets.length > 0 && /^[a-z(]/.test(line) && !range) {
      cur.bullets[cur.bullets.length - 1] += ` ${line}`;
      cur.lines.push(line);
      continue;
    }
    const headerish = isHeaderish(line);
    const institutionBreak = opts.splitOnInstitution && cur && cur.header.some((h) => INSTITUTION_RE.test(h)) && INSTITUTION_RE.test(line) && !range;
    const newEntry =
      !cur ||
      (headerish && cur.bullets.length > 0) ||
      (range !== null && cur.date !== null) ||
      Boolean(institutionBreak) ||
      (headerish && cur.header.length >= 3 && cur.date !== null && !looksLikeLocation(line) && !range);
    if (newEntry && headerish) cur = start();
    cur ??= start();
    if (headerish && cur.bullets.length === 0) {
      cur.header.push(line);
      if (range && !cur.date) cur.date = range;
      if (!range && !cur.single) {
        const single = findSingleDate(line);
        if (single) cur.single = single;
      }
    } else {
      cur.bullets.push(line);
    }
    cur.lines.push(line);
  }
  return entries.filter((e) => e.header.length > 0 || e.bullets.length > 0);
}

const TITLE_WORDS =
  /\b(engineer|developer|programmer|architect|manager|director|designer|analyst|scientist|researcher|research assistant|intern|internship|lead|head|consultant|specialist|coordinator|officer|assistant|associate|founder|co-founder|cofounder|owner|ceo|cto|coo|cfo|cmo|cpo|vp|vice president|president|partner|principal|teacher|tutor|lecturer|professor|postdoc|postdoctoral|fellow|nurse|physician|doctor|pharmacist|therapist|counselor|accountant|auditor|lawyer|attorney|paralegal|writer|editor|journalist|producer|photographer|videographer|illustrator|animator|artist|musician|strategist|marketer|recruiter|representative|executive|administrator|technician|operator|chef|barista|server|cashier|clerk|agent|advisor|adviser|planner|buyer|curator|translator|interpreter|instructor|coach|trainee|apprentice|volunteer|member|chair|secretary|treasurer|captain|ambassador|organizer|product|marketing|sales|operations|growth|content|community|ux|ui)\b|工程师|开发|程序员|架构师|经理|总监|主管|设计师|分析师|研究员|助理|实习生|实习|负责人|顾问|专员|主任|创始人|联合创始人|合伙人|总裁|副总裁|教师|讲师|教授|博士后|护士|医生|医师|药师|会计|审计|律师|编辑|记者|摄影师|策划|运营|产品|销售|市场|招聘|翻译|主管|组长|队长|部长|主席|委员|干事|老师|技术员|操作员|专家|总经理|CEO|CTO/i;

const ORG_WORDS =
  /\b(inc|inc\.|llc|ltd|ltd\.|limited|corp|corporation|company|co\.|gmbh|s\.a\.|plc|group|holdings|technologies|technology|tech|labs?|studio|studios|agency|partners|capital|ventures|bank|hospital|clinic|foundation|institute|university|college|school|council|association|society|ministry|department|bureau|government|systems|solutions|software|media|health|consulting|network|networks|games|foods|motors|pharma|therapeutics|bio|ai|analytics|cloud|digital|ventures)\b|公司|有限公司|集团|科技|大学|学院|研究院|研究所|实验室|医院|银行|工作室|事务所|基金会|协会|中心|局|部|厅|委员会|学校|网络|传媒|咨询|控股|股份/i;

const EMPLOYMENT_TYPES: Array<[RegExp, string]> = [
  [/\b(intern|internship)\b|实习/i, "internship"],
  [/\bpart[- ]time\b|兼职/i, "part_time"],
  [/\b(contract|contractor)\b|合同工|外包/i, "contract"],
  [/\b(freelance|freelancer|self-employed|independent)\b|自由职业|独立/i, "freelance"],
  [/\b(co-?founder|founder|owner)\b|创始人|联合创始人|创办/i, "founder"],
  [/\bvolunteer\b|志愿/i, "volunteer"],
];

function splitHeaderParts(header: string[], date: DateRange | null, single: RawEntry["single"]): string[] {
  const parts: string[] = [];
  for (let h of header) {
    if (date) h = h.replace(date.matched, " ");
    if (single) h = h.replace(single.matched, " ");
    // LinkedIn-style durations: "(5 years 8 months)", "(1 yr 2 mos)", "(less than a year)".
    h = h.replace(/\(\s*(\d+\s*(years?|yrs?|months?|mos?)\s*)+\)|\(\s*less than a year\s*\)|[（(]\s*\d+\s*(年|个月)[^)）]*[)）]/gi, " ");
    h = h.replace(/[(（[【]\s*[)）\]】]/g, " ");
    for (const p of h.split(/\s+[|｜•·—–]\s+|\s+-\s+|\s*[|｜]\s*|\t|\s{2,}/)) {
      const t = p.replace(/^[,，;；\s\-–—]+|[,，;；\s\-–—]+$/g, "").trim();
      if (!t || t.length <= 1) continue;
      // Chinese headers often separate columns with one space: "上海某某科技有限公司 产品经理".
      if (hasCjk(t) && / /.test(t) && t.split(" ").every((tok) => hasCjk(tok) || /^[A-Za-z0-9/+&.-]{1,12}$/.test(tok))) {
        const toks = t.split(" ").filter(Boolean);
        if (toks.filter((tok) => hasCjk(tok)).length >= 2) {
          parts.push(...toks.filter((tok) => tok.length > 1));
          continue;
        }
      }
      parts.push(t);
    }
  }
  return parts;
}

function titleScore(s: string): number {
  let n = 0;
  if (TITLE_WORDS.test(s)) n += 2;
  if (/^(senior|junior|lead|staff|principal|chief|head of|associate|assistant|sr\.?|jr\.?)\b/i.test(s)) n += 1;
  if (ORG_WORDS.test(s)) n -= 1.5;
  if (INSTITUTION_RE.test(s)) n -= 1;
  return n;
}

function orgScore(s: string): number {
  let n = 0;
  if (ORG_WORDS.test(s)) n += 2;
  if (INSTITUTION_RE.test(s)) n += 1;
  if (TITLE_WORDS.test(s) && !ORG_WORDS.test(s)) n -= 1.5;
  if (looksLikeLocation(s)) n -= 2;
  return n;
}

export function toExperience(raw: RawEntry, defaultType: string | null = null): ExperienceEntry | null {
  let parts = splitHeaderParts(raw.header, raw.date, raw.single);
  let location: string | null = null;
  parts = parts.filter((p) => {
    if (!location && looksLikeLocation(p) && !ORG_WORDS.test(p)) {
      location = p.replace(/^(location|地点)\s*[:：]\s*/i, "");
      return false;
    }
    return true;
  });
  // "Title at Org" / "Title @ Org" / "Title, Org" / "Org, City, ST"
  const expanded: string[] = [];
  for (let p of parts) {
    if (!location) {
      const tokens = p.split(/,\s+|，/);
      for (let k = Math.min(3, tokens.length - 1); k >= 1; k--) {
        const suffix = tokens.slice(tokens.length - k).join(", ");
        if (looksLikeLocation(suffix) && !ORG_WORDS.test(suffix)) {
          location = suffix;
          p = tokens.slice(0, tokens.length - k).join(", ");
          break;
        }
      }
    }
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(p);
    if (at) {
      expanded.push(at[1], at[2]);
      continue;
    }
    const comma = /^(.+?),\s+(.+)$/.exec(p);
    if (comma && (titleScore(comma[1]) > 0 || titleScore(comma[2]) > 0) && !looksLikeLocation(p)) {
      const [a, b] = [comma[1], comma[2]];
      if (looksLikeLocation(b)) {
        expanded.push(a);
        location ??= b;
      } else expanded.push(a, b);
      continue;
    }
    expanded.push(p);
  }
  parts = expanded.filter((p) => !/^(present|current|至今)$/i.test(p));
  if (parts.length === 0 && raw.bullets.length === 0) return null;

  let title: string | null = null;
  let organization: string | null = null;
  if (parts.length === 1) {
    if (titleScore(parts[0]) > orgScore(parts[0])) title = parts[0];
    else organization = parts[0];
  } else if (parts.length >= 2) {
    const byTitle = [...parts].sort((a, b) => titleScore(b) - titleScore(a));
    const bestTitle = byTitle[0];
    const rest = parts.filter((p) => p !== bestTitle);
    const bestOrg = [...rest].sort((a, b) => orgScore(b) - orgScore(a))[0];
    if (titleScore(bestTitle) <= 0 && orgScore(bestOrg) <= 0) {
      // No signal: the most common layouts put the organisation first on its own line, the title first inline.
      [title, organization] = raw.header.length > 1 ? [parts[1], parts[0]] : [parts[0], parts[1]];
    } else {
      title = bestTitle;
      organization = bestOrg ?? null;
    }
  }

  const all = raw.header.join(" ");
  let type = defaultType;
  for (const [re, t] of EMPLOYMENT_TYPES) {
    if (re.test(title ?? "") || re.test(all)) {
      type = t;
      break;
    }
  }
  return {
    organization: organization ? clip(organization, 120) : null,
    title: title ? clip(title, 120) : null,
    start: raw.date?.start ?? raw.single?.date ?? null,
    end: raw.date ? raw.date.end : null,
    current: raw.date?.current ?? false,
    location,
    type,
    highlights: raw.bullets.map((b) => clip(b, 400)).filter((b) => b.length > 2).slice(0, 12),
  };
}

const DEGREE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ph\.?\s?d\.?|d\.?phil|doctor of philosophy|doctorate)\b|博士/i, "phd"],
  [/\b(m\.?d\.?|doctor of medicine|mbbs)\b/i, "md"],
  [/\b(j\.?d\.?|juris doctor)\b/i, "jd"],
  [/\b(mba|m\.b\.a\.?|master of business administration)\b|工商管理硕士/i, "mba"],
  [/\b(m\.?s\.?c?\.?|m\.?a\.?|m\.?eng\.?|m\.?phil\.?|mres|mfa|mpa|mph|llm|m\.?ed\.?|master'?s?|master of [a-z ]+)\b|硕士|研究生/i, "master"],
  [/\b(b\.?s\.?c?\.?|b\.?a\.?|b\.?eng\.?|b\.?tech|bba|bfa|llb|b\.?ed\.?|bachelor'?s?|bachelor of [a-z ]+|undergraduate|a\.?b\.?)\b|本科|学士/i, "bachelor"],
  [/\b(associate'?s?( degree)?|a\.?a\.?s?\.?|hnd)\b|专科|大专|高职/i, "associate"],
  [/\b(high school( diploma)?|secondary school|ib diploma|a-levels?|gcse)\b|高中|中学/i, "high_school"],
  [/\b(certificate|diploma|bootcamp|nanodegree)\b|结业|培训/i, "certificate"],
];

export function degreeLevel(text: string): string | null {
  for (const [re, level] of DEGREE_PATTERNS) if (re.test(text)) return level;
  return null;
}

const DEGREE_TEXT_RE =
  /\b(ph\.?\s?d\.?|d\.?phil|doctor of [a-z ]+|m\.?d\.?|j\.?d\.?|mba|m\.?s\.?c?\.?|m\.?a\.?|m\.?eng\.?|m\.?phil\.?|mfa|mpa|mph|llm|master of [a-z ]+|master'?s( degree)?|b\.?s\.?c?\.?|b\.?a\.?|b\.?eng\.?|bba|bfa|llb|bachelor of [a-z ]+|bachelor'?s( degree)?|associate'?s? degree|associate of [a-z ]+|high school diploma)(?=[\s,;(|]|$)|博士研究生|硕士研究生|博士|硕士|本科|学士|专科|大专|高中/i;

const EDU_NOTE_RE = /^(dissertation|thesis|advisor|adviser|supervisor|committee|honors?|honours|minor|concentration in|coursework|毕业论文|学位论文|导师|辅修)\b\s*[:：]?/i;

export function toEducation(raw: RawEntry): EducationEntry | null {
  const isNote = (h: string, i: number) => EDU_NOTE_RE.test(h) || (i > 0 && /(scholarship|honou?rs|dean'?s list|award|奖学金|荣誉|排名|\brank|绩点|\bgpa\b)/i.test(h) && !INSTITUTION_RE.test(h) && !DEGREE_TEXT_RE.test(h));
  const notes = raw.header.filter((h, i) => isNote(h, i));
  const header = raw.header.filter((h, i) => !isNote(h, i));
  const parts = splitHeaderParts(header, raw.date, raw.single).flatMap((p) =>
    DEGREE_TEXT_RE.test(p) && INSTITUTION_RE.test(p) ? p.split(/,\s+|，/).map((x) => x.trim()).filter(Boolean) : [p],
  );
  const all = header.join(" ");
  let institution: string | null = parts.find((p) => INSTITUTION_RE.test(p)) ?? null;
  let degree: string | null = null;
  let field: string | null = null;
  let location: string | null = null;
  let gpa: string | null = null;

  const gpaMatch = /\b(?:gpa|cgpa|grade point average|绩点|GPA)\s*[:：]?\s*(\d(?:\.\d{1,2})?\s*(?:\/\s*\d(?:\.\d{1,2})?)?)/i.exec([all, ...notes, ...raw.bullets].join(" "));
  if (gpaMatch) gpa = gpaMatch[1].replace(/\s+/g, "");

  for (const raw of parts) {
    if (raw === institution) continue;
    // "BS, Human Factors" (LinkedIn puts the abbreviation after the degree) → "Human Factors".
    const abbr = /^([A-Z][A-Za-z.]{1,6}),\s*(.+)$/.exec(raw);
    const p = (abbr && DEGREE_TEXT_RE.test(abbr[1]) && degree ? abbr[2] : raw).replace(/\s*·\s*$/, "").trim();
    const d = DEGREE_TEXT_RE.exec(p);
    if (d && !degree) {
      degree = d[0].trim();
      const after = p
        .slice((d.index ?? 0) + d[0].length)
        .replace(/^\s*[-–]\s*[A-Z][A-Za-z.]{1,6}\s*(?=,|$)/, "") // LinkedIn: "Bachelor of Science - BS, Field"
        .replace(/^[\s,，:：-]*(in|of|，|,)?\s*/i, "")
        .replace(/\s*·\s*$/, "")
        .replace(/\s*\(?\b(gpa|cgpa)\b.*$/i, "")
        .trim();
      const before = p.slice(0, d.index ?? 0).replace(/[\s,，|]+$/, "").trim();
      if (after && after.length > 1 && !/^(\d|gpa)/i.test(after)) field = after.replace(/专业$/, "");
      else if (before && !INSTITUTION_RE.test(before) && before.length > 1) field = before.replace(/专业$/, "");
      continue;
    }
    if (!location && looksLikeLocation(p)) {
      location = p;
      continue;
    }
    if (!field && /专业|major|concentration|programme|program|specialization/i.test(p)) {
      field = p.replace(/^(major|concentration|专业)\s*[:：]?\s*/i, "").replace(/专业$/, "").trim();
      continue;
    }
    if (!institution && parts.length > 1 && !/\bgpa\b/i.test(p)) institution = p;
    else if (!field && !/\bgpa\b|绩点/i.test(p) && p.length < 80 && p !== institution) field = p;
  }
  if (!institution) {
    if (!degree && parts.length === 0) return null;
    institution = parts.find((p) => p !== degree && p !== field && p !== location) ?? null;
  }
  if (!institution) return null;
  const level = degreeLevel(degree ?? all);
  const end = raw.date ? raw.date.end : raw.single?.date ?? null;
  const expected = raw.single?.expected ?? /expected|anticipated|预计|在读/i.test(all);
  const current = raw.date?.current ?? (expected || /在读|current|present/i.test(all));
  return {
    institution: clip(institution, 160),
    degree: degree ? clip(degree, 80) : null,
    level,
    field: field ? clip(field.replace(/^in\s+/i, ""), 120) : null,
    start: raw.date?.start ?? null,
    end,
    current,
    gpa,
    location,
    highlights: [...notes, ...raw.bullets].map((b) => clip(b, 300)).filter((b) => !/^\s*(gpa|cgpa|绩点)\s*[:：]?\s*[\d.]+(\s*\/\s*[\d.]+)?\s*$/i.test(b)).slice(0, 8),
  };
}

export function toProject(raw: RawEntry): ProjectEntry | null {
  const parts = splitHeaderParts(raw.header, raw.date, raw.single);
  const urls = findUrls(raw.header.join(" "));
  const textParts = parts.filter((p) => !findUrls(p).length);
  const name = textParts[0];
  if (!name) return null;
  const role = textParts.slice(1).find((p) => TITLE_WORDS.test(p)) ?? null;
  const prose = raw.bullets.filter((b) => b.length > 20);
  return {
    name: clip(name, 120),
    role: role ? clip(role, 80) : null,
    url: urls[0] ?? findUrls(raw.bullets.join(" "))[0] ?? null,
    start: raw.date?.start ?? raw.single?.date ?? null,
    end: raw.date?.end ?? null,
    summary: prose[0] ? clip(prose[0], 300) : null,
    highlights: raw.bullets.slice(prose[0] ? 1 : 0).map((b) => clip(b, 300)).slice(0, 8),
  };
}

/* ------------------------------------------------------------------ list sections */

const SKILL_LEVEL_PREFIX: Array<[RegExp, string]> = [
  [/^(精通|expert in|expert at|advanced( in)?|proficient in|proficient with|深入掌握)\s*/i, "advanced"],
  [/^(熟练掌握|熟练使用|熟练|熟悉|掌握|experienced (in|with)|strong|good command of|skilled in)\s*/i, "intermediate"],
  [/^(了解|familiar with|basic|basic knowledge of|exposure to|working knowledge of)\s*/i, "basic"],
];

export function parseSkills(sectionLines: string[]): Array<{ entry: SkillEntry; quote: string }> {
  const out: Array<{ entry: SkillEntry; quote: string }> = [];
  // "Languages: Go, Python; Infra: Kafka, Terraform" → one segment per category.
  const segments = sectionLines.flatMap((raw) => {
    const line = stripBullet(raw);
    const parts = line.split(/\s*[;；]\s*(?=[^,，;；:：]{2,40}[:：])/);
    return parts.length > 1 ? parts.map((p) => ({ raw, line: p })) : [{ raw, line }];
  });
  for (const { raw, line: segment } of segments) {
    let line = segment;
    // Prose (a stray note, a sentence about skills) is not a skills list.
    const pieces = line.split(/\s*[,;|•·、，；]\s*/);
    if (line.split(/\s+/).length > 14 && pieces.reduce((n, p) => n + p.split(/\s+/).length, 0) / pieces.length > 3) continue;
    let category: string | null = null;
    const cat = /^([^:：]{2,40})[:：]\s*(.+)$/.exec(line);
    if (cat && !/https?$/i.test(cat[1])) {
      if (cat[1].trim().split(/\s+/).length > 4) continue;
      category = cat[1].trim();
      line = cat[2];
    }
    let level: string | null = null;
    for (const [re, l] of SKILL_LEVEL_PREFIX) {
      if (re.test(line)) {
        level = l;
        line = line.replace(re, "");
        break;
      }
    }
    for (const piece of line.split(/\s*[,;|•·、，；]\s*|\s+\/\s+|\s{2,}/)) {
      let name = piece.replace(/^(and|及|和|以及)\s+/i, "").replace(/[.。]$/, "").trim();
      let lvl = level;
      for (const [re, l] of SKILL_LEVEL_PREFIX) {
        if (re.test(name)) {
          lvl = l;
          name = name.replace(re, "").trim();
        }
      }
      const paren = /^(.+?)\s*[(（]([^)）]{1,30})[)）]$/.exec(name);
      if (paren && /native|fluent|advanced|intermediate|basic|expert|\d\s*(yrs?|years)|母语|流利|熟练|精通/i.test(paren[2])) {
        name = paren[1].trim();
        lvl = paren[2].trim();
      }
      if (!name || name.length > 40 || name.split(/\s+/).length > 5) continue;
      if (/^(etc|等|and more|others?)$/i.test(name)) continue;
      out.push({ entry: { name, category, level: lvl }, quote: raw });
    }
  }
  return uniq(out, (s) => s.entry.name.toLowerCase()).slice(0, 80);
}

export function parseLanguages(sectionLines: string[]): Array<{ value: string; quote: string; test?: { name: string; score: string } }> {
  const out: Array<{ value: string; quote: string; test?: { name: string; score: string } }> = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw);
    for (const piece of line.split(/\s*[,;|•·、，；]\s*/)) {
      const p = piece.trim();
      if (!p || p.length > 60) continue;
      const test = /\b(ielts|toefl|toeic|gre|gmat|cet-?[46]|tem-?[48]|hsk\s?\d|jlpt\s?n[1-5]|delf|dele|testdaf)\b[\s:：]*([\d.]+)?/i.exec(p) ?? /(雅思|托福|四级|六级|专八|专四)\s*[:：]?\s*([\d.]+)?/.exec(p);
      out.push({ value: p, quote: raw, ...(test ? { test: { name: test[1].toUpperCase(), score: test[2] ?? "" } } : {}) });
    }
  }
  return uniq(out, (l) => l.value.toLowerCase()).slice(0, 12);
}

export function parseAchievements(sectionLines: string[]): Array<{ entry: AchievementEntry; quote: string }> {
  const out: Array<{ entry: AchievementEntry; quote: string }> = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw);
    if (line.length < 3) continue;
    // An award line names an award or carries a date; prose that does neither is a stray note.
    if (!/(19|20)\d{2}|奖|award|prize|honou?r|scholarship|fellowship|winner|finalist|medal|dean'?s list|grant|competition|challenge|cup|champion|第.名|冠军|亚军|季军|荣获|称号|入选|recipient|top \d+|notable|distinction|best /i.test(line)) continue;
    const range = findDateRange(line);
    const single = range ? null : findSingleDate(line);
    let rest = line;
    if (range) rest = rest.replace(range.matched, " ");
    if (single) rest = rest.replace(single.matched, " ");
    rest = collapse(rest.replace(/[(（]\s*[)）]/g, " ")).replace(/[,，\s\-–—]+$/, "");
    const parts = rest.split(/\s+[-–—|]\s+|\s*[|｜]\s*|,\s+(?=[A-Z一-鿿])/);
    const title = parts[0]?.trim();
    if (!title) continue;
    const issuer = parts.slice(1).join(", ").trim() || null;
    out.push({ entry: { title: clip(title, 200), issuer: issuer ? clip(issuer, 120) : null, date: range?.start ?? single?.date ?? null, description: null }, quote: raw });
  }
  return out.slice(0, 40);
}

const CERT_ISSUERS = /\b(aws|amazon web services|google|microsoft|azure|pmi|scrum alliance|scrum\.org|cisco|comptia|oracle|salesforce|hubspot|coursera|udacity|edx|isc2|isaca|cfa institute|aicpa|acca|hashicorp|kubernetes|cncf|linux foundation|red hat|meta|adobe|autodesk|tableau|snowflake|databricks)\b/i;

export function parseCertifications(sectionLines: string[]): Array<{ entry: CertificationEntry; quote: string }> {
  const out: Array<{ entry: CertificationEntry; quote: string }> = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw);
    if (line.length < 3) continue;
    const single = findSingleDate(line);
    const expires = /(?:expires?|valid (?:until|through)|有效期至)\s*[:：]?\s*([A-Za-z]{3,9}\.?\s*\d{4}|\d{4}[./-]\d{1,2}|\d{4})/i.exec(line);
    const idMatch = /(?:credential id|license (?:no\.?|number|#)|certificate (?:no\.?|number)|证书编号|编号)\s*[:：#]?\s*([A-Z0-9-]{4,})/i.exec(line);
    let rest = line;
    for (const m of [expires?.[0], idMatch?.[0], single?.matched]) if (m) rest = rest.replace(m, " ");
    rest = collapse(rest.replace(/[(（]\s*[)）]/g, " ")).replace(/[,，\s\-–—]+$/, "");
    const parts = rest.split(/\s+[-–—|]\s+|\s*[|｜]\s*|,\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    let issuer = parts.slice(1).find((p) => CERT_ISSUERS.test(p)) ?? parts[1] ?? null;
    if (!issuer && CERT_ISSUERS.test(parts[0])) issuer = CERT_ISSUERS.exec(parts[0])![0];
    out.push({
      entry: {
        name: clip(parts[0], 200),
        issuer: issuer ? clip(issuer, 120) : null,
        date: single?.date ?? null,
        expires: expires ? (findSingleDate(expires[1])?.date ?? null) : null,
        credentialId: idMatch?.[1] ?? null,
      },
      quote: raw,
    });
  }
  return out.slice(0, 30);
}

/* ------------------------------------------------------------------ whole résumé */

export interface ParsedResume {
  language: "en" | "zh";
  header: HeaderInfo;
  summary: Sourced<string> | null;
  experience: Array<{ entry: ExperienceEntry; quote: string }>;
  education: Array<{ entry: EducationEntry; quote: string }>;
  projects: Array<{ entry: ProjectEntry; quote: string }>;
  skills: Array<{ entry: SkillEntry; quote: string }>;
  languages: Array<{ value: string; quote: string; test?: { name: string; score: string } }>;
  achievements: Array<{ entry: AchievementEntry; quote: string }>;
  certifications: Array<{ entry: CertificationEntry; quote: string }>;
  researchInterests: Sourced<string[]> | null;
  sections: SectionKey[];
  /** Lines of sections the résumé parser doesn't own (publications, grants, talks…), for other parsers. */
  rest: Partial<Record<SectionKey, string[]>>;
}

function quoteOf(lines: string[]): string {
  return clip(lines.join(" / "), 300);
}

const EXPERIENCE_SECTIONS: Partial<Record<SectionKey, string | null>> = {
  experience: null,
  internships: "internship",
  volunteer: "volunteer",
  activities: "activity",
  research: "research",
  teaching: "teaching",
};

/** Page footers and similar PDF noise ("Page 1 of 2", "第 1 页 共 2 页"). */
const NOISE_LINE = /^\s*(page \d+ (of|\/) \d+|\d+\s*\/\s*\d+|第\s*\d+\s*页.*|- \d+ -)\s*$/i;

/**
 * LinkedIn's "Save to PDF" export puts the sidebar (Contact, Top Skills, Languages,
 * Certifications…) before the name, headline and location. Move those three lines to the
 * top so the header parser sees them where a résumé has them.
 */
export function restructureLinkedIn(text: string): string {
  if (!/\(LinkedIn\)/.test(text) || !/^\s*(Top Skills|Contact)\s*$/m.test(text)) return text;
  const ls = text.split("\n");
  const main = ls.findIndex((l, i) => i > 0 && /^\s*(Summary|Experience)\s*$/.test(l));
  if (main < 2) return text;
  const isName = (l: string | undefined) => Boolean(l && (englishName(l) || chineseName(l)));
  // Name, headline, location right before the first main heading; the location line is the anchor.
  let k = -1;
  if (looksLikeLocation(ls[main - 1] ?? "") && isName(ls[main - 3])) k = main - 3;
  else if (isName(ls[main - 2])) k = main - 2;
  else if (isName(ls[main - 1])) k = main - 1;
  if (k < 0) return text;
  const take = [k];
  for (let i = k + 1; i < main; i++) take.push(i);
  const head = take.map((i) => ls[i]);
  const rest = ls.filter((_l, i) => !take.includes(i));
  return [...head, ...rest].join("\n");
}

export function parseResume(input: string): ParsedResume {
  const text = restructureLinkedIn(
    input
      .split("\n")
      .filter((l) => !NOISE_LINE.test(l))
      .join("\n"),
  );
  const sections = splitSections(text);
  const header = parseHeader(sections.find((s) => s.key === "header")?.lines ?? [], text);
  const parsed: ParsedResume = {
    language: detectLanguage(text),
    header,
    summary: null,
    experience: [],
    education: [],
    projects: [],
    skills: [],
    languages: [],
    achievements: [],
    certifications: [],
    researchInterests: null,
    sections: sections.map((s) => s.key),
    rest: {},
  };

  for (const section of sections) {
    const key = section.key;
    if (key in EXPERIENCE_SECTIONS) {
      for (const raw of splitEntries(section.lines)) {
        const entry = toExperience(raw, EXPERIENCE_SECTIONS[key] ?? null);
        if (entry && (entry.title || entry.organization)) parsed.experience.push({ entry, quote: quoteOf(raw.header.length ? raw.header : raw.lines.slice(0, 2)) });
      }
    } else if (key === "education") {
      for (const raw of splitEntries(section.lines, { splitOnInstitution: true })) {
        const entry = toEducation(raw);
        if (entry) parsed.education.push({ entry, quote: quoteOf(raw.header.length ? raw.header : raw.lines.slice(0, 2)) });
      }
    } else if (key === "projects") {
      for (const raw of splitEntries(section.lines)) {
        const entry = toProject(raw);
        if (entry) parsed.projects.push({ entry, quote: quoteOf(raw.header.length ? raw.header : raw.lines.slice(0, 2)) });
      }
    } else if (key === "skills") {
      parsed.skills.push(...parseSkills(section.lines));
    } else if (key === "languages") {
      parsed.languages.push(...parseLanguages(section.lines));
    } else if (key === "awards") {
      parsed.achievements.push(...parseAchievements(section.lines));
    } else if (key === "certifications") {
      parsed.certifications.push(...parseCertifications(section.lines));
    } else if (key === "summary" || key === "objective") {
      const textBlock = section.lines.map(stripBullet).join(" ");
      if (key === "objective") {
        for (const t of textBlock.split(/[、,，/|｜;；]/).map((x) => x.replace(/^(期望职位|意向岗位|求职意向|期望城市|工作地点)\s*[:：]\s*/, "").trim()).filter((x) => x && x.length <= 30)) {
          if (looksLikeLocation(t)) header.targetLocations.push({ value: t, quote: quoteOf(section.lines) });
          else if (TITLE_WORDS.test(t)) header.targetTitles.push({ value: t, quote: quoteOf(section.lines) });
        }
      }
      if (!parsed.summary && textBlock.length > 20) parsed.summary = { value: clip(textBlock, 1200), quote: quoteOf(section.lines) };
    } else if (key === "research_interests") {
      const items = section.lines.flatMap((l) => stripBullet(l).split(/\s*[,;、，；]\s*/)).map((s) => s.trim()).filter((s) => s && s.length <= 80);
      if (items.length) parsed.researchInterests = { value: uniq(items).slice(0, 15), quote: quoteOf(section.lines) };
    } else if (key === "personal") {
      // Labelled contact fields are read by parseHeader from the whole text; re-run on this block.
      const extra = parseHeader(section.lines, section.lines.join("\n"));
      for (const k of ["email", "phone", "location", "birthYear"] as const) if (!header[k] && extra[k]) (header as unknown as Record<string, unknown>)[k] = extra[k];
      if (!header.name && extra.name) header.name = extra.name;
      header.targetTitles.push(...extra.targetTitles);
      header.targetLocations.push(...extra.targetLocations);
    } else if (key !== "header") {
      parsed.rest[key] = [...(parsed.rest[key] ?? []), ...section.lines];
    }
  }

  // No headings at all (a pasted bio, a one-paragraph profile): keep the text as the summary.
  if (sections.length === 1 && !parsed.summary) {
    const body = sections[0].lines.filter((l) => !findEmail(l) && !findPhone(l)).join(" ");
    if (body.length > 80) parsed.summary = { value: clip(body, 1200), quote: clip(body, 300) };
  }
  // Location fallback: the most recent role's location.
  if (!header.location) {
    const loc = parsed.experience.find((e) => e.entry.location && countryOfLocation(e.entry.location))?.entry.location;
    if (loc) header.location = { value: loc, quote: parsed.experience.find((e) => e.entry.location === loc)!.quote };
  }
  header.targetTitles = uniq(header.targetTitles, (t) => t.value.toLowerCase());
  header.targetLocations = uniq(header.targetLocations, (t) => t.value.toLowerCase());
  return parsed;
}
