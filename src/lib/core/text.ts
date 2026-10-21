/**
 * Deterministic text matching for the taxonomies (occupation titles, industry and function
 * keywords, identity cues). Works on English and Chinese: Latin text is compared as normalized
 * word tokens, Chinese (or mixed) phrases as compact strings without spaces. No dictionaries,
 * no network, no model: the `local` intelligence provider and the tests rely on it being stable.
 */
import { hasCjk } from "./labels";

const STOPWORDS = new Set(["an", "and", "of", "the", "at", "in", "for", "to", "with", "on", "de", "la", "le"]);

/** Lowercase, strip accents, turn `&` into `and`, keep letters/digits/`+`/`#`, collapse spaces. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#ß-ɏͰ-ϿЀ-ӿ぀-ヿ㐀-鿿豈-﫿가-힯]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Light English stemmer: drops a plural `s` (not `ss`/`us`/`is`) so "engineers" = "engineer". */
export function stemToken(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Latin word tokens of a normalized string (CJK runs are ignored), stopwords removed, stemmed. */
export function latinTokens(normalized: string): string[] {
  const raw = normalized.match(/[a-z0-9+#]+/g) ?? [];
  return raw.filter((t) => !STOPWORDS.has(t)).map(stemToken);
}

/** The normalized string without spaces: the form CJK phrases are compared against. */
export function compactText(normalized: string): string {
  return normalized.replace(/\s+/g, "");
}

export interface PreparedText {
  normalized: string;
  tokens: string[];
  compact: string;
  cjk: boolean;
}

export function prepareText(input: string): PreparedText {
  const normalized = normalizeText(input);
  return { normalized, tokens: latinTokens(normalized), compact: compactText(normalized), cjk: hasCjk(normalized) };
}

/** A phrase compiled once: Latin phrases as token arrays, CJK/mixed phrases as compact strings. */
export type CompiledPhrase = { kind: "latin"; tokens: string[] } | { kind: "cjk"; compact: string };

export function compilePhrase(phrase: string): CompiledPhrase | null {
  const normalized = normalizeText(phrase);
  if (!normalized) return null;
  if (hasCjk(normalized)) return { kind: "cjk", compact: compactText(normalized) };
  const tokens = latinTokens(normalized);
  return tokens.length ? { kind: "latin", tokens } : null;
}

function indexOfSequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Length of the shortest window of `text` containing `needle`'s characters in order; 0 if none. */
function subsequenceSpan(text: string, needle: string): number {
  let best = 0;
  for (let start = text.indexOf(needle[0]); start >= 0; start = text.indexOf(needle[0], start + 1)) {
    let j = 1;
    let i = start + 1;
    for (; i < text.length && j < needle.length; i++) if (text[i] === needle[j]) j++;
    if (j < needle.length) break;
    const span = i - start;
    if (!best || span < best) best = span;
  }
  return best;
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const pool = new Map<string, number>();
  for (const g of B) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of A) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/**
 * How well one phrase describes a whole (short) text, in [0, 1]:
 * 1 = the text is exactly the phrase; 0.7–0.95 = the phrase appears inside the text (longer
 * coverage scores higher); below 0.6 = partial token / character-bigram overlap.
 */
export function scorePhrase(text: PreparedText, phrase: CompiledPhrase): number {
  if (phrase.kind === "latin") {
    const t = text.tokens;
    if (!t.length) return 0;
    const p = phrase.tokens;
    if (p.length === t.length && indexOfSequence(t, p) === 0) return text.cjk ? 0.9 : 1;
    if (indexOfSequence(t, p) >= 0) return 0.7 + 0.25 * (p.length / t.length);
    const tset = new Set(t);
    const inter = new Set(p.filter((x) => tset.has(x))).size;
    if (!inter) return 0;
    const precision = inter / t.length;
    const recall = inter / new Set(p).size;
    return 0.6 * ((2 * precision * recall) / (precision + recall));
  }
  const c = phrase.compact;
  const t = text.compact;
  if (!t) return 0;
  if (c === t) return 1;
  if (t.includes(c)) return 0.7 + 0.25 * (c.length / t.length);
  if (text.cjk && t.length >= 2 && c.includes(t)) return 0.1 + 0.5 * (t.length / c.length);
  if (!text.cjk) return 0;
  const span = subsequenceSpan(t, c);
  if (c.length >= 3 && span > 0 && span <= c.length + 3) return 0.5 + 0.2 * (c.length / t.length);
  const d = dice(c, t);
  return d >= 0.5 ? 0.55 * d : 0;
}

/** True when the phrase occurs in the text as whole words (Latin) or as a substring (CJK). */
export function containsPhrase(text: PreparedText, phrase: CompiledPhrase): boolean {
  if (phrase.kind === "latin") return indexOfSequence(text.tokens, phrase.tokens) >= 0;
  return text.compact.includes(phrase.compact);
}

export interface PhraseEntry {
  code: string;
  phrases: readonly string[];
}

export interface PhraseMatch {
  code: string;
  score: number;
}

export interface PhraseMatcherOptions {
  /** Words dropped from a second variant of the input (seniority, contract type…), Latin. */
  dropWords?: readonly string[];
  /** Substrings dropped from a second variant of the input, CJK. */
  dropCjk?: readonly string[];
}

export interface MatchOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Builds a matcher over many coded phrase lists. A query is scored as a whole, after dropping
 * modifier words, and per segment (titles like "Engineer, Backend | Acme"), keeping the best
 * score per code. Results are sorted by score, then code, so output is deterministic.
 */
export function createPhraseMatcher(entries: readonly PhraseEntry[], options: PhraseMatcherOptions = {}) {
  const compiled = entries.map((e) => ({
    code: e.code,
    phrases: e.phrases.map(compilePhrase).filter((p): p is CompiledPhrase => p !== null),
  }));
  const drop = new Set((options.dropWords ?? []).map((w) => stemToken(normalizeText(w))));
  const dropCjk = [...(options.dropCjk ?? [])].sort((a, b) => b.length - a.length);

  function variants(input: string): PreparedText[] {
    const raw = input.slice(0, 300);
    const pieces = [raw, ...raw.split(/[|,;·/@()（）[\]【】，、；]|\s[-–—]\s|\s+at\s+/i)];
    const out: PreparedText[] = [];
    const seen = new Set<string>();
    for (const piece of pieces) {
      const base = normalizeText(piece);
      if (!base) continue;
      let stripped = base
        .split(" ")
        .filter((w) => !drop.has(stemToken(w)))
        .join(" ");
      for (const m of dropCjk) stripped = stripped.split(m).join(" ");
      for (const v of [base, normalizeText(stripped)]) {
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(prepareText(v));
      }
    }
    return out;
  }

  return function match(text: string, opts: MatchOptions = {}): PhraseMatch[] {
    const limit = opts.limit ?? 5;
    const minScore = opts.minScore ?? 0.3;
    const prepared = variants(text);
    if (!prepared.length) return [];
    const results: PhraseMatch[] = [];
    for (const entry of compiled) {
      let best = 0;
      for (const v of prepared) {
        for (const p of entry.phrases) {
          const s = scorePhrase(v, p);
          if (s > best) best = s;
          if (best === 1) break;
        }
        if (best === 1) break;
      }
      if (best >= minScore) results.push({ code: entry.code, score: Math.round(best * 1000) / 1000 });
    }
    results.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    return results.slice(0, limit);
  };
}
