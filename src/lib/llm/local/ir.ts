import { emptyIR, type ExtractDocument, type ExtractionIR, type Src } from "../types";
import { parseDeck } from "./deck";
import { ORCID_RE, findHIndex, parseGrants, parsePublications } from "./research";
import { parseResume, splitSections, type ParsedResume } from "./resume";
import { collapse, findEmail, findMoney, findUrls, lines as splitLines, stripBullet, uniq } from "./text";

/*
 * Documents → extraction IR with the local parsers. One function per document family:
 * résumés/CVs (and anything with résumé structure), decks/business plans, link documents
 * produced by src/lib/ingest/url.ts (GitHub, ORCID, web pages), single papers, certificates
 * and licences. Quotes are verbatim lines (multi-line evidence joined with " / ").
 */

const MAX_QUOTE = 300;

/** Cuts without an ellipsis so the quote stays a substring of the source. */
function verbatim(s: string, max = MAX_QUOTE): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

function src(docId: string, quote: string, confidence: number): Src {
  return { docId, quote: verbatim(quote), confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)) };
}

function firstLine(quote: string): string {
  return quote.split(" / ")[0];
}

/* ------------------------------------------------------------------ résumé / CV */

function resumeToIR(doc: ExtractDocument, parsed: ParsedResume, ir: ExtractionIR, weight: number): void {
  const id = doc.id;
  const h = parsed.header;
  const add = (field: ExtractionIR["identity"][number]["field"], value: string | number | null | undefined, quote: string | undefined, conf: number) => {
    if (value === null || value === undefined || value === "" || !quote) return;
    ir.identity.push({ field, value: String(value), src: src(id, quote, conf * weight) });
  };
  add("name", h.name?.value, h.name?.quote, 0.8);
  add("headline", h.headline?.value, h.headline?.quote, 0.7);
  add("email", h.email?.value, h.email?.quote, 0.97);
  add("phone", h.phone?.value, h.phone?.quote, 0.92);
  add("location", h.location?.value, h.location?.quote, 0.75);
  add("birthYear", h.birthYear?.value, h.birthYear?.quote, 0.9);
  if (parsed.summary) add("summary", parsed.summary.value, parsed.summary.quote, 0.8);
  for (const l of h.links) ir.links.push({ url: l.value, label: null, src: src(id, l.quote, 0.9 * weight) });

  for (const l of parsed.languages) {
    if (l.test) ir.testScores.push({ test: l.test.name, score: l.test.score || l.value, src: src(id, l.quote, 0.85) });
    ir.languages.push({ name: l.value, level: null, src: src(id, l.quote, 0.8 * weight) });
  }
  for (const t of h.targetTitles) ir.jobSeeker.targetTitles.push({ value: t.value, src: src(id, t.quote, 0.75) });
  for (const t of h.targetLocations) ir.jobSeeker.locations.push({ value: t.value, src: src(id, t.quote, 0.75) });

  for (const { entry: e, quote } of parsed.experience) {
    const complete = (e.title ? 0.3 : 0) + (e.organization ? 0.3 : 0) + (e.start ? 0.2 : 0) + 0.15;
    ir.experience.push({
      organization: e.organization,
      title: e.title,
      employmentType: e.type,
      location: e.location,
      startDate: e.start,
      endDate: e.end,
      current: e.current,
      summary: null,
      highlights: e.highlights,
      skills: [],
      src: src(id, quote, complete * weight),
    });
  }
  for (const { entry: e, quote } of parsed.education) {
    ir.education.push({
      institution: e.institution,
      degree: e.degree,
      level: e.level,
      field: e.field,
      location: e.location,
      startDate: e.start,
      endDate: e.end,
      current: e.current,
      gpa: e.gpa,
      honors: e.highlights.filter((x) => !/^(dissertation|thesis|毕业论文|学位论文)/i.test(x)),
      courses: [],
      description: e.highlights.find((x) => /^(dissertation|thesis|毕业论文|学位论文)/i.test(x)) ?? null,
      src: src(id, quote, (e.degree || e.level ? 0.85 : 0.65) * weight),
    });
  }
  // Coursework belongs to the most recent education entry.
  const coursework = parsed.rest.coursework;
  if (coursework?.length && ir.education.length) {
    const target = ir.education[ir.education.length - parsed.education.length];
    if (target) target.courses = uniq(coursework.flatMap((l) => stripBullet(l).split(/\s*[,;、，；]\s*/)).filter((c) => c && c.length <= 80)).slice(0, 20);
  }
  for (const { entry: p, quote } of parsed.projects) {
    ir.projects.push({ name: p.name, role: p.role, url: p.url, startDate: p.start, endDate: p.end, summary: p.summary, highlights: p.highlights, skills: [], src: src(id, quote, 0.75 * weight) });
  }
  for (const { entry: s, quote } of parsed.skills) ir.skills.push({ name: s.name, category: s.category, level: s.level, src: src(id, quote, 0.8 * weight) });
  for (const { entry: a, quote } of parsed.achievements) {
    ir.achievements.push({ title: a.title, kind: null, issuer: a.issuer, date: a.date, amountText: findMoney(quote)[0]?.text ?? null, description: a.description, src: src(id, quote, 0.75 * weight) });
  }
  for (const { entry: c, quote } of parsed.certifications) {
    if (isLicenseLine(quote)) {
      ir.licenses.push({ type: c.name, number: c.credentialId, jurisdiction: null, expiresAt: c.expires, src: src(id, quote, 0.75) });
    } else {
      ir.certifications.push({ name: c.name, issuer: c.issuer, credentialId: c.credentialId, issuedAt: c.date, expiresAt: c.expires, src: src(id, quote, 0.8 * weight) });
    }
  }
  if (parsed.researchInterests) {
    for (const f of parsed.researchInterests.value) ir.research.fields.push({ value: f, src: src(id, parsed.researchInterests.quote, 0.8) });
  }
  const pubs = parsed.rest.publications;
  if (pubs?.length) {
    for (const { entry: p, quote } of parsePublications(pubs)) {
      ir.publications.push({ title: p.title, kind: p.kind, status: p.status, venue: p.venue, year: p.year, authors: p.authors, doi: p.doi, url: p.url, src: src(id, quote, 0.8 * weight) });
    }
  }
  const grants = parsed.rest.grants;
  if (grants?.length) {
    for (const { entry: g, quote } of parseGrants(grants)) ir.research.grants.push({ title: g.title, funder: g.funder, year: g.year, amountText: g.amount, src: src(id, quote, 0.75) });
  }
  for (const key of ["clients", "press"] as const) {
    for (const l of parsed.rest[key] ?? []) {
      for (const b of stripBullet(l).split(/\s*[,;、，；|]\s*/)) if (key === "clients" && b && b.length <= 60) ir.creator.brands.push({ value: b, src: src(id, l, 0.7) });
    }
  }
}

const LICENSE_LINE = /\b(licen[cs]e[ds]?|registered nurse|\brn\b|\bcpa\b|\bpe\b|professional engineer|bar admission|admitted to the bar|board certified|attorney at law|nmls)\b|执业证|执业资格|执照|律师执业|注册会计师|注册建筑师|注册工程师|教师资格证/i;

function isLicenseLine(line: string): boolean {
  return LICENSE_LINE.test(line);
}

/* ------------------------------------------------------------------ deck / business plan */

function deckToIR(doc: ExtractDocument, ir: ExtractionIR): void {
  const d = parseDeck(doc.text);
  if (!d.isFounderDoc && !d.venture.company) return;
  const id = doc.id;
  const v = d.venture;
  const company = v.company ?? (d.email ? d.email.value.split("@")[1]?.split(".")[0] ?? null : null);
  if (!company) return;
  const fields: ExtractionIR["ventures"][number]["fields"] = [];
  const push = (field: string, value: string | number | null | undefined, quoteKey: string, conf: number) => {
    if (value === null || value === undefined || value === "") return;
    const quote = d.quotes[quoteKey];
    if (!quote) return;
    fields.push({ field, value: String(value), src: src(id, quote, conf) });
  };
  push("oneLiner", v.oneLiner, "oneLiner", 0.8);
  push("website", v.website, "website", 0.85);
  push("industry", v.industry, "industry", 0.5);
  push("stage", v.stage, "round", 0.7);
  push("round", v.round, "round", 0.75);
  push("teamSize", v.teamSize, "teamSize", 0.8);
  push("product", v.solution, "solution", 0.75);
  push("problem", v.problem, "problem", 0.75);
  push("market", v.market, "market", 0.7);
  push("businessModel", v.businessModel, "businessModel", 0.75);
  push("useOfFunds", v.useOfFunds, "useOfFunds", 0.75);
  if (v.raising) push("raising", v.raising.text ?? String(v.raising.amount), "raising", 0.8);
  ir.ventures.push({
    company,
    fields,
    traction: v.traction.map((t, i) => ({ text: t, src: src(id, d.quotes[`traction.${i}`] ?? t, 0.8) })),
    team: d.founders.map((f) => ({ name: f.name, role: f.role, background: f.background, src: src(id, f.quote, 0.8) })),
    src: src(id, d.quotes.company ?? company, v.company ? 0.8 : 0.5),
  });
  if (d.email) ir.identity.push({ field: "email", value: d.email.value, src: src(id, d.email.quote, 0.6) });
}

/* ------------------------------------------------------------------ link documents (ingest/url.ts formats) */

function labelled(text: string, label: string): { value: string; line: string } | null {
  const m = new RegExp(`^${label}:\\s*(.+)$`, "m").exec(text);
  return m ? { value: m[1].trim(), line: m[0] } : null;
}

function githubToIR(doc: ExtractDocument, ir: ExtractionIR): boolean {
  const head = labelled(doc.text, "GitHub");
  if (!head) return false;
  const id = doc.id;
  ir.links.push({ url: head.value, label: "GitHub", src: src(id, head.line, 0.95) });
  const name = labelled(doc.text, "Name");
  if (name) ir.identity.push({ field: "name", value: name.value, src: src(id, name.line, 0.6) });
  const bio = labelled(doc.text, "Bio");
  if (bio) ir.identity.push({ field: "headline", value: bio.value, src: src(id, bio.line, 0.45) });
  const loc = labelled(doc.text, "Location");
  if (loc) ir.identity.push({ field: "location", value: loc.value, src: src(id, loc.line, 0.55) });
  const email = labelled(doc.text, "Email");
  if (email) ir.identity.push({ field: "email", value: email.value, src: src(id, email.line, 0.7) });
  const site = labelled(doc.text, "Website");
  if (site) ir.links.push({ url: /^https?:/.test(site.value) ? site.value : `https://${site.value}`, label: null, src: src(id, site.line, 0.8) });
  const langs = labelled(doc.text, "Main languages");
  if (langs) for (const l of langs.value.split(/,\s*/)) ir.skills.push({ name: l, category: "technical", level: null, src: src(id, langs.line, 0.7) });
  const repoLines = splitLines(doc.text).filter((l) => /^- .+\(.*stars.*\)\s+https:\/\/github\.com\//.test(l));
  for (const line of repoLines) {
    const m = /^- ([^:(]+?)(?::\s*(.+?))?\s+\(([^)]*)\)\s+(https:\/\/github\.com\/\S+)$/.exec(line);
    if (!m) continue;
    const meta = m[3].split(/,\s*/);
    const language = meta.find((x) => !/stars$/.test(x) && x.split(" ").length === 1 && /^[A-Z]/.test(x)) ?? null;
    ir.projects.push({ name: m[1].trim(), role: null, url: m[4], startDate: null, endDate: null, summary: m[2]?.trim() ?? null, highlights: [meta.find((x) => /stars$/.test(x)) ?? ""].filter(Boolean), skills: language ? [language] : [], src: src(id, line, 0.8) });
  }
  return true;
}

function orcidToIR(doc: ExtractDocument, ir: ExtractionIR): boolean {
  const head = labelled(doc.text, "ORCID iD");
  if (!head) return false;
  const id = doc.id;
  ir.research.orcid = { value: head.value, src: src(id, head.line, 0.98) };
  ir.links.push({ url: `https://orcid.org/${head.value}`, label: "ORCID", src: src(id, head.line, 0.98) });
  const name = labelled(doc.text, "Name");
  if (name) ir.identity.push({ field: "name", value: name.value, src: src(id, name.line, 0.75) });
  const kw = labelled(doc.text, "Research keywords");
  if (kw) for (const k of kw.value.split(/,\s*/)) ir.research.fields.push({ value: k, src: src(id, kw.line, 0.85) });
  const sections = splitSections(doc.text);
  for (const s of sections) {
    if (s.key === "publications") {
      for (const line of s.lines) {
        const m = /^- (.+?)(?:\. (.+?))?(?: \((\d{4})\))?(?:\. doi:(\S+))?$/.exec(line);
        if (!m) continue;
        ir.publications.push({ title: m[1], kind: null, status: "published", venue: m[2] ?? null, year: m[3] ? Number(m[3]) : null, authors: [], doi: m[4] ?? null, url: m[4] ? `https://doi.org/${m[4]}` : null, src: src(id, line, 0.9) });
      }
    }
    if (s.key === "experience" || s.key === "education") {
      for (const line of s.lines) {
        const m = /^- (.+?) \(([^)]*)\)$/.exec(line);
        if (!m) continue;
        const parts = m[1].split(/,\s*/);
        const org = parts[parts.length - 1];
        const [start, end] = m[2].split(/\s*–\s*/);
        const startDate = start && start !== "?" ? start : null;
        const endDate = end && end !== "Present" ? end : null;
        if (s.key === "experience") {
          ir.experience.push({ organization: org, title: parts.length > 1 ? parts[0] : null, employmentType: null, location: null, startDate, endDate, current: end === "Present", summary: null, highlights: [], skills: [], src: src(id, line, 0.85) });
        } else {
          ir.education.push({ institution: org, degree: parts.length > 1 ? parts[0] : null, level: null, field: parts.length > 2 ? parts[1] : null, location: null, startDate, endDate, current: end === "Present", gpa: null, honors: [], courses: [], description: null, src: src(id, line, 0.85) });
        }
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ single paper, certificate, licence */

function paperToIR(doc: ExtractDocument, ir: ExtractionIR): void {
  const ls = splitLines(doc.text).filter(Boolean);
  const titleLine = ls.slice(0, 8).find((l) => l.length >= 15 && l.length <= 250 && !/^(abstract|arxiv|preprint|journal|proceedings|vol\.|doi|http)/i.test(l) && !findEmail(l));
  if (!titleLine) return;
  const year = /\b(19|20)\d{2}\b/.exec(doc.text.slice(0, 3000));
  const doi = /\b(10\.\d{4,9}\/[^\s,;]+[^\s.,;])/.exec(doc.text.slice(0, 5000));
  ir.publications.push({
    title: collapse(titleLine),
    kind: /arxiv|preprint/i.test(doc.text.slice(0, 3000)) ? "preprint" : null,
    status: "published",
    venue: null,
    year: year ? Number(year[0]) : null,
    authors: [],
    doi: doi ? doi[1] : null,
    url: doi ? `https://doi.org/${doi[1]}` : (doc.sourceUrl ?? null),
    src: src(doc.id, titleLine, 0.55),
  });
}

function certificateToIR(doc: ExtractDocument, ir: ExtractionIR): void {
  const text = doc.text;
  const m = /certificate of ([A-Za-z ]{3,60})|this is to certify that .{2,60}? (?:has (?:successfully )?completed|is awarded|has been awarded) (?:the )?(.{3,120}?)(?:\.|$)|兹证明.{0,30}?(?:获得|荣获|完成)(.{2,60}?)(?:。|$)/im.exec(text);
  const line = m ? splitLines(text).find((l) => l.includes(m[0].slice(0, 30))) ?? m[0] : null;
  if (!m || !line) return;
  const name = collapse((m[1] ?? m[2] ?? m[3] ?? "").replace(/[.。]$/, ""));
  if (!name) return;
  const year = /\b(19|20)\d{2}\b/.exec(text);
  if (doc.kind === "license" || isLicenseLine(text)) {
    const num = /(?:licen[cs]e (?:no\.?|number|#)|registration (?:no\.?|number)|执业证书编号|证书编号|编号)\s*[:：#]?\s*([A-Z0-9-]{4,})/i.exec(text);
    ir.licenses.push({ type: name, number: num?.[1] ?? null, jurisdiction: null, expiresAt: null, src: src(doc.id, line, 0.6) });
  } else {
    ir.certifications.push({ name, issuer: null, credentialId: null, issuedAt: year ? year[0] : null, expiresAt: null, src: src(doc.id, line, 0.6) });
  }
}

/* ------------------------------------------------------------------ cross-document cues */

const WORK_AUTH_CUES: Array<[RegExp, string, string]> = [
  [/\b(u\.?s\.? citizen|united states citizen|american citizen)\b/i, "US", "citizen"],
  [/\b(green card|permanent resident of the u\.?s|us permanent resident)\b/i, "US", "permanent_resident"],
  [/\b(h-?1b|o-?1|l-?1|tn visa)\b/i, "US", "work_visa"],
  [/\b(f-?1|opt|stem opt|cpt)\b/i, "US", "student_visa"],
  [/\b(require[s]? (visa )?sponsorship|need[s]? (visa )?sponsorship)\b/i, "US", "needs_sponsorship"],
  [/\bauthori[sz]ed to work in the (us|u\.s\.|united states)\b/i, "US", "other"],
  [/\b(uk citizen|british citizen|right to work in the uk|settled status|indefinite leave to remain)\b/i, "GB", "citizen"],
  [/\b(canadian citizen|canadian permanent resident)\b/i, "CA", "citizen"],
  [/中国国籍|中国公民/, "CN", "citizen"],
];

function workAuthToIR(doc: ExtractDocument, ir: ExtractionIR): void {
  for (const line of splitLines(doc.text).slice(0, 400)) {
    for (const [re, country, status] of WORK_AUTH_CUES) {
      if (re.test(line) && line.length < 200) {
        ir.workAuthorization.push({ countryCode: country, status, note: null, src: src(doc.id, line, 0.75) });
      }
    }
  }
}

const AUDIENCE_RE = /(\d+(?:[.,]\d+)?)\s*(k|m|万)?\+?\s*(subscribers|followers|粉丝|订阅)\s*(?:on\s+)?(youtube|instagram|tiktok|x|twitter|bilibili|b站|小红书|xiaohongshu|douyin|抖音|weibo|微博|substack|linkedin|twitch)?/i;

function audienceToIR(doc: ExtractDocument, ir: ExtractionIR): void {
  for (const line of splitLines(doc.text).slice(0, 400)) {
    const m = AUDIENCE_RE.exec(line);
    if (!m) continue;
    const base = Number(m[1].replace(",", "."));
    const scale = m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : m[2].toLowerCase() === "m" ? 1e6 : 1e4) : 1;
    const platform = (m[4] ?? (/(youtube|instagram|tiktok|bilibili|小红书|抖音|微博|twitch|substack)/i.exec(line)?.[1] ?? "unknown")).toLowerCase();
    ir.creator.audience.push({ platform, followers: Math.round(base * scale), url: findUrls(line)[0] ?? null, src: src(doc.id, line, 0.7) });
  }
}

/* ------------------------------------------------------------------ entry point */

const KIND_ORDER: Record<string, number> = { resume: 0, cv: 1, link: 3, portfolio: 4, deck: 5, business_plan: 6, paper: 7, transcript: 8, certificate: 9, license: 9, cover_letter: 10, other: 11 };

/** Runs the right parser per document and concatenates the IR (résumés first: they win identity fields). */
export function documentsToIR(documents: ExtractDocument[]): ExtractionIR {
  const ir = emptyIR();
  const docs = [...documents].sort((a, b) => (KIND_ORDER[a.kind] ?? 11) - (KIND_ORDER[b.kind] ?? 11));
  for (const doc of docs) {
    const text = doc.text ?? "";
    if (!text.trim()) continue;
    if (doc.kind === "link" || doc.sourceUrl) {
      if (githubToIR(doc, ir) || orcidToIR(doc, ir)) continue;
    }
    if (doc.kind === "deck" || doc.kind === "business_plan" || /\[Slide \d+\]/.test(text.slice(0, 200))) {
      deckToIR(doc, ir);
      // A business plan can also carry résumé-like founder bios; decks rarely do.
      if (doc.kind !== "business_plan") {
        workAuthToIR(doc, ir);
        continue;
      }
    }
    if (doc.kind === "paper") {
      paperToIR(doc, ir);
      continue;
    }
    if (doc.kind === "certificate" || doc.kind === "license") {
      certificateToIR(doc, ir);
      continue;
    }
    if (doc.kind === "transcript") {
      const parsed = parseResume(text);
      resumeToIR(doc, { ...parsed, experience: [], projects: [], skills: [] }, ir, 0.8);
      continue;
    }
    const parsed = parseResume(text);
    // Personal sites and portfolios are weaker identity sources than a résumé.
    const weight = doc.kind === "resume" || doc.kind === "cv" ? 1 : doc.kind === "cover_letter" ? 0.6 : 0.85;
    resumeToIR(doc, parsed, ir, weight);
    workAuthToIR(doc, ir);
    audienceToIR(doc, ir);
    const orcid = ORCID_RE.exec(text);
    if (orcid && !ir.research.orcid) {
      const line = splitLines(text).find((l) => l.includes(orcid[1])) ?? orcid[1];
      ir.research.orcid = { value: orcid[1], src: src(doc.id, line, 0.95) };
      ir.links.push({ url: `https://orcid.org/${orcid[1]}`, label: "ORCID", src: src(doc.id, line, 0.95) });
    }
    const h = findHIndex(text);
    if (h !== null && !ir.research.hIndex) {
      const line = splitLines(text).find((l) => /h[- ]?index/i.test(l)) ?? `h-index ${h}`;
      ir.research.hIndex = { value: h, src: src(doc.id, line, 0.9) };
    }
  }
  return ir;
}

export { firstLine };
