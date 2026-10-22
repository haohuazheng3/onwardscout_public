import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryBySlug } from "@/content/categories";
import { AUTOLINK_MAX, blogTerms, careerTerms, opportunityTypeTerms, rehypeAutolink, type HastNode } from "@/lib/autolink";
import {
  ANSWER_MAX_WORDS,
  PAGE_SIZE,
  categoryPageUrl,
  countWords,
  extractHeadings,
  isLive,
  livePosts,
  pageCount,
  paginate,
  parsePost,
  readingMinutes,
  relatedPosts,
  sortPosts,
  validateBody,
  publishGates,
  frontmatterSchema,
  type Post,
} from "@/lib/blog";

function fm(over: Record<string, string> = {}, body = "Intro paragraph.\n\n## First section\n\nText.") {
  const fields: Record<string, string> = {
    title: '"How to write a short answer that reviewers remember"',
    description: '"What reviewers look for in a 150-word answer, how to cut a draft to size and what to leave out entirely."',
    publishedAt: "2026-10-01",
    updatedAt: "2026-10-05",
    category: "applications-that-win",
    keywords: '["short answers", "application questions"]',
    ...over,
  };
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== "__omit__")
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

function post(over: Partial<Post> = {}): Post {
  return {
    slug: "a",
    category: "careers-and-jobs",
    title: "A title long enough",
    description: "d",
    publishedAt: "2026-10-01",
    updatedAt: "2026-10-01",
    keywords: [],
    featured: false,
    draft: false,
    level: "B",
    tool: null,
    verdict: null,
    images: [],
    faq: [],
    cta: null,
    body: "",
    wordCount: 0,
    readingMinutes: 1,
    headings: [],
    ...over,
  };
}

describe("categories", () => {
  it("has unique, URL-safe slugs with complete copy", () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of CATEGORIES) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.title.length).toBeGreaterThan(10);
      expect(c.description.length).toBeGreaterThanOrEqual(50);
      expect(c.description.length).toBeLessThanOrEqual(200);
      expect(c.intro.length).toBeGreaterThan(80);
    }
    expect(categoryBySlug("applications-that-win")?.name).toBe("Applications that win");
    expect(categoryBySlug("nope")).toBeNull();
  });
});

describe("frontmatter validation", () => {
  it("accepts a valid article and derives reading time and headings", () => {
    const r = parsePost("applications-that-win", "short-answers", fm({ draft: "true" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.post.title).toBe("How to write a short answer that reviewers remember");
    expect(r.post.publishedAt).toBe("2026-10-01");
    expect(r.post.updatedAt).toBe("2026-10-05");
    expect(r.post.draft).toBe(true);
    expect(r.post.level).toBe("B");
    expect(r.post.featured).toBe(false);
    expect(r.post.readingMinutes).toBe(1);
    expect(r.post.headings).toEqual([{ id: "first-section", text: "First section" }]);
  });

  it("accepts unquoted YAML dates (parsed as Date objects)", () => {
    const r = parsePost("applications-that-win", "dates", fm({ publishedAt: "2026-09-30", updatedAt: "2026-09-30", draft: "true" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.post.publishedAt).toBe("2026-09-30");
  });

  it("rejects unknown fields (typos never ship silently)", () => {
    const r = parsePost("applications-that-win", "typo", fm({ publishAt: "2026-10-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown field\(s\): publishAt/);
  });

  it("requires the category to match the folder and the folder to be a category", () => {
    const wrong = parsePost("applications-that-win", "x-post", fm({ category: "careers-and-jobs" }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.join(" ")).toMatch(/does not match its folder/);
    const unknown = parsePost("not-a-category", "x-post", fm({ category: "not-a-category" }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.join(" ")).toMatch(/not a category/);
  });

  it("rejects missing or malformed required fields", () => {
    for (const [field, value] of [
      ["title", "__omit__"],
      ["title", '"Short"'],
      ["description", '"Too short."'],
      ["publishedAt", '"21 Oct 2026"'],
      ["keywords", "[]"],
      ["draft", '"yes"'],
    ] as const) {
      const r = parsePost("applications-that-win", "bad-field", fm({ [field]: value }));
      expect(r.ok, `${field}=${value}`).toBe(false);
    }
  });

  it("rejects updatedAt before publishedAt", () => {
    const r = parsePost("applications-that-win", "dates-backwards", fm({ updatedAt: "2026-09-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/before publishedAt/);
  });

  it("rejects bad and reserved slugs", () => {
    expect(parsePost("applications-that-win", "Bad_Slug", fm()).ok).toBe(false);
    const reserved = parsePost("applications-that-win", "page", fm());
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.errors.join(" ")).toMatch(/reserved/);
  });

  it("checks the body: Answer length, DataPoint sources, no H1", () => {
    const long = Array.from({ length: ANSWER_MAX_WORDS + 5 }, (_, i) => `word${i}`).join(" ");
    expect(validateBody(`## Q\n\n<Answer>\n${long}\n</Answer>`)[0]).toMatch(/keep it to 60/);
    expect(validateBody("## Q\n\n<Answer>\nA short, direct answer.\n</Answer>")).toEqual([]);
    expect(validateBody('<DataPoint value="5">things</DataPoint>')[0]).toMatch(/no source/);
    expect(validateBody('<DataPoint source="http://example.org/x">things</DataPoint>')[0]).toMatch(/not an https URL/);
    expect(validateBody('<DataPoint value="5" source="https://example.org/x" label="Ex">things</DataPoint>')).toEqual([]);
    expect(validateBody("# A second title\n\nText")[0]).toMatch(/H1/);
    // Code fences are examples, not content.
    expect(validateBody("```mdx\n# not a heading\n<DataPoint>x</DataPoint>\n```")).toEqual([]);
  });

  it("counts only words a reader sees", () => {
    expect(countWords("Hello world. <Callout title=\"x\">Three more words</Callout>")).toBe(5);
    expect(countWords("```js\nconst a = 1;\n```\nTwo words")).toBe(2);
    expect(countWords("[a link](https://example.org) here")).toBe(3);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(230 * 4)).toBe(4);
  });

  it("gives duplicate headings the ids rehype-slug gives them", () => {
    expect(extractHeadings("## Why apply\n\ntext\n\n## Why apply\n\n```\n## not this\n```\n## **Bold** `code`")).toEqual([
      { id: "why-apply", text: "Why apply" },
      { id: "why-apply-1", text: "Why apply" },
      { id: "bold-code", text: "Bold code" },
    ]);
  });
});

describe("drafts and scheduled posts", () => {
  it("hides drafts and future-dated posts", () => {
    const today = "2026-10-21";
    expect(isLive({ draft: false, publishedAt: "2026-10-21" }, today)).toBe(true);
    expect(isLive({ draft: false, publishedAt: "2026-10-22" }, today)).toBe(false);
    expect(isLive({ draft: true, publishedAt: "2026-01-01" }, today)).toBe(false);
    const posts = [post({ slug: "live" }), post({ slug: "draft", draft: true }), post({ slug: "later", publishedAt: "2027-01-01" })];
    expect(livePosts(posts, today).map((p) => p.slug)).toEqual(["live"]);
  });

  it("keeps the article template in the repository as a valid draft", () => {
    const file = path.join(process.cwd(), "content", "blog", "applications-that-win", "article-template.mdx");
    const r = parsePost("applications-that-win", "article-template", fs.readFileSync(file, "utf8"));
    expect(r.ok, r.ok ? "" : r.errors.join("\n")).toBe(true);
    if (r.ok) {
      expect(r.post.draft).toBe(true);
      expect(isLive(r.post)).toBe(false);
    }
  });

  it("every article in content/blog passes validation", () => {
    const root = path.join(process.cwd(), "content", "blog");
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(root, dir.name))) {
        if (!f.endsWith(".mdx") || f.startsWith("_")) continue;
        const r = parsePost(dir.name, f.slice(0, -4), fs.readFileSync(path.join(root, dir.name, f), "utf8"));
        expect(r.ok, `${dir.name}/${f}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
      }
    }
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 40 }, (_, i) => i);

  it("splits into pages of PAGE_SIZE (15–20 per hub page)", () => {
    expect(PAGE_SIZE).toBe(18);
    expect(pageCount(40)).toBe(3);
    expect(pageCount(36)).toBe(2);
    expect(pageCount(0)).toBe(1);
    expect(paginate(items, 1)?.items).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(paginate(items, 3)?.items).toEqual([36, 37, 38, 39]);
    expect(paginate(items, 3)?.totalPages).toBe(3);
  });

  it("returns null for pages that don't exist; an empty hub still has page 1", () => {
    expect(paginate(items, 4)).toBeNull();
    expect(paginate(items, 0)).toBeNull();
    expect(paginate(items, 1.5)).toBeNull();
    expect(paginate([], 1)).toEqual({ items: [], page: 1, totalPages: 1, total: 0 });
    expect(paginate([], 2)).toBeNull();
  });

  it("puts page 1 at the hub URL and later pages under /page/<n>", () => {
    expect(categoryPageUrl("careers-and-jobs", 1)).toBe("/blog/careers-and-jobs");
    expect(categoryPageUrl("careers-and-jobs", 3)).toBe("/blog/careers-and-jobs/page/3");
  });

  it("sorts newest first with a stable tie-break", () => {
    const sorted = sortPosts([post({ slug: "b", publishedAt: "2026-01-01" }), post({ slug: "a", publishedAt: "2026-01-01" }), post({ slug: "c", publishedAt: "2026-05-01" })]);
    expect(sorted.map((p) => p.slug)).toEqual(["c", "a", "b"]);
  });

  it("relates posts by category and keywords, never itself", () => {
    const me = post({ slug: "me", category: "careers-and-jobs", keywords: ["referrals"] });
    const all = [me, post({ slug: "same-cat" }), post({ slug: "kw", category: "academic-life", keywords: ["Referrals"] }), post({ slug: "none", category: "creative-careers" })];
    expect(relatedPosts(me, 3, all).map((p) => p.slug)).toEqual(["same-cat", "kw"]);
  });
});

/* ------------------------------------------------------------------ autolink */

function paragraph(...children: HastNode[]): HastNode {
  return { type: "element", tagName: "p", children };
}
const text = (value: string): HastNode => ({ type: "text", value });

function links(tree: HastNode): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const walk = (n: HastNode) => {
    if (n.type === "element" && (n as { tagName: string }).tagName === "a") {
      const el = n as { properties?: Record<string, unknown>; children: HastNode[] };
      out.push({ href: String(el.properties?.href), text: (el.children[0] as { value: string }).value });
    }
    for (const c of (n as { children?: HastNode[] }).children ?? []) walk(c);
  };
  walk(tree);
  return out;
}

describe("autolink", () => {
  const terms = [
    { phrase: "fellowships", href: "/opportunities/fellowships" },
    { phrase: "Software Engineer", href: "/careers/software-engineer" },
    { phrase: "grants", href: "/opportunities/grants" },
  ];

  it("links the first occurrence of each phrase, case-insensitively, on word boundaries", () => {
    const tree: HastNode = { type: "root", children: [paragraph(text("Fellowships and grants. More fellowships; regrants stay plain."))] };
    rehypeAutolink({ terms })(tree);
    expect(links(tree)).toEqual([
      { href: "/opportunities/fellowships", text: "Fellowships" },
      { href: "/opportunities/grants", text: "grants" },
    ]);
  });

  it("never nests anchors or links inside headings, code or DataPoint", () => {
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "h2", children: [text("Grants for a Software Engineer")] },
        paragraph({ type: "element", tagName: "a", properties: { href: "/x" }, children: [text("grants here")] }),
        paragraph({ type: "element", tagName: "code", children: [text("grants")] }),
        { type: "mdxJsxTextElement", name: "DataPoint", children: [text("grants rose")] },
      ],
    };
    rehypeAutolink({ terms })(tree);
    expect(links(tree)).toEqual([{ href: "/x", text: "grants here" }]);
  });

  it("skips the page itself and stops at the maximum", () => {
    const self: HastNode = { type: "root", children: [paragraph(text("grants and fellowships"))] };
    rehypeAutolink({ terms, self: "/opportunities/grants" })(self);
    expect(links(self).map((l) => l.href)).toEqual(["/opportunities/fellowships"]);

    const many = Array.from({ length: 8 }, (_, i) => ({ phrase: `phrase${i}`, href: `/p/${i}` }));
    const tree: HastNode = { type: "root", children: [paragraph(text(many.map((m) => m.phrase).join(" ")))] };
    rehypeAutolink({ terms: many })(tree);
    expect(links(tree)).toHaveLength(AUTOLINK_MAX);
  });

  it("builds phrases only for the hubs and careers it is given, skipping generic and short labels", () => {
    const types = opportunityTypeTerms(["fellowships", "events", "jobs"]);
    expect(types.map((t) => t.href)).toContain("/opportunities/fellowships");
    // Bare "event"/"events" are too generic to link; the specific label is fine.
    expect(types.filter((t) => t.href === "/opportunities/events").map((t) => t.phrase.toLowerCase())).not.toContain("events");
    expect(types.filter((t) => t.href === "/opportunities/events").every((t) => t.phrase.length > 6)).toBe(true);
    expect(types.some((t) => t.href === "/opportunities/jobs")).toBe(false); // not a public SEO type
    const careers = careerTerms(["software-engineer", "chef", "not-a-code"]);
    expect(careers).toEqual([{ phrase: "Software Engineer", href: "/careers/software-engineer" }]);
    const blog = blogTerms([{ category: "careers-and-jobs", slug: "x", keywords: ["referral emails", "cv"] }], [{ slug: "academic-life", name: "Academic life", count: 1 }, { slug: "creative-careers", name: "Creative careers", count: 0 }]);
    expect(blog).toEqual([
      { phrase: "referral emails", href: "/blog/careers-and-jobs/x" },
      { phrase: "Academic life", href: "/blog/academic-life" },
    ]);
  });
});

describe("SEO publishing gates", () => {
  const img = (n: number) => ({ src: `https://images.pexels.com/photos/${n}/pexels-photo-${n}.jpeg`, alt: "A person writing at a desk", width: 4000, height: 2667, photographer: "Jane Doe", photographerUrl: "https://www.pexels.com/@jane", pexelsUrl: `https://www.pexels.com/photo/${n}/` });
  const faq = [1, 2, 3].map((i) => ({ q: `Question number ${i}?`, a: "A complete answer that is long enough to pass." }));
  const base = (over: Record<string, unknown> = {}) =>
    frontmatterSchema.parse({ title: "A title long enough to pass", description: "A description that is long enough to pass the fifty character minimum.", publishedAt: "2026-10-22", updatedAt: "2026-10-22", category: "careers-and-jobs", keywords: ["x y"], level: "A", tool: "t", images: [img(1), img(2)], faq, ...over });
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  const dp = (k: number) => Array.from({ length: k }, () => '<DataPoint value="1" source="https://example.org/a">x</DataPoint>').join(" ");
  const body = (n: number, k: number) => `${words(n)} ${dp(k)}\n\n<Photo n="1" />\n\n<Photo n="2" />`;

  it("passes a complete A page", () => {
    const b = body(400, 2);
    expect(publishGates(base(), b, countWords(b), [], () => true)).toEqual([]);
  });
  it("enforces word ranges, the tool, photos, FAQ and data density", () => {
    const b = `${words(100)}`;
    const p = publishGates(base({ images: [img(1)], faq: faq.slice(0, 2) }), b, countWords(b), [], () => false);
    expect(p.join(" | ")).toMatch(/300–800 words/);
    expect(p.join(" | ")).toMatch(/has no content\/tools\/t\.json/);
    expect(p.join(" | ")).toMatch(/2–3 photos/);
    expect(p.join(" | ")).toMatch(/3–5 FAQ/);
    const b2 = body(600, 1);
    expect(publishGates(base(), b2, countWords(b2), [], () => true).join(" | ")).toMatch(/at least 3 sourced <DataPoint>s/);
  });
  it("needs a verdict and three sections on B pages", () => {
    const b = body(1300, 7);
    const p = publishGates(base({ level: "B", tool: undefined }), b, countWords(b), [], () => true);
    expect(p.join(" | ")).toMatch(/needs a verdict/);
    expect(p.join(" | ")).toMatch(/three H2/);
  });
  it("blocks leaked notes, placeholders and CJK text", () => {
    for (const leak of ["TODO: add a source", "see the spec", "lorem ipsum", "备注", "[insert link]"]) {
      const b = `${body(400, 2)} ${leak}`;
      expect(publishGates(base(), b, countWords(b), [], () => true).some((x) => x.startsWith("contains"))).toBe(true);
    }
  });
  it("requires every photo to be placed exactly once", () => {
    const b = `${words(400)} ${dp(2)}\n\n<Photo n="1" />`;
    expect(publishGates(base(), b, countWords(b), [], () => true).join(" | ")).toMatch(/photo 2 must be placed/);
  });
});
