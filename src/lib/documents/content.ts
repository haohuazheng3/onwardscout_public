import { z } from "zod";
import { generatedBlockSchema, type GeneratedBlock, type GeneratedContent, type GeneratedDocumentKind } from "@/lib/core/types";

/*
 * The stored shape of a generated document (pure, isomorphic: the room UI imports it too).
 *
 * `generated_documents.content` is F2's `GeneratedContent` ({ format: "blocks", blocks }) plus an
 * optional `meta` this module owns. Readers that only know `generatedContentSchema` simply drop
 * `meta`. Source ids inside `block.factIds`:
 *   - `fct_…`            a sourced fact (facts.source_doc_id + quote, or confirmed by the person);
 *   - `answer:<key>`     the person's own answer to a question (their words, verbatim);
 *   - `user:confirmed`   the person edited this block inline: it is now their own statement.
 * A block that states something about the person without any of these is never written; a spot
 * only the person can fill is a gap block (flag `needs_confirmation`, no ids).
 */

export const USER_CONFIRMED = "user:confirmed";

export const DOCUMENT_LABELS = ["drafted_from_profile", "written_with_ai", "edited_by_you"] as const;
export type DocumentLabel = (typeof DOCUMENT_LABELS)[number];

export const documentGapSchema = z.object({ key: z.string(), question: z.string() });
export type DocumentGap = z.infer<typeof documentGapSchema>;

export const documentMetaSchema = z.object({
  /** Honest provenance shown on the document: drafted from the profile (local), written with AI (Claude), or edited by the person. */
  label: z.enum(DOCUMENT_LABELS).default("drafted_from_profile"),
  /** What only the person can supply (motivation, a pitch, a signature name…). */
  gaps: z.array(documentGapSchema).default([]),
  notes: z.array(z.string()).default([]),
  /** Which composer produced it (cover_letter, answer:about_you, resume…), for regeneration. */
  composer: z.string().nullable().default(null),
  tone: z.string().nullable().default(null),
  /** Role per block index (body, greeting, gap…), when the composer reported one. */
  roles: z.array(z.string()).default([]),
});
export type DocumentMeta = z.infer<typeof documentMetaSchema>;

export const storedContentSchema = z.object({
  format: z.literal("blocks").default("blocks"),
  blocks: z.array(generatedBlockSchema).default([]),
  meta: documentMetaSchema.default(() => documentMetaSchema.parse({})),
});
export type StoredContent = z.infer<typeof storedContentSchema>;

/** Reads `generated_documents.content` leniently (older rows have no meta; invalid blocks are dropped). */
export function readContent(raw: unknown): StoredContent {
  const whole = storedContentSchema.safeParse(raw ?? {});
  if (whole.success) return whole.data;
  const src = (raw && typeof raw === "object" ? raw : {}) as { blocks?: unknown; meta?: unknown };
  const blocks = Array.isArray(src.blocks)
    ? src.blocks.map((b) => generatedBlockSchema.safeParse(b)).flatMap((r) => (r.success ? [r.data] : []))
    : [];
  const meta = documentMetaSchema.safeParse(src.meta ?? {});
  return { format: "blocks", blocks, meta: meta.success ? meta.data : documentMetaSchema.parse({}) };
}

/** The value to write into the jsonb column (typed as F2's GeneratedContent; `meta` rides along). */
export function toStored(content: StoredContent): GeneratedContent {
  const stored: GeneratedContent & { meta: DocumentMeta } = { format: "blocks", blocks: content.blocks, meta: content.meta };
  return stored;
}

/** A spot only the person can fill: flagged, and resting on nothing. */
export function isGapBlock(b: Pick<GeneratedBlock, "flags" | "factIds">): boolean {
  return b.flags.includes("needs_confirmation") && b.factIds.length === 0;
}

/** Edited inline by the person. */
export function isUserConfirmed(b: Pick<GeneratedBlock, "factIds">): boolean {
  return b.factIds.includes(USER_CONFIRMED);
}

/** Fact ids (only `fct_…`-style ids, not answers or confirmations) the content rests on. */
export function factIdsOf(content: Pick<StoredContent, "blocks">): string[] {
  const out = new Set<string>();
  for (const b of content.blocks) for (const id of b.factIds) if (!id.startsWith("answer:") && id !== USER_CONFIRMED) out.add(id);
  return [...out];
}

export function gapCount(content: Pick<StoredContent, "blocks">): number {
  return content.blocks.filter(isGapBlock).length;
}

export interface BlockEdit {
  index: number;
  text: string;
}

/**
 * Applies the person's inline edits: an edited block becomes their own statement (`user:confirmed`,
 * flags cleared) and keeps the fact ids it was drafted from, so the source view still shows where
 * the original wording came from. Empty text removes the block (a gap they chose to drop).
 */
export function applyBlockEdits(content: StoredContent, edits: BlockEdit[]): StoredContent {
  const byIndex = new Map(edits.map((e) => [e.index, e.text]));
  const blocks: GeneratedBlock[] = [];
  const roles: string[] = [];
  content.blocks.forEach((b, i) => {
    const next = byIndex.get(i);
    if (next === undefined) {
      blocks.push(b);
      roles.push(content.meta.roles[i] ?? "");
      return;
    }
    const text = next.replace(/\r\n/g, "\n").trim();
    if (!text) return;
    if (text === b.text.trim() && !isGapBlock(b)) {
      blocks.push(b);
      roles.push(content.meta.roles[i] ?? "");
      return;
    }
    const ids = b.factIds.filter((id) => id !== USER_CONFIRMED);
    blocks.push({ ...b, text, factIds: [...ids, USER_CONFIRMED], flags: [] });
    roles.push(content.meta.roles[i] === "gap" ? "body" : (content.meta.roles[i] ?? ""));
  });
  const anyEdit = blocks.some(isUserConfirmed);
  // Gap blocks carry their question in `label` (build.ts), so the open gaps follow the blocks.
  const gapsLeft = new Set(blocks.filter(isGapBlock).map((b) => b.label ?? ""));
  return {
    format: "blocks",
    blocks,
    meta: {
      ...content.meta,
      label: anyEdit ? "edited_by_you" : content.meta.label,
      gaps: content.meta.gaps.filter((g) => gapsLeft.has(g.question)),
      roles,
    },
  };
}

/** Plain text of a document (email bodies, copy buttons, DOCX fallbacks). Gap blocks are kept visible. */
export function plainText(content: Pick<StoredContent, "blocks">, opts: { skipLabels?: string[]; skipFieldBlocks?: boolean } = {}): string {
  const parts: string[] = [];
  for (const b of content.blocks) {
    if (opts.skipFieldBlocks && b.type === "field") continue;
    if (b.label && opts.skipLabels?.includes(b.label)) continue;
    if (b.type === "bullet") parts.push(`• ${b.text}`);
    else if (b.type === "field") parts.push(b.label ? `${b.label}: ${b.text}` : b.text);
    else parts.push(b.text);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** File-name friendly slug of a title (ASCII; CJK kept). */
export function fileSlug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "document";
}

const KIND_FILE_WORD: Record<GeneratedDocumentKind, { en: string; zh: string }> = {
  cover_letter: { en: "Cover letter", zh: "求职信" },
  resume_variant: { en: "Resume", zh: "简历" },
  one_pager: { en: "One-pager", zh: "一页纸" },
  email: { en: "Email", zh: "邮件" },
  answers: { en: "Application answers", zh: "申请表答案" },
  statement: { en: "Statement", zh: "陈述" },
  proposal: { en: "Proposal", zh: "提案" },
  bio: { en: "Bio", zh: "简介" },
  press_release: { en: "Press release", zh: "新闻稿" },
  pitch_notes: { en: "Pitch notes", zh: "路演讲稿" },
  other: { en: "Document", zh: "文档" },
};

export function kindWord(kind: GeneratedDocumentKind, language: string): string {
  const w = KIND_FILE_WORD[kind] ?? KIND_FILE_WORD.other;
  return language.startsWith("zh") ? w.zh : w.en;
}

/** "Cover-letter-Juniper-Clinics-Avery-Quinn.pdf"-style download name (no repeated words). */
export function downloadName(input: { kind: GeneratedDocumentKind; title: string; language: string; personName?: string | null; ext: string }): string {
  const word = kindWord(input.kind, input.language);
  const title = input.title.trim();
  const fold = (x: string) => x.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const base = !title ? word : fold(title).includes(fold(word)) ? title : `${word} ${title}`;
  const name = input.personName?.trim();
  const full = name && !base.includes(name) ? `${base} ${name}` : base;
  return `${fileSlug(full)}.${input.ext}`;
}
