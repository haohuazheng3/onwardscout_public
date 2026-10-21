import "server-only";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DocumentExtraction, DocumentKind } from "@/lib/core/types";
import { db } from "@/lib/db";
import { documents, facts, jobs, type DocumentRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { deleteObject, docKey, headObject, putObject, readObject, signedUploadUrl } from "@/lib/files";
import { newId, sha256 } from "@/lib/ids";
import { guessDocumentKind } from "@/lib/ingest/classify";
import { classifyLink, normalizeUserUrl } from "@/lib/ingest/url";
import { enqueueAndRun } from "@/lib/jobs/runner";
import { signTicket, verifyTicket } from "./tickets";
import { ensureProfile, setProfileStatus } from "./store";
import { extensionFor, isUploadContentType, safeFilename, UPLOAD_LIMITS, uploadContentType } from "./uploads";
import { rateLimit } from "@/lib/ratelimit";

/*
 * The document pipeline shared by the signed-in routes (/api/uploads/*) and the signed-out
 * draft routes (/api/drafts/*): sign → the browser PUTs straight to the files worker →
 * complete (row + 'profile.parse') → parse (text) → 'profile.extract' (profile + facts).
 * Every function takes the owner id (a user id or an `anon_…` draft id) the route resolved.
 */

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

const UPLOAD_TTL_SECONDS = 15 * 60;

function ticketSecret(): string {
  const s = env("FILES_SIGNING_SECRET") ?? env("CRON_SECRET");
  if (!s) throw new PipelineError("Uploads aren't available right now. Please try again shortly.", 503);
  return s;
}

/** Registers the profile job handlers in this process before anything is enqueued. */
async function ensureHandlers(): Promise<void> {
  await import("./jobs");
}

/* ------------------------------------------------------------------ queueing */

/** Parses one document now (inline kick; the cron picks it up if this instance stops). */
export async function queueParse(ownerId: string, documentId: string, opts: { again?: boolean; locale?: "en" | "zh" } = {}): Promise<void> {
  await ensureHandlers();
  await enqueueAndRun("profile.parse", { documentId, ...(opts.locale ? { locale: opts.locale } : {}) }, { userId: ownerId, dedupeKey: `profile.parse:${documentId}`, onDuplicate: opts.again ? "rearm" : "skip", maxMs: 120_000 });
}

/** A stamp of the sources an extraction would read, so the same set is never extracted twice. */
function sourcesStamp(rows: readonly Pick<DocumentRow, "id" | "status" | "extraction">[]): string {
  const parts = rows
    .filter((d) => d.status === "parsed" || d.status === "failed")
    .map((d) => `${d.id}:${d.status}:${d.extraction?.meta?.parsedAt ?? ""}`)
    .sort();
  return sha256(parts.join("|") || "empty").slice(0, 24);
}

/**
 * Builds (or rebuilds) the profile from every source the owner has. Deduplicated by the set
 * of sources, so repeated calls with nothing new are free.
 */
/** Full extractions per anonymous draft per day that may use the model (the rest run locally). */
export const ANON_MODEL_EXTRACTIONS_PER_DAY = 5;

export async function queueExtraction(ownerId: string, opts: { locale?: "en" | "zh"; force?: boolean } = {}): Promise<{ queued: boolean }> {
  // One waiting extraction is enough: it reads every document when it runs, so a burst of
  // uploads, notes or deletions collapses into it instead of queueing one full extraction each.
  const waiting = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "profile.extract"), eq(jobs.userId, ownerId), eq(jobs.status, "queued")))
    .limit(1);
  if (waiting[0]) return { queued: true };
  const rows = await db.select({ id: documents.id, status: documents.status, extraction: documents.extraction }).from(documents).where(eq(documents.userId, ownerId));
  const stamp = opts.force ? `${sourcesStamp(rows)}:${Date.now()}` : sourcesStamp(rows);
  await ensureHandlers();
  // Anonymous drafts: a few model-backed extractions a day (forced re-reads count too); later
  // ones in the same day use the local engine, so the draft still updates at no model cost.
  const local = ownerId.startsWith("anon_") && !(await rateLimit(`extract:anon:${ownerId}`, ANON_MODEL_EXTRACTIONS_PER_DAY, 24 * 3600)).ok;
  const res = await enqueueAndRun(
    "profile.extract",
    { userId: ownerId, locale: opts.locale ?? "en", ...(local ? { local: true } : {}) },
    { userId: ownerId, dedupeKey: `profile.extract:${ownerId}:${stamp}`, maxMs: 180_000 },
  );
  if (res.created) await setProfileStatus(ownerId, "parsing");
  return { queued: res.created };
}

/** True while a parse or extraction for the owner is waiting or running. */
export async function hasPendingWork(ownerId: string): Promise<{ parse: boolean; extract: boolean }> {
  const rows = await db
    .select({ kind: jobs.kind })
    .from(jobs)
    .where(and(eq(jobs.userId, ownerId), inArray(jobs.kind, ["profile.parse", "profile.extract"]), inArray(jobs.status, ["queued", "running"])))
    .limit(10);
  return { parse: rows.some((r) => r.kind === "profile.parse"), extract: rows.some((r) => r.kind === "profile.extract") };
}

/* ------------------------------------------------------------------ uploads */

export interface SignedUpload {
  documentId: string;
  uploadUrl: string;
  contentType: string;
  ticket: string;
  filename: string;
}

async function fileCount(ownerId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.userId, ownerId), ne(documents.kind, "link"), sql`${documents.objectKey} is not null`));
  return Number(rows[0]?.n ?? 0);
}

/** Step 1: a signed PUT link straight to the files worker, plus a ticket for step 2. */
export async function signUpload(ownerId: string, input: { filename: string; contentType?: string | null; bytes: number }, opts: { maxFiles: number }): Promise<SignedUpload> {
  const filename = safeFilename(input.filename);
  const contentType = uploadContentType(filename, input.contentType);
  if (!contentType) throw new PipelineError("That file type isn't supported. Use PDF, Word (.docx), PowerPoint (.pptx), text, Markdown, JPG, PNG or WebP.");
  if (input.bytes <= 0) throw new PipelineError("That file is empty.");
  if (input.bytes > UPLOAD_LIMITS.maxBytes) throw new PipelineError("Each file can be up to 20 MB.");
  if ((await fileCount(ownerId)) >= opts.maxFiles) throw new PipelineError(`You can add up to ${opts.maxFiles} files here. Remove one to add another.`, 409);
  // Signed links count on their own (an upload that is never completed has no row to count):
  // at most a few times the file quota per owner per day, so storage can't be filled by
  // signing and never completing.
  const signed = await rateLimit(`uploads:sign:owner:${ownerId}`, Math.max(10, opts.maxFiles * 3), 24 * 3600);
  if (!signed.ok) throw new PipelineError("You've started a lot of uploads today. Please try again tomorrow, or remove a file first.", 429);
  const documentId = newId("doc");
  const ext = extensionFor(contentType);
  const key = docKey(ownerId, documentId, ext);
  const uploadUrl = signedUploadUrl(key, { contentType, maxBytes: UPLOAD_LIMITS.maxBytes, ttlSeconds: UPLOAD_TTL_SECONDS });
  const ticket = signTicket({ o: ownerId, d: documentId, e: ext, c: contentType, n: filename, x: Math.floor(Date.now() / 1000) + 3600 }, ticketSecret());
  return { documentId, uploadUrl, contentType, ticket, filename };
}

function kindFromName(filename: string, contentType: string): DocumentKind {
  const guess = guessDocumentKind({ filename, contentType });
  return guess.confidence >= 0.5 ? guess.kind : "other";
}

/** Step 2: the object arrived → the documents row, then parsing starts. Idempotent. */
export async function completeUpload(ownerId: string, ticketToken: string, opts: { maxFiles: number; locale?: "en" | "zh" }): Promise<DocumentRow> {
  const t = verifyTicket(ticketToken, ticketSecret());
  if (!t || t.o !== ownerId || !isUploadContentType(t.c)) throw new PipelineError("That upload link has expired. Please drop the file again.", 410);
  const key = docKey(ownerId, t.d, t.e);
  const existing = await db.select().from(documents).where(and(eq(documents.objectKey, key), eq(documents.userId, ownerId))).limit(1);
  if (existing[0]) return existing[0];
  const head = await headObject(key);
  if (!head) throw new PipelineError("The file hasn't finished uploading. Please try again.", 409);
  if (head.bytes <= 0 || head.bytes > UPLOAD_LIMITS.maxBytes) {
    await deleteObject(key).catch((err) => captureError(err, { route: "profile/completeUpload", severity: "warn", context: { key } }));
    throw new PipelineError("Each file can be up to 20 MB.");
  }
  if ((await fileCount(ownerId)) >= opts.maxFiles) {
    await deleteObject(key).catch((err) => captureError(err, { route: "profile/completeUpload", severity: "warn", context: { key } }));
    throw new PipelineError(`You can add up to ${opts.maxFiles} files here. Remove one to add another.`, 409);
  }
  const inserted = await db
    .insert(documents)
    .values({ id: t.d, userId: ownerId, kind: kindFromName(t.n, t.c), objectKey: key, filename: t.n, contentType: t.c, bytes: head.bytes, status: "uploaded" })
    .onConflictDoNothing({ target: documents.objectKey })
    .returning();
  const row = inserted[0] ?? (await db.select().from(documents).where(eq(documents.objectKey, key)).limit(1))[0];
  if (!row || row.userId !== ownerId) throw new PipelineError("That upload could not be saved. Please try again.", 409);
  await ensureProfile(ownerId);
  await queueParse(ownerId, row.id, { locale: opts.locale });
  return row;
}

/* ------------------------------------------------------------------ links and notes */

function linkTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

export interface AddedLink {
  document: DocumentRow;
  /** "linkedin" | "scholar": saved, but can't be read automatically (the UI explains why). */
  hint: "linkedin" | "scholar" | null;
}

/** Saves a pasted link and starts reading it. Duplicates return the existing row. */
export async function addLink(ownerId: string, raw: string, opts: { locale?: "en" | "zh"; maxLinks?: number } = {}): Promise<AddedLink> {
  const url = normalizeUserUrl(raw);
  if (!url) throw new PipelineError("That doesn't look like a web address.");
  const kind = classifyLink(url);
  const hint = kind === "linkedin" || kind === "scholar" ? kind : null;
  const all = await db.select().from(documents).where(and(eq(documents.userId, ownerId), eq(documents.kind, "link")));
  const same = all.find((d) => (d.sourceUrl ?? "").replace(/\/+$/, "").toLowerCase() === url.replace(/\/+$/, "").toLowerCase());
  if (same) return { document: same, hint };
  const max = opts.maxLinks ?? UPLOAD_LIMITS.maxLinks * 3;
  if (all.length >= max) throw new PipelineError(`You can add up to ${max} links here. Remove one to add another.`, 409);
  const inserted = await db
    .insert(documents)
    .values({ id: newId("doc"), userId: ownerId, kind: "link", sourceUrl: url, filename: linkTitle(url), status: "uploaded" })
    .returning();
  const row = inserted[0]!;
  await ensureProfile(ownerId);
  await queueParse(ownerId, row.id, { locale: opts.locale });
  return { document: row, hint };
}

/** "Anything else?" — one line in the person's own words, kept as a source like a document. */
export async function addNote(ownerId: string, text: string, locale: "en" | "zh"): Promise<DocumentRow> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, UPLOAD_LIMITS.maxNoteChars);
  if (!clean) throw new PipelineError("Write a few words first.");
  const extraction: DocumentExtraction = { method: "manual", language: locale, pages: null, title: null, counts: {}, links: [], meta: { parsedAt: new Date().toISOString() }, warnings: [], truncated: false };
  const inserted = await db
    .insert(documents)
    .values({ id: newId("doc"), userId: ownerId, kind: "other", filename: locale === "zh" ? "你的补充说明" : "Your note", extractedText: clean, extraction, status: "parsed" })
    .returning();
  await ensureProfile(ownerId);
  await queueExtraction(ownerId, { locale });
  return inserted[0]!;
}

/* ------------------------------------------------------------------ manage */

export async function ownedDocument(ownerId: string, documentId: string): Promise<DocumentRow | null> {
  const rows = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, ownerId))).limit(1);
  return rows[0] ?? null;
}

/** Removes a source, the facts read from it, and its file; the profile is rebuilt without it. */
export async function deleteDocument(ownerId: string, documentId: string, locale: "en" | "zh" = "en"): Promise<boolean> {
  const doc = await ownedDocument(ownerId, documentId);
  if (!doc) return false;
  await db.batch([
    db.delete(facts).where(and(eq(facts.userId, ownerId), eq(facts.sourceDocId, documentId), eq(facts.confirmedByUser, false))),
    db.update(facts).set({ sourceDocId: null, quote: null, updatedAt: sql`now()` }).where(and(eq(facts.userId, ownerId), eq(facts.sourceDocId, documentId))),
    db.delete(documents).where(and(eq(documents.id, documentId), eq(documents.userId, ownerId))),
  ]);
  if (doc.objectKey) {
    try {
      await deleteObject(doc.objectKey);
    } catch (err) {
      await captureError(err, { route: "profile/deleteDocument", severity: "warn", context: { documentId } });
    }
  }
  await queueExtraction(ownerId, { locale });
  return true;
}

/** Reads a source again from scratch (after a failure or a new version of a page). */
export async function reparseDocument(ownerId: string, documentId: string, locale?: "en" | "zh"): Promise<DocumentRow | null> {
  const rows = await db
    .update(documents)
    .set({ status: "uploaded", error: null })
    .where(and(eq(documents.id, documentId), eq(documents.userId, ownerId), inArray(documents.status, ["parsed", "failed"])))
    .returning();
  const row = rows[0] ?? (await ownedDocument(ownerId, documentId));
  if (!row) return null;
  if (row.objectKey || row.sourceUrl) await queueParse(ownerId, row.id, { again: true, locale });
  else await queueExtraction(ownerId, { force: true, locale });
  return row;
}

export async function listDocuments(ownerId: string, limit = 60) {
  return db
    .select({
      id: documents.id,
      kind: documents.kind,
      filename: documents.filename,
      contentType: documents.contentType,
      bytes: documents.bytes,
      sourceUrl: documents.sourceUrl,
      status: documents.status,
      error: documents.error,
      extraction: documents.extraction,
      hasFile: sql<boolean>`${documents.objectKey} is not null`,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.userId, ownerId))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
}

export type DocumentListItem = Awaited<ReturnType<typeof listDocuments>>[number];

/* ------------------------------------------------------------------ claim support */

/**
 * After an anonymous draft was claimed, its files still sit under `docs/anon_…/`. Copy each
 * to the person's own prefix (so export and account deletion find them), then remove the old
 * object. Best effort, idempotent; runs after the response.
 */
export async function relocateClaimedFiles(userId: string): Promise<number> {
  const rows = await db
    .select({ id: documents.id, objectKey: documents.objectKey, contentType: documents.contentType })
    .from(documents)
    .where(and(eq(documents.userId, userId), sql`${documents.objectKey} like 'docs/anon\\_%'`));
  let moved = 0;
  for (const r of rows) {
    if (!r.objectKey) continue;
    try {
      const ext = r.objectKey.split(".").pop() ?? "bin";
      const next = docKey(userId, r.id, ext);
      const bytes = await readObject(r.objectKey);
      if (!bytes) continue;
      await putObject(next, bytes, r.contentType ?? "application/octet-stream");
      const updated = await db.update(documents).set({ objectKey: next }).where(and(eq(documents.id, r.id), eq(documents.objectKey, r.objectKey))).returning({ id: documents.id });
      if (updated[0]) {
        await deleteObject(r.objectKey);
        moved++;
      }
    } catch (err) {
      await captureError(err, { route: "profile/relocateClaimedFiles", severity: "warn", context: { documentId: r.id } });
    }
  }
  return moved;
}
