import { guessDocumentKind, type DocumentKind } from "./classify";

/*
 * File → text. One entry point, `extractFile`, used by the upload pipeline (P1's
 * `profile.parse` job) and by `ingestUrl` for links that point at a document.
 *
 *   PDF   pdf-parse 2 (class API, pdf.js under the hood), first MAX_PDF_PAGES pages.
 *         Scanned PDFs (no text layer) come back with `needsVision: true` so the
 *         anthropic provider can read them as a document block.
 *   DOCX  mammoth raw text.
 *   PPTX  jszip: slide XML text in slide order, plus speaker notes linked through the
 *         slide relationships.
 *   TXT / MD / CSV / JSON / HTML   decoded as UTF-8 (UTF-16 with BOM), HTML stripped.
 *   Images  no OCR locally: `{ text: "", needsVision: true }`.
 *
 * Office files are ZIP containers: the central directory is read first (no inflation)
 * to identify the format and to refuse zip bombs before any library inflates them.
 * Heavy libraries are imported lazily so routes that never parse files don't load them.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;
export const MAX_SLIDES = 200;
export const MAX_TEXT_CHARS = 200_000;
/** Refuse office containers that would inflate beyond this (zip bomb guard). */
export const MAX_UNZIPPED_BYTES = 120 * 1024 * 1024;
/** Below this many characters per page a PDF is treated as scanned (image-only). */
const SCANNED_CHARS_PER_PAGE = 40;

export type FileFormat = "pdf" | "docx" | "pptx" | "xlsx" | "text" | "html" | "image" | "unknown";

export interface ExtractInput {
  bytes: Uint8Array;
  filename: string;
  contentType?: string | null;
}

export interface ExtractedFile {
  format: FileFormat;
  /** Plain text, normalised newlines, at most MAX_TEXT_CHARS. Empty for images/scans. */
  text: string;
  /** Pages (PDF) or slides (PPTX) in the file, when known. */
  pages?: number;
  /** Guessed document kind and how sure we are (0..1). */
  kind: DocumentKind;
  kindConfidence: number;
  /** True when the content can only be read visually (image, scanned PDF). */
  needsVision: boolean;
  /** Media type to use when sending the original bytes to a vision-capable model. */
  mediaType: string | null;
  /** True when the text was cut at MAX_TEXT_CHARS or only the first pages were read. */
  truncated: boolean;
  /** Human-readable notes for the user/admin (never thrown). */
  warnings: string[];
}

export class ExtractError extends Error {
  readonly code: "too_large" | "unsupported" | "corrupt" | "encrypted" | "zip_bomb";
  constructor(code: ExtractError["code"], message: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ format sniffing */

const IMAGE_SIGNATURES: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    type: "image/webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    type: "image/heic",
    test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && /^(heic|heix|mif1|msf1|hevc)$/.test(String.fromCharCode(b[8], b[9], b[10], b[11])),
  },
];

function isPdf(b: Uint8Array): boolean {
  // "%PDF" may be preceded by a little junk; the spec allows it within the first 1024 bytes.
  const head = Buffer.from(b.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
}

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Reads a ZIP central directory without inflating anything. Returns null when the
 * container is not a readable ZIP. ZIP64 sizes (0xFFFFFFFF markers) are reported as
 * Infinity so the caller refuses them: no résumé needs a 4 GB entry.
 */
export function readZipDirectory(bytes: Uint8Array): ZipEntryInfo[] | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  const minEocd = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) return null;
  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({
      name,
      compressedSize: compressed === 0xffffffff ? Infinity : compressed,
      uncompressedSize: uncompressed === 0xffffffff ? Infinity : uncompressed,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export interface Sniffed {
  format: FileFormat;
  mediaType: string | null;
  zip?: ZipEntryInfo[];
}

export function sniffFormat(bytes: Uint8Array, filename: string, contentType?: string | null): Sniffed {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? "").toLowerCase();
  const ct = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (bytes.length >= 4 && isPdf(bytes)) return { format: "pdf", mediaType: "application/pdf" };
  for (const sig of IMAGE_SIGNATURES) {
    if (bytes.length >= 12 && sig.test(bytes)) return { format: "image", mediaType: sig.type };
  }
  if (bytes.length >= 4 && isZip(bytes)) {
    const zip = readZipDirectory(bytes);
    if (!zip) return { format: "unknown", mediaType: null };
    const names = new Set(zip.map((e) => e.name));
    if (names.has("word/document.xml")) return { format: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip };
    if (names.has("ppt/presentation.xml")) return { format: "pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip };
    if (names.has("xl/workbook.xml")) return { format: "xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip };
    return { format: "unknown", mediaType: null, zip };
  }
  if (ct === "text/html" || ext === "html" || ext === "htm") return { format: "html", mediaType: "text/html" };
  if (ct.startsWith("text/") || ["txt", "md", "markdown", "csv", "tsv", "json", "rtf", "tex", "bib", "yaml", "yml"].includes(ext) || ct === "application/json") {
    return { format: "text", mediaType: ct || "text/plain" };
  }
  // Unknown extension: accept it as text when it decodes cleanly.
  if (looksLikeText(bytes)) return { format: "text", mediaType: "text/plain" };
  return { format: "unknown", mediaType: null };
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length < 0.02;
}

/* ------------------------------------------------------------------ text helpers */

/** Decodes bytes as text honouring UTF-8/UTF-16 BOMs; invalid UTF-8 falls back to latin1. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // GB18030 is the common non-UTF-8 encoding for Chinese files; TextDecoder supports it in Node.
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch {
      return Buffer.from(bytes).toString("latin1");
    }
  }
}

/** Normalises whitespace without destroying line structure (parsers rely on lines). */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ | | |　/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/­/g, "")
    // Keep column gaps (2+ spaces, tabs) as a double space: parsers use them as separators.
    .replace(/[\f\v]+/g, " ")
    .replace(/\t+/g, "  ")
    .replace(/ {3,}/g, "  ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", MAX_TEXT_CHARS);
  return { text: text.slice(0, cut > MAX_TEXT_CHARS * 0.8 ? cut : MAX_TEXT_CHARS), truncated: true };
}

/** Very small RTF → text conversion: drops control words and groups, keeps paragraphs. */
export function rtfToText(rtf: string): string {
  if (!rtf.startsWith("{\\rtf")) return rtf;
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_m, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}?/g, "")
    .replace(/\\(par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

/* ------------------------------------------------------------------ XML text (PPTX) */

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Text of a DrawingML part (slide or notes): one line per paragraph (`<a:p>`), runs
 * (`<a:t>`) concatenated, `<a:br/>` as a line break, `<a:tab/>` as a space.
 */
export function drawingMlText(xml: string): string[] {
  const lines: string[] = [];
  const paragraphs = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  for (const p of paragraphs) {
    const parts: string[] = [];
    const tokens = p.match(/<a:t>[\s\S]*?<\/a:t>|<a:t\/>|<a:br\b[^>]*\/>|<a:tab\b[^>]*\/>/g) ?? [];
    for (const t of tokens) {
      if (t.startsWith("<a:br")) parts.push("\n");
      else if (t.startsWith("<a:tab")) parts.push(" ");
      else if (t === "<a:t/>") continue;
      else parts.push(decodeXmlEntities(t.slice(5, -6)));
    }
    const line = parts.join("").replace(/[ \t]+/g, " ").trim();
    if (line) lines.push(...line.split("\n").map((l) => l.trim()).filter(Boolean));
  }
  return lines;
}

/* ------------------------------------------------------------------ extractors */

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: number; truncated: boolean; warnings: string[] }> {
  // The worker module registers pdf.js' worker in-process (no worker file lookup), which is
  // what makes pdf-parse work inside bundled serverless functions.
  await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes), verbosity: 0 });
  const warnings: string[] = [];
  try {
    const result = await parser.getText({ first: MAX_PDF_PAGES, pageJoiner: "" });
    const total = result.total;
    const pageTexts = result.pages.map((p) => p.text);
    const text = normalizeText(pageTexts.join("\n\n"));
    const truncated = total > MAX_PDF_PAGES;
    if (truncated) warnings.push(`Only the first ${MAX_PDF_PAGES} of ${total} pages were read.`);
    return { text, pages: total, truncated, warnings };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") throw new ExtractError("encrypted", "This PDF is password-protected. Export an unprotected copy and upload it again.");
    if (name === "InvalidPDFException") throw new ExtractError("corrupt", "This PDF could not be opened; it may be damaged.");
    throw err;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  const warnings = result.messages
    .filter((m) => m.type === "error")
    .slice(0, 3)
    .map((m) => `Part of the document could not be read (${m.message.slice(0, 120)}).`);
  return { text: normalizeText(result.value), warnings };
}

function slideNumber(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

async function extractPptx(bytes: Uint8Array): Promise<{ text: string; slides: number; truncated: boolean; warnings: string[] }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const warnings: string[] = [];

  // Slide order comes from presentation.xml (sldIdLst → r:id → rels target); fall back to file numbers.
  let ordered: string[] = [];
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const presRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (presentation && presRels) {
    const targets = new Map<string, string>();
    for (const m of presRels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && target && /slides\/slide\d+\.xml$/.test(target)) targets.set(id, `ppt/${target.replace(/^\.?\//, "").replace(/^\/?ppt\//, "")}`);
    }
    for (const m of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
      const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
      const path = rid ? targets.get(rid) : undefined;
      if (path && zip.file(path)) ordered.push(path);
    }
  }
  if (ordered.length === 0) {
    ordered = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
  }
  const total = ordered.length;
  const truncated = total > MAX_SLIDES;
  if (truncated) warnings.push(`Only the first ${MAX_SLIDES} of ${total} slides were read.`);

  const blocks: string[] = [];
  for (let i = 0; i < Math.min(total, MAX_SLIDES); i++) {
    const path = ordered[i];
    const xml = (await zip.file(path)?.async("string")) ?? "";
    const lines = drawingMlText(xml);
    // Speaker notes: ppt/slides/_rels/slideN.xml.rels → ../notesSlides/notesSlideM.xml
    const relsPath = path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const rels = await zip.file(relsPath)?.async("string");
    let notes: string[] = [];
    const notesTarget = rels ? /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1] : undefined;
    if (notesTarget) {
      const notesXml = (await zip.file(`ppt/notesSlides/${notesTarget}`)?.async("string")) ?? "";
      // Notes slides repeat the slide number placeholder; drop bare numbers.
      notes = drawingMlText(notesXml).filter((l) => !/^\d+$/.test(l));
    }
    const parts = [`[Slide ${i + 1}]`, ...lines];
    if (notes.length) parts.push(`Notes: ${notes.join(" ")}`);
    blocks.push(parts.join("\n"));
  }
  return { text: normalizeText(blocks.join("\n\n")), slides: total, truncated, warnings };
}

async function extractXlsx(bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  // Spreadsheets show up as transcripts or financial summaries: shared strings carry the text.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const strings = (shared.match(/<si\b[\s\S]*?<\/si>/g) ?? []).map((si) =>
    decodeXmlEntities((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")),
  );
  return { text: normalizeText(strings.filter(Boolean).join("\n")), warnings: ["Spreadsheet: only the text cells were read."] };
}

/* ------------------------------------------------------------------ entry point */

export async function extractFile(input: ExtractInput): Promise<ExtractedFile> {
  const { bytes, filename } = input;
  if (bytes.byteLength === 0) throw new ExtractError("corrupt", "The file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ExtractError("too_large", `The file is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Upload a smaller export.`);
  }
  const sniffed = sniffFormat(bytes, filename, input.contentType);
  const warnings: string[] = [];
  let text = "";
  let pages: number | undefined;
  let truncated = false;
  let needsVision = false;

  if (sniffed.zip) {
    const inflated = sniffed.zip.reduce((sum, e) => sum + e.uncompressedSize, 0);
    const worstRatio = sniffed.zip.reduce((max, e) => (e.compressedSize > 0 ? Math.max(max, e.uncompressedSize / e.compressedSize) : max), 0);
    if (!Number.isFinite(inflated) || inflated > MAX_UNZIPPED_BYTES || worstRatio > 400) {
      throw new ExtractError("zip_bomb", "This file expands to an unusually large size and was not opened.");
    }
  }

  switch (sniffed.format) {
    case "pdf": {
      const r = await extractPdf(bytes);
      text = r.text;
      pages = r.pages;
      truncated = r.truncated;
      warnings.push(...r.warnings);
      const readablePages = Math.min(r.pages, MAX_PDF_PAGES) || 1;
      if (text.replace(/\s/g, "").length < readablePages * SCANNED_CHARS_PER_PAGE) {
        needsVision = true;
        warnings.push("This PDF has little or no selectable text (it may be a scan); it will be read visually.");
      }
      break;
    }
    case "docx": {
      const r = await extractDocx(bytes);
      text = r.text;
      warnings.push(...r.warnings);
      break;
    }
    case "pptx": {
      const r = await extractPptx(bytes);
      text = r.text;
      pages = r.slides;
      truncated = r.truncated;
      warnings.push(...r.warnings);
      break;
    }
    case "xlsx": {
      const r = await extractXlsx(bytes);
      text = r.text;
      warnings.push(...r.warnings);
      break;
    }
    case "html": {
      const { htmlToReadable } = await import("./html");
      text = htmlToReadable(decodeText(bytes), null).text;
      break;
    }
    case "text": {
      const raw = decodeText(bytes);
      text = normalizeText(/\.rtf$/i.test(filename) || raw.startsWith("{\\rtf") ? rtfToText(raw) : raw);
      break;
    }
    case "image":
      needsVision = true;
      warnings.push("Images are read visually; text in them is not extracted on this server.");
      break;
    default: {
      const ext = (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? "").toLowerCase();
      if (["doc", "ppt", "xls", "pages", "key", "numbers"].includes(ext)) {
        throw new ExtractError("unsupported", `.${ext} files can't be read. Export it as PDF (or .docx / .pptx) and upload that.`);
      }
      throw new ExtractError("unsupported", "This file type isn't supported. Upload a PDF, Word (.docx), PowerPoint (.pptx), text file or image.");
    }
  }

  const capped = capText(text);
  if (capped.truncated) warnings.push("The document is very long; only the beginning was read.");
  const guess = guessDocumentKind({ filename, text: capped.text, contentType: sniffed.mediaType ?? input.contentType, pages: pages ?? null });
  return {
    format: sniffed.format,
    text: capped.text,
    ...(pages !== undefined ? { pages } : {}),
    kind: guess.kind,
    kindConfidence: guess.confidence,
    needsVision,
    mediaType: sniffed.mediaType,
    truncated: truncated || capped.truncated,
    warnings,
  };
}
