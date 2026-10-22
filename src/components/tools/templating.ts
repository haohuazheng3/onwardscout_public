/*
 * Placeholder engine for generator and brief tools. Pure, no DOM, no React: the renderer and
 * the tests both import it, and the schema uses `placeholderIds` to refuse a template that
 * names an input the tool does not have.
 *
 * Template syntax (inside `{{ }}`, whitespace around the parts is ignored):
 *   {{inputId}}                 the input's value as text
 *   {{inputId|filter|filter}}   the value run through filters, left to right (see FILTERS)
 *   {{pick:a|b|c}}              one of the literals, chosen with the seeded generator
 *   {{n:1-5}}                   a whole number between the two bounds (inclusive), seeded
 *
 * Values: strings are trimmed; numbers print as typed; toggles print "yes" / "no";
 * multiselects and textarea lines print as "a, b, c". List filters (first, second, third,
 * last, count, list) read a multiselect as its items and a textarea as its non-empty lines,
 * with leading bullets ("- ", "* ", "1. ") removed.
 */

export type TemplateValue = string | number | boolean | readonly string[] | null | undefined;
export type TemplateValues = Record<string, TemplateValue>;

export interface RenderResult {
  text: string;
  /** Input ids the template used whose value was empty (unknown ids are reported too). */
  missing: string[];
}

/** 32-bit FNV-1a: stable across runs and platforms, so a seed derived from inputs is reproducible. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator returning floats in [0, 1). The same seed always gives the same sequence. */
export function createRng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator; the input is not mutated. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const a = [...items];
  const rng = createRng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Non-empty lines of a textarea, trimmed, leading list markers removed. */
export function splitLines(value: TemplateValue): string[] {
  if (Array.isArray(value)) return (value as readonly string[]).map((v) => v.trim()).filter(Boolean);
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") return [toText(value)].filter(Boolean);
  return value
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function toText(value: TemplateValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (Array.isArray(value)) return (value as readonly string[]).map((v) => v.trim()).filter(Boolean).join(", ");
  return String(value).trim();
}

function capitalize(s: string): string {
  // Brand-style words keep their case: "iPhone app", "eBay seller".
  if (!s || /^[a-z]+[A-Z]/.test(s)) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Words that only start with a capital because they start the phrase. uncap lowercases these
 * and nothing else, so names typed at the start of a phrase survive ("Python", "Berlin", "Figma").
 */
const SENTENCE_STARTERS = new Set(
  (
    "a an the this that these those my our your their his her its we you they he she it one two three four five every each all most some many several few " +
    "at in on for with by from to of as into onto over under after before during since while when where until once through across within without about around between " +
    "and but so or if because although though yet then now today recently lately last first next also still just only even both either neither " +
    "built led ran managed created designed developed grew cut reduced increased launched delivered helped wrote taught trained organized coordinated analyzed improved raised won " +
    "published presented shipped spent worked moved started founded mentored supervised implemented automated negotiated secured completed earned studied volunteered served owned " +
    "rebuilt redesigned set turned made drove scaled expanded opened brought handled introduced restructured streamlined tested researched planned produced directed edited " +
    "help support build lead grow open bring turn make drive reduce improve expand launch scale create deliver develop design run manage own ship write teach strengthen " +
    "working leading building helping running managing teaching writing designing developing making getting moving finding solving keeping creating supporting " +
    "saved generated achieved boosted closed doubled tripled exceeded resolved processed oversaw partnered established converted " +
    "surveyed measured monitored interviewed compared evaluated examined assessed modeled sampled collected recorded estimated tracked mapped " +
    "work return join pursue become study apply use continue explore focus turning owning forecasting faster lower higher better more less day " +
    "how what why who whether which"
  ).split(/\s+/),
);

function withArticle(s: string): string {
  if (!s) return s;
  const first = s.split(/\s+/)[0];
  // Acronyms are read letter by letter ("an LED", "a USB"); numbers by their sound ("an 8", "an 11").
  const an = /^[A-Z0-9]{2,}$/.test(first) || /^\d/.test(first)
    ? /^(?:[AEFHILMNORSX8]|11|18)/.test(first)
    : (/^[aeiou]/i.test(s) && !/^(?:uni|use|usu|eu|one|once|ure)/i.test(s)) || /^(?:hour|honest|heir|honou?r)/i.test(s);
  return `${an ? "an" : "a"} ${s}`;
}

const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "but", "for", "nor", "at", "by", "in", "of", "on", "to", "up", "as", "with", "from", "via", "vs"]);

function titleCase(s: string): string {
  return s
    .split(/(\s+)/)
    .map((word, i) => {
      if (/^\s+$/.test(word) || !word) return word;
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      // Keep units and mixed-case tokens such as "cm", "oz", "iPhone" as typed.
      if (/^(?:cm|mm|ml|oz|in|ft|kg|g|lb|lbs|l)$/i.test(word) || /[a-z][A-Z]/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Filters by name. Text filters receive the value as text; list filters receive the value
 * as items (see the header comment). A filter that does not apply returns the text unchanged.
 */
export const FILTERS: Record<string, (value: TemplateValue) => string> = {
  /** "Stainless Steel Bottle" → "stainless steel bottle" */
  lower: (v) => toText(v).toLowerCase(),
  /** "bottle" → "BOTTLE" */
  upper: (v) => toText(v).toUpperCase(),
  /** First letter lower-case so a sentence can continue another one ("I…", "I'm…" and acronyms stay as typed): "At my last job" → "at my last job". */
  uncap: (v) => {
    const t = toText(v);
    const first = /^[A-Za-z]+/.exec(t)?.[0] ?? "";
    return SENTENCE_STARTERS.has(first.toLowerCase()) && first !== "I" ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  },
  /** A full sentence typed without its final mark gets a period: "I cut costs by 9%" → "I cut costs by 9%." Empty stays empty. */
  sentence: (v) => {
    const t = toText(v);
    return !t || /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`;
  },
  /**
   * A phrase pasted with a final period, "!" or "?" loses it so it can sit mid-sentence: "cut churn to 4%." → "cut churn to 4%".
   * A period that ends an abbreviation stays: "work in the U.S.", "Acme Co.".
   */
  phrase: (v) => {
    const t = toText(v).replace(/[\s,;:!?…]+$/u, "");
    if (/(?:^|[\s.(])(?:[A-Za-z]|Inc|Co|Corp|Ltd|Jr|Sr|St|etc)\.$/.test(t)) return t;
    return t.replace(/[\s.,;:!?…]+$/u, "");
  },
  /** A number as US dollars with thousands separators: 25000 → "$25,000". Non-numbers print unchanged. */
  usd: (v) => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : toText(v);
  },
  /** First letter upper-case, the rest untouched: "keeps ice 24 h" → "Keeps ice 24 h" */
  cap: (v) => capitalize(toText(v)),
  /** With the right indefinite article: "insulated bottle" → "an insulated bottle", "lunch box" → "a lunch box". */
  a: (v) => withArticle(toText(v)),
  /** Title case: each word capitalised except short articles, conjunctions and prepositions after the first. */
  title: (v) => titleCase(toText(v)),
  /** First item or textarea line. */
  first: (v) => splitLines(v)[0] ?? "",
  /** Second item or line ("" when there is none). */
  second: (v) => splitLines(v)[1] ?? "",
  /** Third item or line. */
  third: (v) => splitLines(v)[2] ?? "",
  /** Last item or line. */
  last: (v) => splitLines(v).at(-1) ?? "",
  /** Number of items or lines, as text. */
  count: (v) => String(splitLines(v).length),
  /** Items joined as prose: "a, b and c". */
  list: (v) => joinList(splitLines(v)),
  /** Items as a bullet list, one per line (for briefs). */
  bullets: (v) =>
    splitLines(v)
      .map((l) => `- ${l}`)
      .join("\n"),
  /** Bullets with the first letter of each item capitalised (bulleted lists). */
  capbullets: (v) =>
    splitLines(v)
      .map((l) => `- ${capitalize(l)}`)
      .join("\n"),
  /** Each item or line as a hashtag, space-separated: "lunch box\nbento" → "#LunchBox #Bento". */
  tags: (v) =>
    splitLines(v)
      .map(hashtag)
      .filter(Boolean)
      .join(" "),
  /** The whole value as one hashtag: "collapsible lunch box" → "#CollapsibleLunchBox". */
  tag: (v) => hashtag(toText(v)),
};

/** Letters and digits only, each word capitalised (camel case reads better and is easier for screen readers). */
function hashtag(s: string): string {
  const words = s
    .replace(/^#/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words.length ? `#${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("")}` : "";
}

export const FILTER_NAMES: readonly string[] = Object.keys(FILTERS);

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Input ids a template reads, in order of first use (pick/n placeholders are not inputs). */
export function placeholderIds(template: string): string[] {
  const ids: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const inner = m[1].trim();
    if (/^(pick|n)\s*:/.test(inner)) continue;
    const id = inner.split("|")[0].trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Inputs the templates place mid-sentence (used with `uncap` or `lower`). Their fields switch off the phone
 * keyboard's automatic capital, so "Grew revenue…" typed on a phone does not land as "I Grew revenue…".
 */
export function midSentenceIds(templates: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const t of templates) {
    for (const m of t.matchAll(PLACEHOLDER)) {
      const [id, ...filters] = m[1].split("|").map((s) => s.trim());
      if (id && filters.some((f) => f === "uncap" || f === "lower")) ids.add(id);
    }
  }
  return ids;
}

/** Filter names a template uses that FILTERS does not define (schema validation). */
export function unknownFilters(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const inner = m[1].trim();
    if (/^(pick|n)\s*:/.test(inner)) continue;
    for (const f of inner.split("|").slice(1)) {
      const name = f.trim();
      if (name && !(name in FILTERS) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Malformed `{{n:…}}` placeholders (schema validation): the bounds must be two whole numbers, low first. */
export function invalidRanges(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const inner = m[1].trim();
    const r = /^n\s*:\s*(.*)$/.exec(inner);
    if (!r) continue;
    const b = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(r[1].trim());
    if (!b || Number(b[1]) > Number(b[2])) out.push(m[0]);
  }
  return out;
}

/**
 * Whitespace and punctuation clean-up after substitution: collapsed spaces, no space before
 * punctuation, no doubled sentence punctuation, trimmed lines. Blank lines are kept (briefs).
 */
export function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([,.;:!?])\1+/g, "$1")
        .replace(/,([.!?])/g, "$1")
        .replace(/([!?])\.(?=\s|$)/g, "$1")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fits a typed value to the template text that follows it. A phrase typed with a final period
 * loses it when the sentence carries on ("cut costs 14%." + ", and" → "cut costs 14%, and"); a
 * sentence typed without end punctuation gains one when a new sentence follows on the same line.
 */
export function joinNext(value: string, after: string): string {
  if (!value) return value;
  const endsWithPeriod = /[^.]\.$/.test(value) && !/\b(?:e\.g|i\.e|etc|Inc|Ltd|Co|Jr|Sr|Dr|St|vs)\.$/.test(value) && !/(?:\b[A-Z]\.){2,}$/.test(value);
  if (endsWithPeriod && /^(?:[,;:)]| +[a-z|·–])/.test(after)) return value.slice(0, -1);
  const looksLikeSentence = /^["“]?[A-Z]/.test(value) && value.trim().split(/\s+/).length >= 3;
  if (looksLikeSentence && !/[.!?…"'”’)\]]$/.test(value) && /^ +["“A-Z]/.test(after)) return `${value}.`;
  return value;
}

export function renderTemplate(template: string, values: TemplateValues, opts: { rng?: () => number; seed?: number } = {}): RenderResult {
  const rng = opts.rng ?? createRng(opts.seed ?? 1);
  const missing: string[] = [];
  const resolve = (rawInner: string, after: string): string => {
    const inner = rawInner.trim();
    const pick = /^pick\s*:([\s\S]*)$/.exec(inner);
    if (pick) {
      const options = pick[1]
        .split("|")
        .map((o) => o.trim())
        .filter(Boolean);
      if (!options.length) return "";
      return options[Math.floor(rng() * options.length)];
    }
    const range = /^n\s*:\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(inner);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (hi < lo) return String(lo);
      return String(lo + Math.floor(rng() * (hi - lo + 1)));
    }
    const [idRaw, ...filters] = inner.split("|");
    const id = idRaw.trim();
    if (!(id in values)) {
      if (!missing.includes(id)) missing.push(id);
      return "";
    }
    let value: TemplateValue = values[id];
    for (const f of filters) {
      const name = f.trim();
      const fn = FILTERS[name];
      value = fn ? fn(value) : toText(value);
    }
    const out = joinNext(toText(value), after);
    if (!out && !missing.includes(id)) missing.push(id);
    return out;
  };
  // Right to left, so each value sees the text that really follows it, values included.
  const matches = [...template.matchAll(PLACEHOLDER)];
  let tail = "";
  let end = template.length;
  for (let k = matches.length - 1; k >= 0; k--) {
    const m = matches[k];
    const start = m.index ?? 0;
    tail = template.slice(start + m[0].length, end) + tail;
    tail = resolve(m[1], tail) + tail;
    end = start;
  }
  const text = template.slice(0, end) + tail;
  return { text: tidy(text), missing };
}

/** Whitespace-separated tokens with at least one letter or digit: the same count the blog uses for articles. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
