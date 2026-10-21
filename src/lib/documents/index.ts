import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, generatedDocuments, profiles, type GeneratedDocumentRow } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { generatedKey, putObject, signedReadUrl } from "@/lib/files";
import { applyBlockEdits, downloadName, readContent, toStored, type BlockEdit, type StoredContent } from "./content";
import { composeDocumentWith } from "./compose";
import { loadCjkFonts } from "./fonts";
import { CjkFontUnavailableError, needsExtendedFont } from "./glyphs";

/*
 * Documents (contracts §5): compose blocks from facts, render PDF / DOCX / PPTX, store in R2
 * under generatedKey(userId, genId, ext), hand out signed links.
 */

export { composeDocument, composeDocumentWith, latestDocuments, loadComposeContext, factRefs, opportunityInput, answerStrings, resolveLanguage } from "./compose";
export type { ComposeContext, ComposeDocumentInput, ComposeOptions, ComposedRow } from "./compose";
export { CjkFontUnavailableError } from "./glyphs";
export * from "./content";

export type RenderFormat = "pdf" | "docx" | "pptx";

const MIME: Record<RenderFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function getGeneratedDocument(id: string, userId?: string): Promise<GeneratedDocumentRow | null> {
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(userId ? and(eq(generatedDocuments.id, id), eq(generatedDocuments.userId, userId)) : eq(generatedDocuments.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function personName(userId: string): Promise<string | null> {
  const rows = await db.select({ identity: profiles.identity }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0]?.identity?.name ?? null;
}

interface Rendered {
  bytes: Uint8Array;
  format: RenderFormat;
  contentType: string;
  /** True when PDF was asked for but the CJK font was unavailable, so DOCX was produced. */
  fallback: boolean;
}

async function renderRow(row: GeneratedDocumentRow, content: StoredContent, format: RenderFormat, name: string | null, opts: { allowFallback: boolean }): Promise<Rendered> {
  const base = { kind: row.kind, title: row.title, language: row.language, blocks: content.blocks, roles: content.meta.roles, personName: name };
  // Renderers load on demand: preparing and listing documents never pays for react-pdf / docx / pptxgenjs.
  const renderDocx = async (input: typeof base) => (await import("./render-docx")).renderDocx(input);
  const renderPptx = async (input: typeof base) => (await import("./render-pptx")).renderPptx(input);
  const renderPdf = async (input: typeof base, o: { cjk: Awaited<ReturnType<typeof loadCjkFonts>> }) => (await import("./render-pdf")).renderPdf(input, o);
  if (format === "pptx") return { bytes: await renderPptx(base), format, contentType: MIME.pptx, fallback: false };
  if (format === "docx") return { bytes: await renderDocx(base), format, contentType: MIME.docx, fallback: false };
  const texts = [row.title, ...content.blocks.flatMap((b) => [b.text, b.label ?? ""])];
  const cjk = needsExtendedFont(texts) ? await loadCjkFonts() : null;
  try {
    return { bytes: await renderPdf(base, { cjk }), format: "pdf", contentType: MIME.pdf, fallback: false };
  } catch (err) {
    if (!(err instanceof CjkFontUnavailableError) || !opts.allowFallback) throw err;
    await captureError(err, { route: "documents/render", severity: "warn", context: { generatedDocumentId: row.id, fallback: "docx" } });
    return { bytes: await renderDocx(base), format: "docx", contentType: MIME.docx, fallback: true };
  }
}

/**
 * contracts §5 — renders and uploads to R2, stores `object_key` (+ mime) on the row.
 * A Chinese PDF whose font cannot be loaded comes back as DOCX (`fallback: true`).
 */
export async function renderDocument(generatedDocumentId: string, format: RenderFormat): Promise<{ objectKey: string; filename: string; contentType: string; fallback?: boolean }> {
  const row = await getGeneratedDocument(generatedDocumentId);
  if (!row) throw new Error(`renderDocument: no generated document ${generatedDocumentId}`);
  const content = readContent(row.content);
  const name = await personName(row.userId);
  const r = await renderRow(row, content, format, name, { allowFallback: true });
  const ext = r.format;
  const objectKey = generatedKey(row.userId, row.id, ext);
  await putObject(objectKey, r.bytes, r.contentType);
  await db.update(generatedDocuments).set({ objectKey, mime: r.contentType }).where(eq(generatedDocuments.id, row.id));
  return { objectKey, filename: downloadName({ kind: row.kind, title: row.title, language: row.language, personName: name, ext }), contentType: r.contentType, ...(r.fallback ? { fallback: true } : {}) };
}

/**
 * contracts §5 — the bytes in exactly the asked format (no upload). Throws
 * `CjkFontUnavailableError` for a Chinese PDF when the font is unavailable; use `documentFile`
 * to accept the DOCX fallback instead.
 */
export async function documentBytes(generatedDocumentId: string, format: RenderFormat): Promise<Uint8Array> {
  const row = await getGeneratedDocument(generatedDocumentId);
  if (!row) throw new Error(`documentBytes: no generated document ${generatedDocumentId}`);
  const r = await renderRow(row, readContent(row.content), format, await personName(row.userId), { allowFallback: false });
  return r.bytes;
}

/** Bytes plus a filename and content type, accepting the DOCX fallback (attachments, uploads). */
export async function documentFile(generatedDocumentId: string, preferred: RenderFormat = "pdf"): Promise<{ bytes: Uint8Array; filename: string; contentType: string; fallback: boolean }> {
  const row = await getGeneratedDocument(generatedDocumentId);
  if (!row) throw new Error(`documentFile: no generated document ${generatedDocumentId}`);
  const name = await personName(row.userId);
  const r = await renderRow(row, readContent(row.content), preferred, name, { allowFallback: true });
  return { bytes: r.bytes, filename: downloadName({ kind: row.kind, title: row.title, language: row.language, personName: name, ext: r.format }), contentType: r.contentType, fallback: r.fallback };
}

/** Renders, uploads and signs a short-lived download link for the owner. */
export async function signedDocumentUrl(userId: string, generatedDocumentId: string, format: RenderFormat, disposition: "inline" | "attachment" = "attachment"): Promise<{ url: string; filename: string; contentType: string; fallback: boolean } | null> {
  const row = await getGeneratedDocument(generatedDocumentId, userId);
  if (!row) return null;
  const r = await renderDocument(row.id, format);
  return { url: signedReadUrl(r.objectKey, { disposition, filename: r.filename, ttlSeconds: 600 }), filename: r.filename, contentType: r.contentType, fallback: Boolean(r.fallback) };
}

/** Saves the person's inline edits (their words become user-confirmed blocks). */
export async function saveDocumentEdits(userId: string, generatedDocumentId: string, edits: BlockEdit[], title?: string): Promise<GeneratedDocumentRow | null> {
  const row = await getGeneratedDocument(generatedDocumentId, userId);
  if (!row) return null;
  const next = applyBlockEdits(readContent(row.content), edits);
  const sources = [...new Set(next.blocks.flatMap((b) => b.factIds))];
  const updated = await db
    .update(generatedDocuments)
    .set({ content: toStored(next), sources, title: title?.trim() ? title.trim().slice(0, 300) : row.title, objectKey: null, mime: null })
    .where(and(eq(generatedDocuments.id, row.id), eq(generatedDocuments.userId, userId)))
    .returning();
  return updated[0] ?? null;
}

/** A fresh version of the same document (same kind, material, tone unless given). */
export async function regenerateDocument(userId: string, generatedDocumentId: string, opts: { tone?: string; answers?: Record<string, string> } = {}): Promise<GeneratedDocumentRow | null> {
  const row = await getGeneratedDocument(generatedDocumentId, userId);
  if (!row) return null;
  const content = readContent(row.content);
  const composer = content.meta.composer ?? "";
  const material = composer.startsWith("sections:") || composer.startsWith("other:") ? composer.split(":")[1] : null;
  let opportunityId: string | undefined;
  if (row.applicationId) {
    const app = await db.select({ opportunityId: applications.opportunityId }).from(applications).where(and(eq(applications.id, row.applicationId), eq(applications.userId, userId))).limit(1);
    opportunityId = app[0]?.opportunityId;
  }
  const previousTone = content.meta.tone ?? "professional";
  const tone = opts.tone ?? nextTone(previousTone);
  const { row: fresh } = await composeDocumentWith(
    { userId, applicationId: row.applicationId ?? undefined, kind: row.kind, opportunityId, language: row.language, tone },
    { material, answers: opts.answers },
  );
  return fresh;
}

/** "Rewrite" cycles through tones so the new draft actually reads differently. */
export function nextTone(tone: string): string {
  const order = ["professional", "warm", "concise", "enthusiastic"];
  const i = order.indexOf(tone);
  return order[(i + 1) % order.length];
}
