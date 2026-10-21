import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, generatedDocuments } from "@/lib/db/schema";
import { readObject } from "@/lib/files";
import type { LoadedFile, PreparedFile } from "./types";

/*
 * Bytes of a prepared file, owner-checked: a generated document (rendered by P3a's documents
 * module, PDF unless the filename says .docx) or a document the person uploaded (R2).
 */

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function extensionOf(filename: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(filename.trim())?.[1]?.toLowerCase() ?? "";
}

export function contentTypeFor(filename: string, fallback = "application/octet-stream"): string {
  return MIME[extensionOf(filename)] ?? fallback;
}

export async function loadPreparedFile(userId: string, file: PreparedFile): Promise<LoadedFile | null> {
  if (file.generatedDocumentId) {
    const own = await db
      .select({ id: generatedDocuments.id })
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.id, file.generatedDocumentId), eq(generatedDocuments.userId, userId)))
      .limit(1);
    if (!own[0]) return null;
    const format = extensionOf(file.filename) === "docx" ? "docx" : "pdf";
    const { documentBytes } = await import("@/lib/documents");
    const bytes = await documentBytes(file.generatedDocumentId, format);
    const filename = extensionOf(file.filename) === format ? file.filename : `${file.filename.replace(/\.[a-z0-9]{1,8}$/i, "")}.${format}`;
    return { field: file.field, filename, contentType: MIME[format], bytes };
  }
  if (file.documentId) {
    const rows = await db
      .select({ key: documents.objectKey, contentType: documents.contentType, filename: documents.filename })
      .from(documents)
      .where(and(eq(documents.id, file.documentId), eq(documents.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row?.key) return null;
    const bytes = await readObject(row.key);
    if (!bytes) return null;
    const filename = file.filename || row.filename || "document";
    return { field: file.field, filename, contentType: row.contentType || contentTypeFor(filename), bytes };
  }
  return null;
}

/** Loads every prepared file; returns the loaded ones and the names that could not be loaded. */
export async function loadPreparedFiles(
  userId: string,
  files: PreparedFile[],
  loader: (userId: string, file: PreparedFile) => Promise<LoadedFile | null> = loadPreparedFile,
): Promise<{ loaded: LoadedFile[]; missing: string[] }> {
  const loaded: LoadedFile[] = [];
  const missing: string[] = [];
  for (const f of files) {
    const got = await loader(userId, f);
    if (got) loaded.push(got);
    else missing.push(f.filename);
  }
  return { loaded, missing };
}
