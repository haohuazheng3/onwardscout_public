/**
 * Document kind guessing from the filename and the extracted text. Pure and deterministic:
 * the upload pipeline stores the guess on `documents.kind` (the user can change it), and the
 * local intelligence engine uses it to pick a parser (résumé, deck, CV with publications…).
 *
 * Scores are additive evidence per kind; the filename is a strong signal, text cues refine it
 * (a file called "CV.pdf" with a long publications list is a research CV, "resume.pdf" with
 * Abstract/Introduction/References is probably a paper that was misnamed, and so on).
 */

export const DOCUMENT_KINDS = [
  "resume",
  "cv",
  "deck",
  "business_plan",
  "portfolio",
  "transcript",
  "certificate",
  "license",
  "paper",
  "cover_letter",
  "link",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export interface KindGuess {
  kind: DocumentKind;
  /** 0..1, how far the winner is ahead of the runner-up (and how much evidence there was). */
  confidence: number;
  /** Human-readable evidence, e.g. `filename: "resume"`, `text: Experience + Education sections`. */
  reasons: string[];
}

type Scored = Exclude<DocumentKind, "link" | "other">;

interface Cue {
  kind: Scored;
  re: RegExp;
  weight: number;
  label: string;
}

/** Filename cues (matched against the lower-cased basename with separators turned into spaces). */
const FILENAME_CUES: Cue[] = [
  { kind: "resume", re: /\b(resume|résumé|resumé)\b|简历|履历|個人簡歷/, weight: 6, label: "resume" },
  { kind: "cv", re: /\b(cv|curriculum vitae|vita)\b/, weight: 5, label: "cv" },
  { kind: "cover_letter", re: /\bcover ?letter\b|求职信|自荐信|动机信|motivation letter/, weight: 6, label: "cover letter" },
  { kind: "deck", re: /\b(pitch|deck|pitchdeck|investor presentation|teaser)\b|路演|融资|bp ?deck/, weight: 6, label: "pitch deck" },
  { kind: "business_plan", re: /\b(business ?plan|bp)\b|商业计划书|商业计划|计划书/, weight: 6, label: "business plan" },
  { kind: "transcript", re: /\b(transcript|grades?|marksheet|academic record)\b|成绩单|成绩证明/, weight: 6, label: "transcript" },
  { kind: "paper", re: /\b(paper|manuscript|preprint|arxiv|article|thesis|dissertation)\b|论文/, weight: 5, label: "paper" },
  { kind: "portfolio", re: /\b(portfolio|work samples?|showreel|lookbook|case stud(y|ies))\b|作品集|作品/, weight: 6, label: "portfolio" },
  { kind: "certificate", re: /\b(certificate|certification|cert|award|diploma)\b|证书|奖状|获奖|毕业证|学位证/, weight: 5, label: "certificate" },
  { kind: "license", re: /\b(licen[cs]e|permit|registration)\b|执照|执业证|资格证|许可证/, weight: 5, label: "license" },
];

/** Text cues: each counted once; `weight` is added when the cue appears anywhere in the text. */
const TEXT_CUES: Cue[] = [
  // Résumé / CV structure
  { kind: "resume", re: /^\s*(work |professional |employment )?(experience|history)\s*:?\s*$/im, weight: 2, label: "Experience section" },
  { kind: "resume", re: /^\s*(education|academic background)\s*:?\s*$/im, weight: 2, label: "Education section" },
  { kind: "resume", re: /^\s*(skills|technical skills|core competencies|key skills)\s*:?\s*$/im, weight: 2, label: "Skills section" },
  { kind: "resume", re: /^\s*(工作经历|工作经验|实习经历|教育背景|教育经历|专业技能|技能特长|项目经历)\s*[:：]?\s*$/m, weight: 3, label: "简历 sections" },
  { kind: "resume", re: /\b(19|20)\d{2}\s*[-–—~至到]\s*(present|now|current|today|至今|现在|(19|20)\d{2})/i, weight: 1, label: "date ranges" },
  { kind: "cv", re: /^\s*(publications|selected publications|peer[- ]reviewed (articles|publications)|journal articles|conference papers)\s*:?\s*$/im, weight: 4, label: "Publications section" },
  { kind: "cv", re: /^\s*(grants?( and| &) (funding|awards)|research funding|research grants|teaching( experience)?|invited talks|service)\s*:?\s*$/im, weight: 2, label: "academic CV sections" },
  { kind: "cv", re: /^\s*(发表论文|学术成果|科研项目|研究经历|学术论文)\s*[:：]?\s*$/m, weight: 3, label: "学术简历 sections" },
  // Paper
  { kind: "paper", re: /^\s*abstract\s*[:.]?\s*$/im, weight: 3, label: "Abstract" },
  { kind: "paper", re: /^\s*(\d\.?\s*)?introduction\s*$/im, weight: 2, label: "Introduction" },
  { kind: "paper", re: /^\s*(references|bibliography)\s*$/im, weight: 2, label: "References" },
  { kind: "paper", re: /\bet al\.|\bdoi:\s*10\.\d{4,}|arXiv:\d{4}\.\d{4,5}/i, weight: 1, label: "citations" },
  { kind: "paper", re: /^\s*(摘要|关键词|参考文献|引言)\s*[:：]?/m, weight: 3, label: "论文 structure" },
  // Deck
  { kind: "deck", re: /^\s*(the )?problem\s*$/im, weight: 2, label: "Problem slide" },
  { kind: "deck", re: /^\s*(our |the )?solution\s*$/im, weight: 2, label: "Solution slide" },
  { kind: "deck", re: /\b(traction|go[- ]to[- ]market|market size|tam\b|sam\b|som\b|competition|competitive landscape)\b/i, weight: 2, label: "market/traction" },
  { kind: "deck", re: /\b(the ask|we are raising|raising \$|use of funds|pre-?seed|seed round|series [ab])\b/i, weight: 3, label: "fundraising ask" },
  { kind: "deck", re: /痛点|解决方案|市场规模|竞品|融资需求|本轮融资|资金用途|商业模式/, weight: 3, label: "路演 cues" },
  // Business plan
  { kind: "business_plan", re: /\bexecutive summary\b/i, weight: 3, label: "Executive summary" },
  { kind: "business_plan", re: /\b(financial projections?|financial plan|pro forma|income statement|break-?even|operating plan|management team)\b/i, weight: 3, label: "financial plan" },
  { kind: "business_plan", re: /执行摘要|财务预测|财务规划|盈利预测|运营计划|股权结构/, weight: 3, label: "计划书 cues" },
  // Transcript
  { kind: "transcript", re: /\b(gpa|grade point average|cumulative|credits? (earned|attempted)|semester|term gpa|course (code|title))\b/i, weight: 2, label: "grades" },
  { kind: "transcript", re: /\bofficial transcript\b|成绩单|学分绩点|课程名称|学分/i, weight: 4, label: "transcript" },
  // Certificate
  { kind: "certificate", re: /\b(this is to certify|certificate of (completion|achievement|participation|excellence)|is hereby awarded|has successfully completed)\b/i, weight: 5, label: "certificate wording" },
  { kind: "certificate", re: /兹证明|特发此证|荣获|证书编号/, weight: 5, label: "证书 wording" },
  // License
  { kind: "license", re: /\b(license (no|number|#)|licensed to practi[cs]e|registration (no|number)|board of (nursing|medicine|accountancy)|bar (number|admission))\b/i, weight: 5, label: "license wording" },
  { kind: "license", re: /执业证书|执业资格|执照号|注册号|资格证书编号/, weight: 5, label: "执照 wording" },
  // Portfolio
  { kind: "portfolio", re: /\b(case study|selected work|client:|role: .*\b(design|art direction)|behance|dribbble)\b/i, weight: 2, label: "portfolio cues" },
  // Cover letter
  { kind: "cover_letter", re: /^\s*dear (hiring|recruiting|search|selection) (manager|team|committee)/im, weight: 5, label: "letter salutation" },
  { kind: "cover_letter", re: /^\s*(sincerely|best regards|kind regards|yours (sincerely|faithfully)),?\s*$/im, weight: 2, label: "letter closing" },
  { kind: "cover_letter", re: /尊敬的.{0,12}(招聘|HR|领导|负责人)|此致\s*敬礼/, weight: 5, label: "求职信 wording" },
];

function basename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[a-z0-9]{1,5}$/i, "");
}

function extension(filename: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** Turns "Jane_Doe-Resume2026" into "jane doe resume 2026" so word boundaries work. */
function filenameWords(filename: string): string {
  return basename(filename)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/[_\-.+()[\]]+/g, " ")
    .toLowerCase()
    .trim();
}

export interface GuessInput {
  filename?: string | null;
  text?: string | null;
  contentType?: string | null;
  /** Number of pages/slides when known: long PDFs lean to CV/paper/BP, short ones to résumé. */
  pages?: number | null;
}

export function guessDocumentKind(input: GuessInput): KindGuess {
  const scores = new Map<Scored, number>();
  const reasons = new Map<Scored, string[]>();
  const add = (kind: Scored, weight: number, reason: string) => {
    scores.set(kind, (scores.get(kind) ?? 0) + weight);
    const list = reasons.get(kind) ?? [];
    list.push(reason);
    reasons.set(kind, list);
  };

  const filename = input.filename ?? "";
  const words = filenameWords(filename);
  for (const cue of FILENAME_CUES) {
    if (cue.re.test(words)) add(cue.kind, cue.weight, `filename: ${cue.label}`);
  }

  const ext = extension(filename);
  const ct = (input.contentType ?? "").toLowerCase();
  if (ext === "pptx" || ext === "ppt" || ext === "key" || ct.includes("presentation")) add("deck", 3, "slides format");
  if (/^image\//.test(ct) || ["png", "jpg", "jpeg", "webp", "heic", "gif"].includes(ext)) {
    add("certificate", 1, "image (scans are often certificates)");
    add("portfolio", 1, "image (could be a work sample)");
  }

  const text = (input.text ?? "").slice(0, 60_000);
  if (text) {
    for (const cue of TEXT_CUES) {
      if (cue.re.test(text)) add(cue.kind, cue.weight, `text: ${cue.label}`);
    }
    // An academic CV is a résumé with publications; both cues fire, and length breaks the tie.
    const pubLines = countPublicationLines(text);
    if (pubLines >= 3) add("cv", Math.min(4, pubLines / 2), `text: ${pubLines} publication-like lines`);
    // Contact block on top: very characteristic of résumés/CVs.
    const head = text.slice(0, 600);
    if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(head) && /(\+?\d[\d\s().-]{7,}\d)/.test(head)) {
      add("resume", 2, "text: contact details at the top");
      add("cv", 1, "text: contact details at the top");
    }
  }

  const pages = input.pages ?? null;
  if (pages !== null) {
    if (pages <= 3) add("resume", 1, "short document");
    if (pages >= 5) add("cv", 0.5, "long document");
    if (pages >= 8) {
      add("business_plan", 1, "long document");
      add("paper", 0.5, "long document");
    }
  }

  // A file named "CV" without academic content is a résumé in most countries.
  if ((scores.get("cv") ?? 0) > 0 && (scores.get("resume") ?? 0) > 0 && countPublicationLines(text) < 3 && !/publications|发表论文/i.test(text)) {
    add("resume", 1.5, "CV without publications reads as a résumé");
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || ranked[0][1] < 2) {
    return { kind: "other", confidence: 0, reasons: ranked.length ? [`weak evidence for ${ranked[0][0]}`] : ["no cues"] };
  }
  const [winner, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const margin = (top - second) / Math.max(top, 1);
  const strength = Math.min(1, top / 10);
  const confidence = Math.round(Math.min(1, 0.35 + margin * 0.45 + strength * 0.2) * 100) / 100;
  return { kind: winner, confidence, reasons: reasons.get(winner) ?? [] };
}

/** Lines that look like citations: a year, a quoted or title-cased segment and a venue-ish word. */
export function countPublicationLines(text: string): number {
  let n = 0;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (line.length < 30 || line.length > 600) continue;
    const year = /\((19|20)\d{2}[a-z]?\)|\b(19|20)\d{2}\b/.test(line);
    const venue = /\b(journal|proceedings|conference|symposium|workshop|transactions|letters|review|arxiv|preprint|press|vol\.|pp\.|in proc|nature|science|ieee|acm|neurips|icml|iclr|cvpr|acl|emnlp|chi)\b|期刊|学报|会议/i.test(line);
    const authors = /[A-Z][a-z]+,\s*[A-Z]\.|[A-Z]\.\s*[A-Z][a-z]+|et al\./.test(line);
    if (year && (venue || authors) && (venue || /["“”]/.test(line))) n++;
  }
  return n;
}
