import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { LEAK_PATTERNS, WORDS_PER_DATAPOINT, countWords, validateBody, type PostFaq } from "@/lib/blog";
import { isCategorySlug } from "@/content/categories";

/*
 * Pillar copy for blog category hubs: content/hubs/<category>.mdx. Frontmatter lists the hub's
 * validated target keywords and 3–5 FAQ entries; the body is a short framework (answer-first
 * H2 sections with sourced numbers) rendered on page 1 of the hub under the article list.
 * The same leak and sourcing gates as articles apply; a bad file fails the build.
 */

export interface Hub {
  category: string;
  keywords: string[];
  faq: PostFaq[];
  body: string;
  wordCount: number;
}

const schema = z
  .object({
    keywords: z.array(z.string().trim().min(3)).min(1).max(6),
    faq: z.array(z.object({ q: z.string().trim().min(8).max(160), a: z.string().trim().min(20).max(700) }).strict()).min(3).max(5),
  })
  .strict();

const DIR = path.join(process.cwd(), "content", "hubs");
let cache: Map<string, Hub> | null = null;

export function parseHub(category: string, raw: string): { ok: true; hub: Hub } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isCategorySlug(category)) errors.push(`"${category}" is not a blog category`);
  const m = matter(raw);
  const fm = schema.safeParse(m.data);
  if (!fm.success) errors.push(...fm.error.issues.map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`));
  errors.push(...validateBody(m.content));
  const words = countWords(m.content);
  if (words < 250 || words > 900) errors.push(`a hub framework needs 250–900 words; has ${words}`);
  const dataPoints = [...m.content.matchAll(/<DataPoint\b/g)].length;
  if (dataPoints < Math.floor(words / WORDS_PER_DATAPOINT)) errors.push(`needs at least ${Math.floor(words / WORDS_PER_DATAPOINT)} sourced <DataPoint>s; has ${dataPoints}`);
  const text = [m.content, ...(fm.success ? fm.data.faq.flatMap((f) => [f.q, f.a]) : [])].join("\n");
  for (const { re, label } of LEAK_PATTERNS) if (re.test(text)) errors.push(`contains ${label}`);
  if (errors.length || !fm.success) return { ok: false, errors };
  return { ok: true, hub: { category, keywords: fm.data.keywords, faq: fm.data.faq, body: m.content, wordCount: words } };
}

function load(): Map<string, Hub> {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const out = new Map<string, Hub>();
  const problems: string[] = [];
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith(".mdx") || f.startsWith("_") || f.startsWith(".")) continue;
      const slug = f.slice(0, -4);
      const r = parseHub(slug, fs.readFileSync(path.join(DIR, f), "utf8"));
      if (r.ok) out.set(slug, r.hub);
      else problems.push(...r.errors.map((e) => `content/hubs/${f}: ${e}`));
    }
  }
  if (problems.length) throw new Error(`Hub content has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  cache = out;
  return out;
}

export function getHub(category: string): Hub | null {
  return load().get(category) ?? null;
}
