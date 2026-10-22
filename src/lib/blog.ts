import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";
import { z } from "zod";
import { CATEGORIES, categoryBySlug, type Category } from "@/content/categories";

/*
 * Publishing pipeline. An article is one file, content/blog/<category>/<slug>.mdx, with
 * frontmatter:
 *
 *   title, description, publishedAt, updatedAt (YYYY-MM-DD), category (= the folder),
 *   keywords[] (1–8 phrases), featured? (boolean), draft? (boolean),
 *   level (A = tool-first page, B = decision article), tool? (content/tools/<id>.json, A only),
 *   verdict? (B only: the conclusion card), images[] (2–3 Pexels photos placed with <Photo n="1"/>),
 *   faq[] (3–5 questions, rendered after the body with FAQPage JSON-LD), cta? (end-of-page copy)
 *
 * Published articles (not drafts) must also pass the SEO gates: A pages 300–800 words, B pages
 * 1200–1500 words with at least three H2 sections; one sourced <DataPoint> per 200 words; every
 * photo placed exactly once; no writing notes or placeholders (TODO, TBD, FIXME, XXX, lorem,
 * "spec") and no CJK characters anywhere in an English page.
 *
 * Commit + push → the build renders the article, its category hub, the sitemap and llms.txt;
 * scripts/indexnow.mjs pings search engines. Drafts (`draft: true`) and posts dated in the
 * future never render publicly, never appear in a hub, the sitemap or llms.txt.
 *
 * Validation is strict on purpose: a typo in the frontmatter (`publishAt`), a category that
 * does not match the folder, an <Answer> longer than 60 words or a <DataPoint> without an
 * https source fails the build with every problem listed, instead of shipping a broken page.
 */

/** Articles per hub page (page 1 at /blog/<category>, later pages at /blog/<category>/page/<n>); the SEO base allows 15–20. */
export const PAGE_SIZE = 18;

/** Average adult reading speed used for "n min read". */
export const WORDS_PER_MINUTE = 230;

/** <Answer> blocks are the snippet-ready reply under an H2: at most this many words. */
export const ANSWER_MAX_WORDS = 60;

/** Word ranges per page level (SEO base: A = tool-first 300–800, B = decision article 1200–1500). */
export const LEVEL_WORDS = { A: [300, 800], B: [1200, 1500] } as const;

/** At least one sourced <DataPoint> per this many words. */
export const WORDS_PER_DATAPOINT = 200;

/** Markers that must never reach a published page (writing notes, placeholders). */
export const LEAK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(TODO|TBD|FIXME|XXX)\b/, label: "a TODO/TBD/FIXME/XXX marker" },
  { re: /\blorem\b/i, label: "lorem ipsum" },
  { re: /\bspec\b/i, label: 'the word "spec" (reserved as a leak marker; say "job description")' },
  { re: /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/, label: "CJK characters (English pages only)" },
  { re: /\[(待|placeholder|insert)/i, label: "a bracketed placeholder" },
];

/** Slugs that would collide with the hub's own routes (/blog/<category>/page/<n>). */
export const RESERVED_POST_SLUGS = ["page"] as const;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface PostHeading {
  id: string;
  text: string;
}

export interface PostImage {
  /** images.pexels.com URL without query (sizes are added at render). */
  src: string;
  alt: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  /** The photo's page on pexels.com. */
  pexelsUrl: string;
}

export interface PostFaq {
  q: string;
  a: string;
}

export interface PostVerdict {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface PostCta {
  title?: string;
  body?: string;
  /** Tool strip under an A page's tool. */
  toolHeadline?: string;
  toolNote?: string;
}

export interface Post {
  slug: string;
  category: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD). */
  publishedAt: string;
  /** ISO date (YYYY-MM-DD), never before publishedAt. */
  updatedAt: string;
  keywords: string[];
  featured: boolean;
  draft: boolean;
  level: "A" | "B";
  tool: string | null;
  verdict: PostVerdict | null;
  images: PostImage[];
  faq: PostFaq[];
  cta: PostCta | null;
  body: string;
  wordCount: number;
  readingMinutes: number;
  /** H2 headings with the ids rehype-slug gives them (table of contents). */
  headings: PostHeading[];
}

/* ------------------------------------------------------------------ frontmatter */

/** gray-matter turns unquoted YAML dates into Date objects; both spellings are accepted. */
const isoDate = z.preprocess(
  (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : v),
  z.string().regex(ISO_DATE_RE, "use a YYYY-MM-DD date"),
);

export const frontmatterSchema = z
  .object({
    title: z.string().trim().min(10, "at least 10 characters").max(110, "at most 110 characters"),
    description: z.string().trim().min(50, "at least 50 characters").max(200, "at most 200 characters"),
    publishedAt: isoDate,
    updatedAt: isoDate,
    category: z.string().trim().min(1),
    keywords: z.array(z.string().trim().min(2)).min(1, "list at least one keyword").max(8, "at most 8 keywords"),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    level: z.enum(["A", "B"]).default("B"),
    tool: z.string().regex(SLUG_RE, "tool: a content/tools/<id>.json id").optional(),
    verdict: z
      .object({ title: z.string().trim().min(10).max(120), body: z.string().trim().min(40).max(600), ctaLabel: z.string().trim().min(2).max(60).optional(), ctaHref: z.string().regex(/^\/[^\s]*$/, "a site path").optional() })
      .strict()
      .optional(),
    images: z
      .array(
        z
          .object({
            src: z.string().regex(/^https:\/\/images\.pexels\.com\/photos\/\d+\/[^?\s]+$/, "an images.pexels.com photo URL without a query"),
            alt: z.string().trim().min(8).max(160),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            photographer: z.string().trim().min(1),
            photographerUrl: z.string().regex(/^https:\/\//),
            pexelsUrl: z.string().regex(/^https:\/\/www\.pexels\.com\/photo\//),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    faq: z.array(z.object({ q: z.string().trim().min(8).max(160), a: z.string().trim().min(20).max(700) }).strict()).max(5).default([]),
    cta: z.object({ title: z.string().trim().min(8).max(90).optional(), body: z.string().trim().min(20).max(300).optional(), toolHeadline: z.string().trim().min(8).max(120).optional(), toolNote: z.string().trim().min(8).max(200).optional() }).strict().optional(),
  })
  .strict();

export type Frontmatter = z.infer<typeof frontmatterSchema>;

export type ParseResult = { ok: true; post: Post } | { ok: false; errors: string[] };

/* ------------------------------------------------------------------ body helpers */

/** Strips fenced code so checks and counts only see prose and components. */
function withoutCode(body: string): string {
  return body.replace(/^(```|~~~)[\s\S]*?^\1/gm, " ");
}

/** H2 headings (outside code fences) with GitHub-style ids: the ids rehype-slug assigns. */
export function extractHeadings(body: string): PostHeading[] {
  const slugger = new GithubSlugger();
  const out: PostHeading[] = [];
  let inFence = false;
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      const text = m[1].replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
      out.push({ id: slugger.slug(text), text });
    }
  }
  return out;
}

/**
 * Words the reader sees: import/export lines, fenced code, JSX tags (not their text
 * content), expressions and markdown punctuation are removed first; then tokens with at
 * least one letter or digit are counted.
 */
export function countWords(body: string): number {
  const text = withoutCode(body)
    .replace(/^(import|export)\s[^\n]*$/gm, " ")
    .replace(/<[A-Za-z][^>]*?\/>/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Problems in an article body: long <Answer>s, unsourced <DataPoint>s, a second H1. */
export function validateBody(body: string): string[] {
  const problems: string[] = [];
  const prose = withoutCode(body);

  for (const m of prose.matchAll(/<Answer(?:\s[^>]*)?>([\s\S]*?)<\/Answer>/g)) {
    const words = countWords(m[1]);
    if (words > ANSWER_MAX_WORDS) problems.push(`an <Answer> has ${words} words; keep it to ${ANSWER_MAX_WORDS} or fewer`);
    if (words === 0) problems.push("an <Answer> is empty");
  }
  if (/<Answer\s*\/>/.test(prose)) problems.push("an <Answer> is empty");

  for (const m of prose.matchAll(/<DataPoint\b([^>]*)>/g)) {
    const attrs = m[1];
    const source = /\bsource\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? null;
    if (!source) problems.push("a <DataPoint> has no source=\"https://…\" attribute");
    else if (!/^https:\/\/[^\s/]+\.[^\s]+/.test(source)) problems.push(`a <DataPoint> source is not an https URL: ${source}`);
  }

  for (const line of prose.split("\n")) {
    if (/^#\s+\S/.test(line)) {
      problems.push("the body has an H1 (# …); the title is the only H1, start sections at ##");
      break;
    }
  }
  return problems;
}

/** The SEO publishing gates for a non-draft article (pure; exported for tests). */
export function publishGates(fm: Frontmatter, body: string, words: number, headings: PostHeading[], toolExists: (id: string) => boolean): string[] {
  const problems: string[] = [];
  const [lo, hi] = LEVEL_WORDS[fm.level];
  if (words < lo || words > hi) problems.push(`level ${fm.level} needs ${lo}–${hi} words; the body has ${words}`);
  if (fm.level === "A") {
    if (!fm.tool) problems.push("level A needs a tool (content/tools/<id>.json)");
    else if (!toolExists(fm.tool)) problems.push(`tool "${fm.tool}" has no content/tools/${fm.tool}.json`);
  }
  if (fm.level === "B") {
    if (!fm.verdict) problems.push("level B needs a verdict (the conclusion card)");
    if (headings.length < 3) problems.push("level B needs at least three H2 sections (table of contents)");
    if (fm.tool) problems.push("a tool belongs on level A pages");
  }
  if (fm.images.length < 2) problems.push(`needs 2–3 photos; has ${fm.images.length}`);
  if (fm.faq.length < 3) problems.push(`needs 3–5 FAQ entries; has ${fm.faq.length}`);
  const prose = withoutCode(body);
  const dataPoints = [...prose.matchAll(/<DataPoint\b/g)].length;
  const need = Math.floor(words / WORDS_PER_DATAPOINT);
  if (dataPoints < need) problems.push(`needs at least ${need} sourced <DataPoint>s (one per ${WORDS_PER_DATAPOINT} words); has ${dataPoints}`);
  fm.images.forEach((_, i) => {
    const n = [...prose.matchAll(new RegExp(`<Photo\\s+n="${i + 1}"\\s*/>`, "g"))].length;
    if (n !== 1) problems.push(`photo ${i + 1} must be placed exactly once with <Photo n="${i + 1}" /> (found ${n})`);
  });
  if (/<Photo\s+n="([4-9]|\d{2,})"/.test(prose)) problems.push("a <Photo> refers to a photo that is not in the frontmatter");
  const text = [fm.title, fm.description, ...fm.keywords, fm.verdict?.title ?? "", fm.verdict?.body ?? "", ...fm.images.map((i) => i.alt), ...fm.faq.flatMap((f) => [f.q, f.a]), fm.cta?.title ?? "", fm.cta?.body ?? "", fm.cta?.toolHeadline ?? "", fm.cta?.toolNote ?? "", body].join("\n");
  for (const { re, label } of LEAK_PATTERNS) if (re.test(text)) problems.push(`contains ${label}`);
  return problems;
}

/* ------------------------------------------------------------------ parsing */

function zodProblems(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const where = i.path.length ? i.path.join(".") : "frontmatter";
    if (i.code === "unrecognized_keys") return `unknown field(s): ${i.keys.join(", ")}`;
    return `${where}: ${i.message}`;
  });
}

/** One article file → Post, or the list of problems with it (exported for tests). */
export function parsePost(category: string, slug: string, raw: string, toolExists: (id: string) => boolean = () => true): ParseResult {
  const errors: string[] = [];
  if (!SLUG_RE.test(slug)) errors.push(`file name "${slug}" must be lower-case letters, digits and hyphens`);
  if ((RESERVED_POST_SLUGS as readonly string[]).includes(slug)) errors.push(`"${slug}" is reserved by the hub's pagination; pick another slug`);
  if (!categoryBySlug(category)) errors.push(`folder "${category}" is not a category in src/content/categories.ts`);

  let parsed: { data: Record<string, unknown>; content: string };
  try {
    const m = matter(raw);
    parsed = { data: m.data as Record<string, unknown>, content: m.content };
  } catch (err) {
    return { ok: false, errors: [...errors, `frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const fm = frontmatterSchema.safeParse(parsed.data);
  if (!fm.success) errors.push(...zodProblems(fm.error));
  else {
    if (fm.data.category !== category) errors.push(`category "${fm.data.category}" does not match its folder "${category}"`);
    if (fm.data.updatedAt < fm.data.publishedAt) errors.push(`updatedAt (${fm.data.updatedAt}) is before publishedAt (${fm.data.publishedAt})`);
  }
  errors.push(...validateBody(parsed.content));
  if (!parsed.content.trim()) errors.push("the article has no body");

  if (errors.length || !fm.success) return { ok: false, errors };

  const words = countWords(parsed.content);
  const headings = extractHeadings(parsed.content);
  if (!fm.data.draft) errors.push(...publishGates(fm.data, parsed.content, words, headings, toolExists));
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    post: {
      slug,
      category,
      title: fm.data.title,
      description: fm.data.description,
      publishedAt: fm.data.publishedAt,
      updatedAt: fm.data.updatedAt,
      keywords: fm.data.keywords,
      featured: fm.data.featured,
      draft: fm.data.draft,
      level: fm.data.level,
      tool: fm.data.tool ?? null,
      verdict: fm.data.verdict ?? null,
      images: fm.data.images,
      faq: fm.data.faq,
      cta: fm.data.cta ?? null,
      body: parsed.content,
      wordCount: words,
      readingMinutes: readingMinutes(words),
      headings,
    },
  };
}

/** Newest first; ties broken by slug so the order is stable across builds. */
export function sortPosts<T extends Pick<Post, "publishedAt" | "slug">>(posts: T[]): T[] {
  return [...posts].sort((a, b) => (a.publishedAt === b.publishedAt ? a.slug.localeCompare(b.slug) : a.publishedAt < b.publishedAt ? 1 : -1));
}

/* ------------------------------------------------------------------ loading */

const ROOT = path.join(process.cwd(), "content", "blog");
const TOOLS = path.join(process.cwd(), "content", "tools");
const toolFileExists = (id: string) => fs.existsSync(path.join(TOOLS, `${id}.json`));
let cache: Post[] | null = null;

/** Reads every article once per process (at build for static pages, per cold start otherwise). */
function load(): Post[] {
  // Cached for the life of a production process; re-read in development so new or edited files show up on refresh.
  if (cache && process.env.NODE_ENV === "production") return cache;
  const posts: Post[] = [];
  const problems: string[] = [];
  if (fs.existsSync(ROOT)) {
    for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const file of fs.readdirSync(path.join(ROOT, dir.name))) {
        // Notes and scratch files (README.md, _ideas.md, .DS_Store) are not articles.
        if (!file.endsWith(".mdx") || file.startsWith("_") || file.startsWith(".")) continue;
        const slug = file.slice(0, -4);
        const raw = fs.readFileSync(path.join(ROOT, dir.name, file), "utf8");
        const result = parsePost(dir.name, slug, raw, toolFileExists);
        if (result.ok) posts.push(result.post);
        else problems.push(...result.errors.map((e) => `content/blog/${dir.name}/${file}: ${e}`));
      }
    }
  }
  if (problems.length) throw new Error(`Blog content has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  cache = sortPosts(posts);
  return cache;
}

/** Today in UTC as YYYY-MM-DD (publication dates are calendar dates, not instants). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Public = not a draft and not dated in the future. */
export function isLive(p: Pick<Post, "draft" | "publishedAt">, today: string = todayIso()): boolean {
  return !p.draft && p.publishedAt <= today;
}

/** Live posts from a list (pure; the loaders below apply it to the content folder). */
export function livePosts<T extends Pick<Post, "draft" | "publishedAt">>(posts: T[], today: string = todayIso()): T[] {
  return posts.filter((p) => isLive(p, today));
}

/** Public articles, newest first. */
export function publishedPosts(): Post[] {
  return livePosts(load());
}

export function postsInCategory(category: string): Post[] {
  return publishedPosts().filter((p) => p.category === category);
}

export function getPost(category: string, slug: string): Post | null {
  return publishedPosts().find((p) => p.category === category && p.slug === slug) ?? null;
}

export function postUrl(post: Pick<Post, "category" | "slug">): string {
  return `/blog/${post.category}/${post.slug}`;
}

/* ------------------------------------------------------------------ pagination */

export interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** Pages a list of `total` items needs (at least 1, so an empty hub still has its page 1). */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** One page of a list, or null when `page` is not a page of it (page 1 always exists). */
export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): PageSlice<T> | null {
  const totalPages = pageCount(items.length, size);
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;
  return { items: items.slice((page - 1) * size, page * size), page, totalPages, total: items.length };
}

/** Hub URL of page `n` of a category: page 1 is the hub itself. */
export function categoryPageUrl(category: string, n: number): string {
  return n <= 1 ? `/blog/${category}` : `/blog/${category}/page/${n}`;
}

/* ------------------------------------------------------------------ hubs and related */

export interface CategoryWithCount extends Category {
  count: number;
  /** updatedAt of its newest live article (real lastmod for the sitemap). */
  lastmod: string | null;
}

export function categoriesWithCounts(posts: Post[] = publishedPosts()): CategoryWithCount[] {
  return CATEGORIES.map((c) => {
    const inCat = posts.filter((p) => p.category === c.slug);
    const lastmod = inCat.reduce<string | null>((m, p) => (m === null || p.updatedAt > m ? p.updatedAt : m), null);
    return { ...c, count: inCat.length, lastmod };
  });
}

/** Same category first, then shared keywords; never the post itself. */
export function relatedPosts(post: Pick<Post, "category" | "slug" | "keywords">, n = 3, posts: Post[] = publishedPosts()): Post[] {
  const kw = new Set(post.keywords.map((k) => k.toLowerCase()));
  return posts
    .filter((p) => !(p.category === post.category && p.slug === post.slug))
    .map((p) => {
      let score = p.category === post.category ? 3 : 0;
      for (const k of p.keywords) if (kw.has(k.toLowerCase())) score += 2;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.p);
}

/** Calendar date as readers see it: "21 October 2026". */
export function formatPostDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
