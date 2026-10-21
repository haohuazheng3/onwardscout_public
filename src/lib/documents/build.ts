import { getMaterial, isMaterialId } from "@/lib/core/materials";
import type { GeneratedBlock, GeneratedDocumentKind, MaterialId } from "@/lib/core/types";
import { hasCjk } from "@/lib/core/labels";
import { readProfile, type ComposedDocument, type ComposeKind, type FactRef, type Intelligence, type OpportunityInput, type QuestionKey, type Tone } from "@/lib/llm/types";
import { documentMetaSchema, type DocumentGap, type DocumentLabel, type StoredContent } from "./content";
import { buildResume } from "./resume";

/*
 * Pure composition core (no DB, no network of its own): given the person's profile + facts and
 * an Intelligence instance, produce a stored document. `compose.ts` wraps it with the database;
 * tests drive it with the local engine.
 *
 * Kinds and how they are made:
 *   cover_letter / one_pager / bio / email   → intelligence.compose (local templates or Claude)
 *   statement / proposal / press_release      → sections, each an intelligence.compose "answer"
 *   pitch_notes                               → the founder one-pager, rendered as slides
 *   resume_variant                            → deterministic assembly from backed items (resume.ts)
 *   answers                                   → the application's own answers as field blocks
 *   other                                     → material-specific lists (publication list, checklists)
 * Whatever only the person can supply becomes a gap block + a `gaps[]` entry, never invented.
 */

export type DocLanguage = "en" | "zh";

export class UnsupportedDocumentError extends Error {
  constructor(readonly kind: string, readonly material?: string | null) {
    super(`No composer for ${kind}${material ? ` (${material})` : ""}: the person supplies this one.`);
    this.name = "UnsupportedDocumentError";
  }
}

/* ------------------------------------------------------------------ language */

/** Composition language: the opportunity's language when known, else its own text, else the person's locale. */
export function documentLanguage(opp: { languages?: string[] | null; name?: string | null; orgName?: string | null; summary?: string | null } | null | undefined, userLocale: string | null | undefined): DocLanguage {
  const langs = (opp?.languages ?? []).map((l) => l.toLowerCase());
  const hasZh = langs.some((l) => l === "zh" || l.startsWith("zh-") || l === "cmn");
  const hasEn = langs.some((l) => l === "en" || l.startsWith("en-"));
  if (hasZh && !hasEn) return "zh";
  if (hasEn && !hasZh) return "en";
  if (hasZh && hasEn) return userLocale === "zh" ? "zh" : "en";
  if (langs.length) return "en"; // another language: we write in English and say so
  const text = [opp?.name, opp?.orgName, opp?.summary].filter(Boolean).join(" ");
  if (text) {
    if (hasCjk(text)) return "zh";
    if (/[A-Za-z]{3}/.test(text)) return "en";
  }
  return userLocale === "zh" ? "zh" : "en";
}

/** Narrows any BCP 47 tag to a composition language. */
export function composeLanguage(lang: string | null | undefined, fallback: DocLanguage = "en"): DocLanguage {
  if (!lang) return fallback;
  const l = lang.toLowerCase();
  if (l === "zh" || l.startsWith("zh-")) return "zh";
  if (l === "en" || l.startsWith("en-")) return "en";
  return fallback;
}

/* ------------------------------------------------------------------ materials → documents */

/** Materials we compose ourselves, with the document kind each one becomes. */
const OTHER_BUILDERS = new Set<MaterialId>(["publication_list", "document_checklist", "evidence_list"]);

/** The generated kind for a material, or null when only the person can supply it. */
export function kindForMaterial(material: string): GeneratedDocumentKind | null {
  if (!isMaterialId(material)) return null;
  const def = getMaterial(material);
  if (def.producedBy === "user" || !def.generatedKind) return null;
  if (def.generatedKind === "other" && !OTHER_BUILDERS.has(material)) return null;
  return def.generatedKind;
}

const ACADEMIC_TYPES = new Set(["phd_position", "postdoc", "visiting_scholar", "collaborator", "editorial_role", "industry_partnership", "conference_cfp", "journal"]);

/** Which outreach email fits the opportunity (CH4). */
export function emailComposeKind(oppType: string | null | undefined, contactKind?: string | null): ComposeKind {
  const k = contactKind ?? "";
  if (k === "investor" || oppType === "investor") return "email_investor";
  if (k === "professor" || ACADEMIC_TYPES.has(oppType ?? "")) return "email_professor";
  if (k === "editor" || oppType === "media" || oppType === "podcast" || oppType === "book_publisher") return "email_editor";
  if (k === "brand" || oppType === "brand_partnership") return "email_brand";
  if (k === "client" || oppType === "client_lead" || oppType === "service_provider") return "email_client";
  return "email_recruiter";
}

/* ------------------------------------------------------------------ sections */

interface Section {
  key: QuestionKey | string;
  heading: { en: string; zh: string };
  /** For keys the composer has no notion of: the question asked to the person (a gap). */
  ask?: { en: string; zh: string };
  maxWords?: number;
}

const S = (key: string, en: string, zh: string, maxWords = 170, ask?: { en: string; zh: string }): Section => ({ key, heading: { en, zh }, maxWords, ask });

function sectionsFor(kind: GeneratedDocumentKind, material: string | null | undefined, ventureLike: boolean): Section[] {
  switch (kind) {
    case "statement":
      switch (material) {
        case "research_statement":
          return [S("research_interest", "Research interests", "研究兴趣", 220), S("proud_project", "Work I'm proudest of", "代表性工作", 170)];
        case "artist_statement":
          return [S("about_you", "About my practice", "关于我的创作", 170), S("proud_project", "Recent work", "近期作品", 170)];
        case "nomination_packet":
          return [S("about_you", "About the nominee", "被提名人简介", 170), S("proud_project", "Key achievement", "主要成就", 200)];
        case "promotion_case":
          return [S("experience", "Scope and impact", "职责与成果", 220), S("proud_project", "Highlight", "代表性成果", 170), S("skills", "Skills", "能力", 90)];
        case "recommendation_letters":
          return [S("about_you", "What your referee can speak to", "推荐人可以谈到的内容", 180), S("proud_project", "A concrete example", "一个具体例子", 160)];
        case "transfer_request":
          return [S("experience", "What I do today", "目前的工作", 170), S("why_this", "Why this move", "为什么申请转岗", 120)];
        default:
          return [S("about_you", "About me", "关于我", 180), S("proud_project", "What I'm proudest of", "最自豪的经历", 170), S("why_this", "Why this programme", "为什么申请", 120)];
      }
    case "proposal":
      switch (material) {
        case "research_proposal":
          return [S("research_interest", "Background and aims", "研究背景与目标", 260)];
        case "talk_proposal":
          return [
            S("talk_abstract", "Talk title and abstract", "演讲题目与摘要", 200, { en: "What is your talk called, and what will the audience take away? (title + 2–3 sentences)", zh: "你的演讲题目是什么？听众会收获什么？（题目 + 两三句话）" }),
            S("about_you", "About the speaker", "讲者简介", 120),
          ];
        case "book_proposal":
          return [
            S("book_idea", "The book", "选题", 220, { en: "What is the book about, and who is it for? (2–3 sentences)", zh: "这本书讲什么、写给谁？（两三句话）" }),
            S("about_you", "About the author", "作者简介", 140),
          ];
        default:
          return ventureLike
            ? [S("startup_description", "What we do", "我们在做什么", 140), S("problem", "The problem", "要解决的问题", 140), S("traction", "Traction", "进展与数据", 120), S("team", "Team", "团队", 120), S("use_of_funds", "Use of funds", "资金用途", 100)]
            : [S("about_you", "About me", "关于我", 160), S("proud_project", "Relevant work", "相关经历", 170), S("why_this", "Why this", "申请理由", 120)];
      }
    case "press_release":
      return [
        S("announcement", "The news", "新闻要点", 160, { en: "What is the announcement, in one or two sentences? (who, what, when)", zh: "要发布的消息是什么？用一两句话说清楚（谁、什么、何时）。" }),
        S("about_you", "About", "关于", 120),
      ];
    default:
      return [];
  }
}

const SECTION_DOC_TITLE: Partial<Record<string, { en: string; zh: string }>> = {
  personal_statement: { en: "Personal statement", zh: "个人陈述" },
  research_statement: { en: "Research statement", zh: "研究陈述" },
  artist_statement: { en: "Artist statement", zh: "艺术家陈述" },
  nomination_packet: { en: "Nomination statement", zh: "提名材料" },
  promotion_case: { en: "Promotion case", zh: "晋升材料" },
  recommendation_letters: { en: "Brief for your referees", zh: "给推荐人的要点" },
  transfer_request: { en: "Internal transfer request", zh: "转岗申请" },
  research_proposal: { en: "Research proposal", zh: "研究计划" },
  talk_proposal: { en: "Talk proposal", zh: "演讲提案" },
  book_proposal: { en: "Book proposal", zh: "出版提案" },
  business_plan: { en: "Business plan summary", zh: "商业计划摘要" },
  grant_application: { en: "Application narrative", zh: "申报书正文" },
  project_proposal: { en: "Project proposal", zh: "项目提案" },
};

const KIND_TITLE: Record<GeneratedDocumentKind, { en: string; zh: string }> = {
  cover_letter: { en: "Cover letter", zh: "求职信" },
  resume_variant: { en: "Résumé", zh: "简历" },
  one_pager: { en: "One-pager", zh: "一页纸介绍" },
  email: { en: "Email", zh: "邮件" },
  answers: { en: "Application answers", zh: "申请表答案" },
  statement: { en: "Statement", zh: "陈述" },
  proposal: { en: "Proposal", zh: "提案" },
  bio: { en: "Bio", zh: "个人简介" },
  press_release: { en: "Press release", zh: "新闻稿" },
  pitch_notes: { en: "Pitch notes", zh: "路演讲稿" },
  other: { en: "Document", zh: "文档" },
};

export function defaultTitle(kind: GeneratedDocumentKind, material: string | null | undefined, lang: DocLanguage, opp?: OpportunityInput | null): string {
  const materialTitle = kind === "statement" || kind === "proposal" || kind === "press_release" ? (material ? SECTION_DOC_TITLE[material]?.[lang] : undefined) : undefined;
  const base = materialTitle || KIND_TITLE[kind][lang];
  const target = opp?.orgName || opp?.name;
  if (!target || kind === "resume_variant") return base;
  return lang === "zh" ? `${base}｜${target}` : `${base} — ${target}`;
}

/* ------------------------------------------------------------------ the builder */

export interface BuildAnswerRow {
  key: string;
  label: string;
  value: string;
  factIds: string[];
}

export interface BuildInput {
  ai: Pick<Intelligence, "compose" | "provider">;
  kind: GeneratedDocumentKind;
  /** The material this document satisfies (personal_statement, talk_proposal…); refines statements and proposals. */
  material?: string | null;
  profile: unknown;
  facts: FactRef[];
  opportunity?: OpportunityInput | null;
  /** The person's own answers ({why_this: "…"}), cited as `answer:<key>`. */
  answers?: Record<string, string>;
  language: DocLanguage;
  tone?: Tone;
  maxWords?: number;
  contact?: { name?: string | null; org?: string | null; role?: string | null; kind?: string | null } | null;
  /** For a follow-up email: the message being followed up. */
  previous?: { subject?: string | null; sentAt?: string | Date | null } | null;
  /** For `answers`: the rows to lay out. */
  answerRows?: BuildAnswerRow[];
  /** For `other` checklists: the materials the organiser asks for (labels already localized). */
  checklist?: string[];
  now?: Date;
}

export interface BuiltDocument {
  title: string;
  content: StoredContent;
  /** Fact ids and `answer:` keys the document rests on. */
  sources: string[];
  gaps: DocumentGap[];
  label: DocumentLabel;
}

interface Piece {
  blocks: GeneratedBlock[];
  roles: string[];
  gaps: DocumentGap[];
  notes: string[];
  label: DocumentLabel;
}

function fromComposed(doc: ComposedDocument, opts: { keepStructure?: boolean } = {}): Piece {
  const blocks: GeneratedBlock[] = [];
  const roles: string[] = [];
  const questionByPlaceholder = new Map<string, string>();
  doc.gaps.forEach((g, i) => {
    const gapBlocks = doc.blocks.filter((b) => b.role === "gap");
    if (gapBlocks[i]) questionByPlaceholder.set(gapBlocks[i].text, g.question);
  });
  for (const b of doc.blocks) {
    if (!opts.keepStructure && ["subject", "greeting", "closing", "signature"].includes(b.role)) continue;
    const label = b.role === "gap" ? (questionByPlaceholder.get(b.text) ?? b.label) : b.label;
    blocks.push({ type: b.type, ...(label ? { label } : {}), text: b.text, factIds: b.factIds, flags: b.flags });
    roles.push(b.role);
  }
  return { blocks, roles, gaps: doc.gaps, notes: doc.notes, label: doc.label === "written_with_ai" ? "written_with_ai" : "drafted_from_profile" };
}

function ventureLikeProfile(profile: ReturnType<typeof readProfile>): boolean {
  return (profile.packs.founder?.ventures?.length ?? 0) > 0;
}

function gapPiece(key: string, question: string, placeholder: string): Piece {
  return {
    blocks: [{ type: "paragraph", label: question, text: placeholder, factIds: [], flags: ["needs_confirmation"] }],
    roles: ["gap"],
    gaps: [{ key, question }],
    notes: [],
    label: "drafted_from_profile",
  };
}

function merge(pieces: Piece[]): Piece {
  const out: Piece = { blocks: [], roles: [], gaps: [], notes: [], label: "drafted_from_profile" };
  for (const p of pieces) {
    out.blocks.push(...p.blocks);
    out.roles.push(...p.roles);
    for (const g of p.gaps) if (!out.gaps.some((x) => x.key === g.key)) out.gaps.push(g);
    for (const n of p.notes) if (!out.notes.includes(n)) out.notes.push(n);
    if (p.label === "written_with_ai") out.label = "written_with_ai";
  }
  return out;
}

async function composeSections(input: BuildInput, sections: Section[]): Promise<Piece> {
  const lang = input.language;
  const pieces: Piece[] = [];
  for (const s of sections) {
    const heading: Piece = { blocks: [{ type: "heading", text: s.heading[lang], factIds: [], flags: [] }], roles: ["heading"], gaps: [], notes: [], label: "drafted_from_profile" };
    const own = input.answers?.[s.key];
    if (s.ask) {
      // A section only the person can write (their talk, their book, their news).
      pieces.push(heading, own ? { blocks: [{ type: "paragraph", text: own.trim(), factIds: [`answer:${s.key}`], flags: [] }], roles: ["body"], gaps: [], notes: [], label: "drafted_from_profile" } : gapPiece(s.key, s.ask[lang], lang === "zh" ? `【${s.heading.zh}：需要你本人来写】` : `[${s.heading.en}: in your own words]`));
      continue;
    }
    const doc = await input.ai.compose({
      kind: "answer",
      profile: input.profile,
      facts: input.facts,
      opportunity: input.opportunity ?? null,
      answers: input.answers ?? {},
      language: lang,
      tone: input.tone ?? "professional",
      questionKey: s.key as QuestionKey,
      question: s.heading[lang],
      maxWords: s.maxWords,
      now: input.now,
    });
    const piece = fromComposed(doc);
    if (!piece.blocks.length) continue;
    pieces.push(heading, piece);
  }
  return merge(pieces);
}

function publicationList(input: BuildInput): Piece {
  const profile = readProfile(input.profile);
  const lang = input.language;
  const out: Piece = { blocks: [], roles: [], gaps: [], notes: [], label: "drafted_from_profile" };
  const ids = (pubId: string) => input.facts.filter((f) => f.path === `/publications/${pubId}` || f.path.startsWith(`/publications/${pubId}/`)).map((f) => f.id);
  out.blocks.push({ type: "heading", text: lang === "zh" ? "论文与出版" : "Publications", factIds: [], flags: [] });
  out.roles.push("heading");
  for (const p of profile.publications) {
    const backing = ids(p.id);
    if (!backing.length) continue;
    const authors = p.authors.length ? `${p.authors.join(", ")}. ` : "";
    const venue = [p.venue, p.year].filter(Boolean).join(", ");
    out.blocks.push({ type: "bullet", text: `${authors}${p.title}${venue ? `. ${venue}` : ""}${p.doi ? `. doi:${p.doi}` : ""}`, factIds: backing, flags: [] });
    out.roles.push("body");
  }
  if (out.blocks.length === 1) return merge([out, gapPiece("publications", lang === "zh" ? "你的档案里还没有论文。请在「档案」上传 CV 或论文列表。" : "Your profile has no publications yet. Add your CV or publication list on the Profile page.", lang === "zh" ? "【论文列表】" : "[Your publications]")]);
  return out;
}

function checklist(input: BuildInput): Piece {
  const lang = input.language;
  const items = input.checklist ?? [];
  const out: Piece = { blocks: [{ type: "heading", text: lang === "zh" ? "材料清单" : "Checklist", factIds: [], flags: [] }], roles: ["heading"], gaps: [], notes: [], label: "drafted_from_profile" };
  for (const it of items) {
    // A checklist states what the organiser asks for, not anything about the person.
    out.blocks.push({ type: "bullet", text: it, factIds: [], flags: [] });
    out.roles.push("context");
  }
  if (!items.length) {
    out.blocks.push({ type: "paragraph", text: lang === "zh" ? "主办方没有列出材料要求，请以官方页面为准。" : "The organiser lists no materials; check the official page.", factIds: [], flags: [] });
    out.roles.push("context");
  }
  return out;
}

export async function buildDocument(input: BuildInput): Promise<BuiltDocument> {
  const lang = input.language;
  const profile = readProfile(input.profile);
  const tone = input.tone ?? "professional";
  const base = {
    profile,
    facts: input.facts,
    opportunity: input.opportunity ?? null,
    answers: input.answers ?? {},
    language: lang,
    tone,
    maxWords: input.maxWords,
    now: input.now,
  } as const;
  let piece: Piece;
  let title = defaultTitle(input.kind, input.material, lang, input.opportunity);
  let composer: string = input.kind;
  switch (input.kind) {
    case "cover_letter": {
      const doc = await input.ai.compose({ ...base, kind: "cover_letter", contact: input.contact ?? null });
      piece = fromComposed(doc, { keepStructure: true });
      break;
    }
    case "one_pager":
    case "pitch_notes": {
      const doc = await input.ai.compose({ ...base, kind: "one_pager" });
      piece = fromComposed(doc, { keepStructure: true });
      composer = "one_pager";
      break;
    }
    case "bio": {
      const doc = await input.ai.compose({ ...base, kind: "bio", perspective: input.material === "short_bio" ? "first" : "third" });
      piece = fromComposed(doc, { keepStructure: true });
      break;
    }
    case "email": {
      const kind = input.previous ? "email_follow_up" : emailComposeKind(input.opportunity?.type, input.contact?.kind);
      const doc = await input.ai.compose({ ...base, kind, contact: input.contact ?? null, previous: input.previous ?? null });
      piece = fromComposed(doc, { keepStructure: true });
      composer = kind;
      const subject = doc.blocks.find((b) => b.role === "subject");
      if (subject) title = subject.text;
      break;
    }
    case "statement":
    case "proposal":
    case "press_release": {
      piece = await composeSections(input, sectionsFor(input.kind, input.material, ventureLikeProfile(profile)));
      composer = `sections:${input.material ?? input.kind}`;
      break;
    }
    case "resume_variant": {
      const r = buildResume({ profile, facts: input.facts, opportunity: input.opportunity ?? null, language: lang });
      piece = { blocks: r.blocks, roles: r.roles, gaps: r.gaps, notes: r.notes, label: "drafted_from_profile" };
      title = r.title;
      composer = "resume";
      break;
    }
    case "answers": {
      const rows = input.answerRows ?? [];
      piece = { blocks: [], roles: [], gaps: [], notes: [], label: "drafted_from_profile" };
      for (const r of rows) {
        const text = r.value.trim();
        if (!text) continue;
        piece.blocks.push({ type: "field", label: r.label, text, factIds: r.factIds.length ? r.factIds : [`answer:${r.key}`], flags: [] });
        piece.roles.push("body");
      }
      composer = "answers";
      break;
    }
    case "other": {
      if (input.material === "publication_list") piece = publicationList(input);
      else if (input.material === "document_checklist" || input.material === "evidence_list") piece = checklist(input);
      else throw new UnsupportedDocumentError(input.kind, input.material);
      composer = `other:${input.material}`;
      break;
    }
    default:
      throw new UnsupportedDocumentError(input.kind, input.material);
  }

  const meta = documentMetaSchema.parse({ label: piece.label, gaps: piece.gaps, notes: piece.notes, composer, tone, roles: piece.roles });
  const content: StoredContent = { format: "blocks", blocks: piece.blocks, meta };
  const sources = [...new Set(piece.blocks.flatMap((b) => b.factIds))];
  return { title, content, sources, gaps: piece.gaps, label: piece.label };
}

/** Gaps the composer marks as nice-to-have: never block a submission, dropped when unanswered. */
export const OPTIONAL_GAP_KEYS = new Set(["proud_why"]);

export function isOptionalGap(key: string): boolean {
  return OPTIONAL_GAP_KEYS.has(key);
}

/** The questions a document is still waiting for (gap blocks), keyed for the application's answers. */
export function documentGaps(content: StoredContent): DocumentGap[] {
  return content.meta.gaps;
}

/** Removes unanswered optional gap blocks (a submitted document never shows a placeholder). */
export function dropOptionalGaps(content: StoredContent): StoredContent {
  const optionalQuestions = new Set(content.meta.gaps.filter((g) => isOptionalGap(g.key)).map((g) => g.question));
  if (!optionalQuestions.size) return content;
  const keep = content.blocks.map((b) => !(b.flags.includes("needs_confirmation") && b.factIds.length === 0 && optionalQuestions.has(b.label ?? "")));
  return {
    format: "blocks",
    blocks: content.blocks.filter((_, i) => keep[i]),
    meta: { ...content.meta, roles: content.meta.roles.filter((_, i) => keep[i]), gaps: content.meta.gaps.filter((g) => !isOptionalGap(g.key)) },
  };
}
