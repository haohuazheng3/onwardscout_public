/*
 * Duplicate detection for ingested opportunities: by URL (host + path, ignoring tracking
 * parameters and "www.") and by organisation + name similarity. Pure; tested in
 * tests/sources-dedupe.test.ts.
 */

/** Query parameters that identify a posting/page (kept in the URL key); everything else is dropped. */
const ID_PARAMS = new Set(["gh_jid", "jid", "jobid", "job_id", "job", "id", "posting", "postingid", "p", "page_id", "pid", "opportunity", "call", "topic", "lever-via"]);

/**
 * Normalised URL identity: lower-cased host without `www.`/`m.`, decoded path without a
 * trailing slash or `index.html`, plus identifying query parameters (sorted). Null when not a URL.
 */
export function urlKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(?:www\d?|m)\./, "");
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  path = path.toLowerCase().replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/, "/").replace(/\/+$/, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => ID_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort();
  return `${host}${path}${params.length ? `?${params.join("&")}` : ""}`;
}

const NAME_STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "in", "at", "to", "on", "by", "with", "program", "programme", "&"]);

/** Lower-case, accent-free word list of a name ("The Y Combinator Program" → ["y", "combinator"]). */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => (t.length >= 2 || /\d/.test(t)) && !NAME_STOPWORDS.has(t));
}

/**
 * Similarity of two names in [0, 1]: Dice coefficient over their word sets. (No containment
 * shortcut: "Fulbright U.S. Scholar" and "Fulbright Visiting Scholar" are different programs.)
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

export function orgKey(org: string | null | undefined): string | null {
  const t = nameTokens(org ?? "").filter((w) => !["inc", "ltd", "llc", "gmbh", "foundation", "university", "co", "corp", "corporation"].includes(w));
  return t.length ? t.join(" ") : null;
}

export interface DedupeFields {
  url: string | null;
  org: string | null;
  name: string;
  /** When both items have a type and the types differ, they are never duplicates. */
  type?: string | null;
}

export interface DuplicateOf<T> {
  item: T;
  of: T;
  reason: "url" | "name";
  similarity: number;
}

export interface DedupeResult<T> {
  keep: T[];
  duplicates: Array<DuplicateOf<T>>;
  /** Different names behind one URL: kept, but worth a look (a generic page used for two programs). */
  sharedUrl: Array<{ item: T; with: T }>;
}

/**
 * Keeps the first of each duplicate group, in input order (items of different types never match):
 * - same URL key and names at least `urlNameThreshold` alike → duplicate ("url");
 * - same organisation and names at least `nameThreshold` alike → duplicate ("name").
 */
export function dedupe<T>(items: readonly T[], fields: (t: T) => DedupeFields, opts: { nameThreshold?: number; urlNameThreshold?: number } = {}): DedupeResult<T> {
  const nameThreshold = opts.nameThreshold ?? 0.95;
  const urlNameThreshold = opts.urlNameThreshold ?? 0.85;
  const sameType = (a: DedupeFields, b: DedupeFields) => !a.type || !b.type || a.type === b.type;
  const keep: T[] = [];
  const duplicates: Array<DuplicateOf<T>> = [];
  const sharedUrl: Array<{ item: T; with: T }> = [];
  const byUrl = new Map<string, T[]>();
  const byOrg = new Map<string, T[]>();
  for (const item of items) {
    const f = fields(item);
    const uk = urlKey(f.url);
    const ok = orgKey(f.org);
    let dup: DuplicateOf<T> | null = null;
    const sameUrl = uk ? (byUrl.get(uk) ?? []) : [];
    for (const other of sameUrl) {
      if (!sameType(f, fields(other))) continue;
      const sim = nameSimilarity(f.name, fields(other).name);
      if (sim >= urlNameThreshold) {
        dup = { item, of: other, reason: "url", similarity: sim };
        break;
      }
    }
    if (!dup && ok) {
      for (const other of byOrg.get(ok) ?? []) {
        if (!sameType(f, fields(other))) continue;
        const sim = nameSimilarity(f.name, fields(other).name);
        if (sim >= nameThreshold) {
          dup = { item, of: other, reason: "name", similarity: sim };
          break;
        }
      }
    }
    if (dup) {
      duplicates.push(dup);
      continue;
    }
    if (sameUrl.length) sharedUrl.push({ item, with: sameUrl[0] });
    keep.push(item);
    if (uk) byUrl.set(uk, [...sameUrl, item]);
    if (ok) byOrg.set(ok, [...(byOrg.get(ok) ?? []), item]);
  }
  return { keep, duplicates, sharedUrl };
}

/**
 * Job postings of one board: the same title, type and place listed twice (reposts, one
 * requisition per opening) collapse to the first; different places stay separate postings.
 * (URLs are not compared: some employers point every posting at one careers page.)
 */
export function dedupeJobs<T>(items: readonly T[], fields: (t: T) => { title: string; type: string; places: string[] }): { keep: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const keep: T[] = [];
  const duplicates: T[] = [];
  for (const item of items) {
    const f = fields(item);
    const k = `${f.type}|${nameTokens(f.title).join(" ")}|${[...new Set(f.places.map((p) => p.toLowerCase()))].sort().join(",")}`;
    if (seen.has(k)) {
      duplicates.push(item);
      continue;
    }
    seen.add(k);
    keep.push(item);
  }
  return { keep, duplicates };
}
