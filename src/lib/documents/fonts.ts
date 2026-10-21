import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "@/lib/env";

/*
 * A CJK font for PDFs. The PDF standard fonts (Helvetica…) have no Chinese glyphs, and a Vercel
 * function has no system fonts, so Chinese documents need Noto Sans SC (SIL Open Font License).
 *
 * Where it comes from, first hit wins:
 *   1. this instance's memory (a promise shared by concurrent renders);
 *   2. this instance's /tmp (survives warm invocations);
 *   3. our own R2 bucket, key `assets/fonts/<file>` (fast for every later cold start);
 *   4. Google Fonts: the CSS API answers clients without a user agent with static TrueType
 *      instances per weight (~10 MB each), served from fonts.gstatic.com; pinned URLs as backup.
 * After (4) the file is written to /tmp and, best effort, to R2. Nothing about the person is
 * sent anywhere: the request names only the font family and weight. A render that cannot get the
 * font returns null here and the caller falls back to DOCX (Word and WPS render Chinese with the
 * reader's own fonts).
 *
 * react-pdf subsets the font while embedding, so a one-page Chinese PDF stays ~15 KB.
 */

export interface CjkFontFiles {
  regular: string;
  bold: string;
}

const FAMILY_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700";
/** Known-good static instances (Noto Sans SC v41), used when the CSS API is unreachable. */
const PINNED: Record<400 | 700, string> = {
  400: "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf",
  700: "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf",
};
const FILES: Record<400 | 700, string> = { 400: "NotoSansSC-Regular.ttf", 700: "NotoSansSC-Bold.ttf" };
const MIN_BYTES = 1_000_000;
const TIMEOUT_MS = 20_000;

let memo: Promise<CjkFontFiles | null> | null = null;
let override: CjkFontFiles | null | undefined;

/** Tests and scripts: use these files (or `null` = no CJK font available) instead of fetching. */
export function setCjkFontFiles(files: CjkFontFiles | null | undefined): void {
  override = files;
  memo = null;
}

function cacheDir(): string {
  return path.join(tmpdir(), "onwardscout-fonts");
}

async function usable(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size >= MIN_BYTES;
  } catch {
    return false;
  }
}

/** TrueType (or OpenType) magic: 0x00010000, "true" or "OTTO". */
export function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_BYTES) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === "true" || tag === "OTTO";
}

/** Pulls the per-weight .ttf URLs out of the Google Fonts CSS. */
export function ttfUrlsFromCss(css: string): Partial<Record<400 | 700, string>> {
  const out: Partial<Record<400 | 700, string>> = {};
  for (const block of css.split("@font-face").slice(1)) {
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1]);
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(block)?.[1];
    if (url && (weight === 400 || weight === 700)) out[weight] = url;
  }
  return out;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return looksLikeFont(bytes) ? bytes : null;
  } catch (err) {
    console.warn("[documents] font fetch failed", url, err instanceof Error ? err.message : err);
    return null;
  }
}

async function googleUrls(): Promise<Record<400 | 700, string>> {
  try {
    // No user agent on purpose: Google then serves TrueType (react-pdf cannot read WOFF2).
    const res = await fetch(FAMILY_CSS, { headers: { "User-Agent": "" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.ok) {
      const found = ttfUrlsFromCss(await res.text());
      return { 400: found[400] ?? PINNED[400], 700: found[700] ?? PINNED[700] };
    }
  } catch (err) {
    console.warn("[documents] font CSS unavailable, using pinned URLs", err instanceof Error ? err.message : err);
  }
  return PINNED;
}

async function fromR2(file: string): Promise<Uint8Array | null> {
  if (!env("FILES_BASE_URL") || !env("FILES_API_TOKEN")) return null;
  try {
    const { readObject } = await import("@/lib/files");
    const bytes = await readObject(`assets/fonts/${file}`);
    return bytes && looksLikeFont(bytes) ? bytes : null;
  } catch (err) {
    console.warn("[documents] font cache read failed", err instanceof Error ? err.message : err);
    return null;
  }
}

async function toR2(file: string, bytes: Uint8Array): Promise<void> {
  if (!env("FILES_BASE_URL") || !env("FILES_API_TOKEN")) return;
  try {
    const { putObject } = await import("@/lib/files");
    await putObject(`assets/fonts/${file}`, bytes, "font/ttf");
  } catch (err) {
    console.warn("[documents] font cache write failed", err instanceof Error ? err.message : err);
  }
}

async function ensureWeight(weight: 400 | 700, urls: () => Promise<Record<400 | 700, string>>): Promise<string | null> {
  const file = path.join(cacheDir(), FILES[weight]);
  if (await usable(file)) return file;
  let bytes = await fromR2(FILES[weight]);
  let fresh = false;
  if (!bytes) {
    bytes = await fetchBytes((await urls())[weight]);
    if (!bytes && (await urls())[weight] !== PINNED[weight]) bytes = await fetchBytes(PINNED[weight]);
    fresh = Boolean(bytes);
  }
  if (!bytes) return null;
  await mkdir(cacheDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}`;
  await writeFile(tmp, bytes);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, file);
  if (fresh) await toR2(FILES[weight], bytes);
  return file;
}

async function load(): Promise<CjkFontFiles | null> {
  let cached: Promise<Record<400 | 700, string>> | null = null;
  const urls = () => (cached ??= googleUrls());
  const [regular, bold] = await Promise.all([ensureWeight(400, urls), ensureWeight(700, urls)]);
  if (!regular) return null;
  return { regular, bold: bold ?? regular };
}

/** Paths to Noto Sans SC regular/bold on local disk, or null when the font cannot be obtained. */
export async function loadCjkFonts(): Promise<CjkFontFiles | null> {
  if (override !== undefined) return override;
  if (!memo) {
    memo = load().catch((err) => {
      console.warn("[documents] CJK font unavailable", err instanceof Error ? err.message : err);
      return null;
    });
    // A failure is retried by the next render instead of being cached for the instance's life.
    void memo.then((r) => {
      if (!r) memo = null;
    });
  }
  return memo;
}

/** Reads a font file (tests use this to check a local CJK font before handing it over). */
export async function readFontFile(file: string): Promise<Uint8Array | null> {
  try {
    const bytes = new Uint8Array(await readFile(file));
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}
