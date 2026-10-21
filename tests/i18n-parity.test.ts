/**
 * Translation parity: every English message has a Chinese counterpart with the same shape and
 * the same placeholders. A feature that adds an English key without its zh twin, or a
 * translation that drops `{count}`, renames a plural branch, loses a rich-text tag or a legal
 * link target, fails here instead of rendering a raw key or a broken sentence.
 *
 * Also checked: every zh message compiles and formats with next-intl (so a stray brace or a
 * broken plural is caught before it reaches a page), and the typed bilingual content modules
 * carry real Chinese, not English placeholders.
 */
import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { AUDIENCE_CONTENT } from "@/content/audiences";
import { CONTACT_TOPICS } from "@/content/contact";
import { FAQS, FAQ_GROUP_LABELS } from "@/content/faq";
import { CREDIT_RULES, OFFERS } from "@/content/plans";
import { ABOUT, BOUNDARY, CHANNEL_PLAIN, DRAFT_LABELS, FREE_INCLUDES, HANDOFF, PRINCIPLES, SAFETY_RULES, STEPS } from "@/content/site-copy";
import { NAMESPACES } from "@/i18n/namespaces";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (locale: string, ns: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", locale, `${ns}.json`), "utf8"));

/* ------------------------------------------------------------------ flattening */

type Leaf = { key: string; value: unknown };

/** Every leaf of a message tree, arrays included (`a.b.0.c`). */
function leaves(value: unknown, prefix = "", out: Leaf[] = []): Leaf[] {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i), out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.push({ key: prefix, value });
  return out;
}

/** Every node path (objects and arrays too), so a missing subtree or array is reported by name. */
function shape(value: unknown, prefix = "", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    out.push(`${prefix}[]#${value.length}`);
    value.forEach((v, i) => shape(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (value && typeof value === "object") {
    out.push(`${prefix}{}`);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) shape(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.push(`${prefix}:${typeof value}`);
  return out;
}

/* ------------------------------------------------------------------ ICU signature */

const COMPLEX = new Set(["plural", "select", "selectordinal"]);

/**
 * A canonical description of what a message needs from its caller: each argument with its
 * type and (for plural/select) its branch selectors, every rich-text tag, and — for the
 * long-form legal copy — the `[label](target)` link targets and `code` spans. Order-free,
 * because Chinese reorders a sentence. Throws on malformed ICU (unbalanced braces).
 */
function icuSignature(message: string): string[] {
  const sig = new Set<string>();
  let i = 0;
  const n = message.length;

  const skipWs = () => {
    while (i < n && /\s/.test(message[i]!)) i++;
  };
  const ident = () => {
    skipWs();
    const start = i;
    while (i < n && /[^\s,{}]/.test(message[i]!)) i++;
    return message.slice(start, i);
  };

  /** Reads text until an unmatched `}` (inside a branch) or the end; ICU apostrophe quoting respected. */
  function body(inPlural: boolean, nested: boolean): void {
    while (i < n) {
      const c = message[i]!;
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") {
          i += 2;
          continue;
        }
        if (next !== undefined && (next === "{" || next === "}" || (inPlural && next === "#") || next === "<" || next === ">" || next === "|")) {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? n : end + 1;
          continue;
        }
        i++;
        continue;
      }
      if (c === "{") {
        i++;
        argument();
        continue;
      }
      if (c === "}") {
        if (!nested) throw new Error(`unexpected "}" at ${i}`);
        return;
      }
      i++;
    }
    if (nested) throw new Error("unterminated branch");
  }

  function argument(): void {
    const name = ident();
    if (!name) throw new Error(`empty argument at ${i}`);
    skipWs();
    if (message[i] === "}") {
      i++;
      sig.add(`arg:${name}`);
      return;
    }
    if (message[i] !== ",") throw new Error(`expected "," after {${name} at ${i}`);
    i++;
    const type = ident();
    skipWs();
    if (!COMPLEX.has(type)) {
      // number / date / time with an optional style: skip to the closing brace.
      let depth = 0;
      while (i < n && !(message[i] === "}" && depth === 0)) {
        if (message[i] === "{") depth++;
        if (message[i] === "}") depth--;
        i++;
      }
      if (message[i] !== "}") throw new Error(`unterminated {${name}, ${type}}`);
      i++;
      sig.add(`arg:${name}:${type}`);
      return;
    }
    if (message[i] !== ",") throw new Error(`expected "," after {${name}, ${type} at ${i}`);
    i++;
    const selectors: string[] = [];
    for (;;) {
      skipWs();
      if (message[i] === "}") {
        i++;
        break;
      }
      let selector = ident();
      if (selector.startsWith("offset:")) {
        selector = ident();
      }
      skipWs();
      if (message[i] !== "{") throw new Error(`expected "{" after selector ${selector} in {${name}} at ${i}`);
      i++;
      body(type !== "select", true);
      if (message[i] !== "}") throw new Error(`unterminated branch ${selector} in {${name}}`);
      i++;
      selectors.push(selector);
    }
    if (!selectors.includes("other")) throw new Error(`{${name}, ${type}} has no "other" branch`);
    sig.add(`arg:${name}:${type}[${selectors.sort().join("|")}]`);
  }

  body(false, false);
  // Markup is read from the whole message: a link label or target may itself hold an argument.
  for (const m of message.matchAll(/<\/?([A-Za-z][\w-]*)\s*\/?>/g)) sig.add(`tag:${m[1]}`);
  for (const m of message.matchAll(/\]\(([^)\s]+)\)/g)) sig.add(`href:${m[1]}`);
  for (const m of message.matchAll(/`([^`]+)`/g)) sig.add(`code:${m[1]}`);
  return [...sig].sort();
}

/** Values that satisfy a message's arguments and tags, for a formatting smoke test. */
function sampleValues(signature: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const item of signature) {
    const [kind, name, rest] = item.split(":");
    if (kind === "tag") values[name!] = (chunks: unknown) => (Array.isArray(chunks) ? chunks.join("") : String(chunks));
    if (kind !== "arg") continue;
    if (!rest) values[name!] ??= "x";
    else if (rest.startsWith("plural") || rest.startsWith("selectordinal") || rest === "number") values[name!] = 2;
    else if (rest === "date" || rest === "time") values[name!] = new Date(Date.UTC(2026, 9, 21));
    else if (rest.startsWith("select")) values[name!] = "other";
  }
  return values;
}

/* ------------------------------------------------------------------ message files */

const CJK = /[㐀-鿿豈-﫿]/;

describe("zh messages mirror en", () => {
  for (const ns of NAMESPACES) {
    describe(ns, () => {
      const en = read("en", ns);
      const zh = read("zh", ns);

      it("has every en key (and nothing en doesn't have), with the same shape", () => {
        const enShape = shape(en);
        const zhShape = new Set(shape(zh));
        const missing = enShape.filter((p) => !zhShape.has(p));
        expect(missing, `missing or reshaped in messages/zh/${ns}.json`).toEqual([]);
        const extra = [...zhShape].filter((p) => !enShape.includes(p));
        expect(extra, `keys in messages/zh/${ns}.json that en does not have`).toEqual([]);
      });

      it("keeps every placeholder, plural/select branch, tag and link target", () => {
        const zhLeaves = new Map(leaves(zh).map((l) => [l.key, l.value]));
        const problems: string[] = [];
        for (const { key, value } of leaves(en)) {
          const other = zhLeaves.get(key);
          if (typeof value !== "string") {
            if (other !== value) problems.push(`${key}: non-string leaf differs`);
            continue;
          }
          if (typeof other !== "string" || other.trim() === "") {
            problems.push(`${key}: missing or empty`);
            continue;
          }
          // Identifiers (legal section ids are page anchors like /privacy#analytics) are never translated.
          if (/(^|\.)id$/.test(key)) {
            if (other !== value) problems.push(`${key}: id "${other}" must stay "${value}"`);
            continue;
          }
          let enSig: string[];
          try {
            enSig = icuSignature(value);
          } catch {
            continue; // English is not ICU here (raw copy); nothing to compare structurally.
          }
          let zhSig: string[];
          try {
            zhSig = icuSignature(other);
          } catch (error) {
            problems.push(`${key}: zh is not valid ICU (${(error as Error).message})`);
            continue;
          }
          if (enSig.join(" ") !== zhSig.join(" ")) problems.push(`${key}:\n    en ${enSig.join(" ")}\n    zh ${zhSig.join(" ")}`);
          // Legal copy uses **bold**: keep the same number of bold runs so none is left open.
          if ((value.match(/\*\*/g) ?? []).length !== (other.match(/\*\*/g) ?? []).length) problems.push(`${key}: **bold** markers differ`);
        }
        expect(problems, `messages/zh/${ns}.json`).toEqual([]);
      });

      it("formats every message with next-intl in zh", () => {
        if (ns === "legal") return; // legal copy is read raw (t.raw) and filled by fillVars, not ICU-formatted
        const problems: string[] = [];
        const t = createTranslator({
          locale: "zh",
          messages: { [ns]: zh } as never,
          namespace: ns as never,
          timeZone: "UTC",
          onError: (error) => problems.push(error.message),
        }) as unknown as { markup: (key: string, values: Record<string, unknown>) => string };
        for (const { key, value } of leaves(en)) {
          if (typeof value !== "string") continue;
          let sig: string[];
          try {
            sig = icuSignature(value);
          } catch {
            continue;
          }
          const out = t.markup(key, sampleValues(sig));
          expect(typeof out, key).toBe("string");
        }
        expect(problems).toEqual([]);
      });

      it("is actually translated (Chinese text, not an English copy)", () => {
        const zhLeaves = new Map(leaves(zh).map((l) => [l.key, l.value]));
        const english: string[] = [];
        let prose = 0;
        for (const { key, value } of leaves(en)) {
          if (typeof value !== "string" || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) continue; // slugs and ids stay as they are
          // Prose = at least three Latin words outside placeholders; names, codes and units are exempt.
          const words = value.replace(/\{[^{}]*\}/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
          if (words.length < 3) continue;
          prose++;
          const other = zhLeaves.get(key);
          if (typeof other === "string" && !CJK.test(other)) english.push(key);
        }
        // A handful of strings may legitimately stay English (product names, sample input).
        expect(english.length, `untranslated in messages/zh/${ns}.json: ${english.slice(0, 20).join(", ")}`).toBeLessThanOrEqual(Math.max(2, Math.floor(prose * 0.02)));
      });
    });
  }

  it("the signature parser understands plurals, selects, tags and links", () => {
    expect(icuSignature("{count, plural, =0 {none} one {# credit} other {# credits}}")).toEqual(["arg:count:plural[=0|one|other]"]);
    expect(icuSignature("Read {name}…{more, plural, =0 {} one { and # more} other { and # more}}")).toEqual(["arg:more:plural[=0|one|other]", "arg:name"]);
    expect(icuSignature("I agree to the <terms>terms</terms>")).toEqual(["tag:terms"]);
    expect(icuSignature("Write to [{email}](mailto:{email}). `os_anon`")).toEqual(["arg:email", "code:os_anon", "href:mailto:{email}"]);
    expect(icuSignature("It's '{literal}' text")).toEqual([]);
    expect(() => icuSignature("{count, plural, one {x}")).toThrow();
    expect(() => icuSignature("broken }")).toThrow();
  });
});

/* ------------------------------------------------------------------ typed content modules */

type Bi = { en: string; zh: string };
type BiList = { en: string[]; zh: string[] };

/** Every `{ en, zh }` leaf in a value (deep), both string and string-list shapes. */
function bilinguals(value: unknown, out: { strings: Bi[]; lists: BiList[] } = { strings: [], lists: [] }) {
  if (Array.isArray(value)) value.forEach((v) => bilinguals(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 2 && keys.includes("en") && keys.includes("zh")) {
      if (typeof o.en === "string" && typeof o.zh === "string") out.strings.push(o as Bi);
      else if (Array.isArray(o.en) && Array.isArray(o.zh)) out.lists.push(o as BiList);
      return out;
    }
    Object.values(o).forEach((v) => bilinguals(v, out));
  }
  return out;
}

const CONTENT = {
  STEPS,
  BOUNDARY,
  PRINCIPLES,
  CHANNEL_PLAIN,
  HANDOFF,
  SAFETY_RULES,
  DRAFT_LABELS,
  ABOUT,
  FREE_INCLUDES,
  AUDIENCE_CONTENT,
  FAQS,
  FAQ_GROUP_LABELS,
  CONTACT_TOPICS,
  OFFERS,
  CREDIT_RULES,
};

describe("bilingual content modules are translated", () => {
  const { strings, lists } = bilinguals(CONTENT);

  it("finds the copy", () => {
    expect(strings.length).toBeGreaterThan(500);
  });

  it("has Chinese for every English sentence", () => {
    // Proper names that read the same in Chinese.
    const KEEP_ENGLISH = new Set(["ORCID iD"]);
    const untranslated = strings
      .filter((b) => !KEEP_ENGLISH.has(b.en) && (b.en.match(/[A-Za-z]{2,}/g) ?? []).length >= 2 && !CJK.test(b.zh))
      .map((b) => b.en);
    expect(untranslated).toEqual([]);
  });

  it("keeps placeholders, links and numbers the English states", () => {
    const problems: string[] = [];
    for (const b of strings) {
      const enVars = [...b.en.matchAll(/\{([A-Za-z]\w*)\}/g)].map((m) => m[1]).sort();
      const zhVars = [...b.zh.matchAll(/\{([A-Za-z]\w*)\}/g)].map((m) => m[1]).sort();
      if (enVars.join() !== zhVars.join()) problems.push(`vars: ${b.en}`);
      const enHrefs = [...b.en.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort();
      const zhHrefs = [...b.zh.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort();
      if (enHrefs.join() !== zhHrefs.join()) problems.push(`links: ${b.en}`);
      // Every number in the English (credits, days, prices, percentages) appears in the Chinese.
      for (const num of b.en.match(/\d+(?:[.,]\d+)?/g) ?? []) {
        if (!b.zh.includes(num) && !b.zh.includes(num.replace(/,/g, ""))) problems.push(`number ${num}: ${b.en}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("translates list-shaped copy item by item", () => {
    for (const l of lists) {
      expect(l.zh.length, l.en.join(" | ")).toBe(l.en.length);
      for (const item of l.zh) expect(CJK.test(item) || !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(item), item).toBe(true);
    }
  });
});
