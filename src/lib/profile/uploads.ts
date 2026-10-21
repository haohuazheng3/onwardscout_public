/*
 * Upload rules for "Drop what you have" — pure and shared by the browser (instant feedback
 * before any request) and the upload routes (the server re-checks everything).
 *
 *   PDF, DOCX, PPTX, TXT/MD, JPG/PNG/WebP · ≤ 20 MB each · up to 10 files per draft.
 *
 * Browsers often report an empty or generic type for .md/.txt files, so the content type is
 * decided from the extension when the browser's answer is not one we accept. The signed PUT
 * link is bound to that exact content type.
 */

export const UPLOAD_LIMITS = {
  maxFiles: 10,
  maxBytes: 20 * 1024 * 1024,
  maxLinks: 10,
  /** Signed-in people may keep more sources over time than one onboarding draft. */
  maxFilesSignedIn: 60,
  maxNoteChars: 600,
} as const;

export const UPLOAD_CONTENT_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type UploadContentType = keyof typeof UPLOAD_CONTENT_TYPES;

const BY_EXTENSION: Record<string, UploadContentType> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  text: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The `accept` attribute for the file picker. */
export const UPLOAD_ACCEPT = [
  ...Object.keys(BY_EXTENSION).map((e) => `.${e}`),
  ...Object.keys(UPLOAD_CONTENT_TYPES),
].join(",");

export type UploadRejection = "type" | "size" | "empty" | "count";

export function isUploadContentType(value: unknown): value is UploadContentType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UPLOAD_CONTENT_TYPES, value);
}

/** Lower-case extension of a file name ("CV.final.PDF" → "pdf"), "" when there is none. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * The content type we upload a file with: the browser's type when it is one we accept and
 * agrees with the extension's family, else the type implied by the extension, else null.
 */
export function uploadContentType(filename: string, browserType?: string | null): UploadContentType | null {
  const byExt = BY_EXTENSION[fileExtension(filename)] ?? null;
  const declared = (browserType ?? "").split(";")[0]!.trim().toLowerCase();
  if (declared === "text/x-markdown") return "text/markdown";
  if (isUploadContentType(declared)) {
    // A ".pdf" the browser calls "image/png" is suspicious: trust neither, the bytes decide later.
    if (byExt && byExt !== declared && byExt.split("/")[0] !== declared.split("/")[0]) return byExt;
    return declared;
  }
  return byExt;
}

/** The object-key extension for an accepted content type. */
export function extensionFor(contentType: UploadContentType): string {
  return UPLOAD_CONTENT_TYPES[contentType];
}

/** Checks that need only what the browser knows before uploading. */
export function checkUpload(file: { name: string; type?: string | null; size: number }, alreadyQueued = 0, maxFiles: number = UPLOAD_LIMITS.maxFiles): UploadRejection | null {
  if (alreadyQueued >= maxFiles) return "count";
  if (!uploadContentType(file.name, file.type)) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > UPLOAD_LIMITS.maxBytes) return "size";
  return null;
}

/** A display-safe file name: no path, no control characters, at most 120 characters. */
export function safeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!base) return "document";
  if (base.length <= 120) return base;
  const ext = fileExtension(base);
  const keep = 120 - (ext ? ext.length + 1 : 0);
  return ext ? `${base.slice(0, keep).trimEnd()}.${ext}` : base.slice(0, 120);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Splits pasted text into candidate links (whitespace, commas, semicolons, Chinese
 * punctuation), trimmed and de-duplicated, at most `max`.
 */
export function splitLinks(text: string, max: number = UPLOAD_LIMITS.maxLinks): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;，；、]+/)) {
    const s = raw.trim().replace(/^[<("'“‘]+|[>)"'”’.,;:。]+$/g, "");
    if (!s || !/[a-z0-9]\.[a-z]{2,}|^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(s)) continue;
    const key = s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    if (out.some((o) => o.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "") === key)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** LinkedIn cannot be read automatically: the UI explains the "Save to PDF" export instead. */
export function isLinkedInUrl(url: string): boolean {
  return /(^|\/\/|\.)(linkedin\.com|lnkd\.in)(\/|$)/i.test(url.trim());
}
