/*
 * Automatic internal links for article bodies: a rehype plugin (pure, unit-testable) plus the
 * builders for the phrase list. The first occurrence of each known phrase in running text
 * becomes a link to its opportunity hub, career page, article or blog hub.
 *
 * Never nests anchors: text inside <a>, headings, code, figure captions, buttons and the MDX
 * components that render their own link (<DataPoint>, <Link>) is left alone. Never links a
 * page to itself; one link per phrase and per destination; at most `max` links per article.
 */
import { getOccupation } from "./core/occupations";
import { OPPORTUNITY_TYPES } from "./core/opportunity-types";

export type HastText = { type: "text"; value: string };
export type HastElement = { type: "element"; tagName: string; properties?: Record<string, unknown>; children: HastNode[] };
export type HastNode = HastText | HastElement | { type: string; name?: string | null; children?: HastNode[]; value?: string };

export interface AutolinkTerm {
  phrase: string;
  href: string;
}

export interface AutolinkOptions {
  terms: AutolinkTerm[];
  /** URL path of the page being rendered: links back to it are skipped. */
  self?: string;
  /** Upper bound on links added to one article (default 5). */
  max?: number;
}

export const AUTOLINK_MAX = 5;

const SKIP_TAGS = new Set(["a", "h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "figcaption", "button", "summary", "kbd"]);
/** MDX components whose output already contains a link: a second <a> inside them would nest anchors. */
const SKIP_JSX = new Set(["DataPoint", "Link", "a"]);

function isSkippedNode(node: HastNode): boolean {
  if (node.type === "element") return SKIP_TAGS.has((node as HastElement).tagName);
  if (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") {
    const name = (node as { name?: string | null }).name;
    return typeof name === "string" && SKIP_JSX.has(name);
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasChildren(node: HastNode): node is HastElement | { type: string; children: HastNode[] } {
  return Array.isArray((node as { children?: unknown }).children);
}

export function rehypeAutolink(options: AutolinkOptions) {
  const max = options.max ?? AUTOLINK_MAX;
  const seen = new Set<string>();
  const terms = options.terms
    .filter((t) => t.phrase.trim().length > 0 && t.href !== options.self)
    .filter((t) => {
      const key = t.phrase.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((t) => ({ ...t, re: new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(t.phrase)})(?![\\p{L}\\p{N}])`, "iu") }));

  return (tree: HastNode) => {
    const usedHref = new Set<string>();
    const usedPhrase = new Set<string>();
    let added = 0;

    const walk = (node: HastNode, inSkip: boolean) => {
      if (added >= max || !hasChildren(node)) return;
      const skip = inSkip || isSkippedNode(node);
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        if (added >= max) return;
        const child = children[i];
        if (child.type !== "text") {
          walk(child, skip);
          continue;
        }
        if (skip) continue;
        const text = (child as HastText).value;
        for (const t of terms) {
          const key = t.phrase.toLowerCase();
          if (usedHref.has(t.href) || usedPhrase.has(key)) continue;
          const m = t.re.exec(text);
          if (!m) continue;
          const start = m.index + m[1].length;
          const matched = m[2];
          const before = text.slice(0, start);
          const after = text.slice(start + matched.length);
          const link: HastElement = {
            type: "element",
            tagName: "a",
            properties: { href: t.href, dataAutolink: "true" },
            children: [{ type: "text", value: matched }],
          };
          const replacement: HastNode[] = [];
          if (before) replacement.push({ type: "text", value: before });
          replacement.push(link);
          if (after) replacement.push({ type: "text", value: after });
          children.splice(i, 1, ...replacement);
          // Rescan the text before the link (a shorter phrase may sit there); the link itself is
          // skipped as an <a>; the text after it is scanned in turn. Step back so i++ lands on `before`.
          if (before) i -= 1;
          usedHref.add(t.href);
          usedPhrase.add(key);
          added++;
          break;
        }
      }
    };

    walk(tree, false);
  };
}

/* ------------------------------------------------------------------ phrase builders */

/** Labels too generic to link from running text ("an event", "this course"). */
const GENERIC_PHRASES = new Set([
  "event",
  "events",
  "course",
  "courses",
  "community",
  "communities",
  "journal",
  "journals",
  "award",
  "residency",
  "loan",
  "speaking slot",
  "open call",
]);

/**
 * Opportunity hubs (`/opportunities/<slug>`), by singular and plural English label. Pass only
 * the hubs that are indexable (enough live listings): an article should not send readers and
 * crawlers to a thin page.
 */
export function opportunityTypeTerms(typeSlugs: Iterable<string>): AutolinkTerm[] {
  const wanted = new Set(typeSlugs);
  const out: AutolinkTerm[] = [];
  for (const t of OPPORTUNITY_TYPES) {
    if (!t.publicSeo || !wanted.has(t.slug)) continue;
    const href = `/opportunities/${t.slug}`;
    for (const phrase of [t.plural.en, t.label.en]) {
      const p = phrase.trim();
      if (p.length < 6 || GENERIC_PHRASES.has(p.toLowerCase())) continue;
      out.push({ phrase: p, href });
    }
  }
  return out;
}

/** Career pages (`/careers/<code>`) by English title; short one-word titles are skipped. */
export function careerTerms(codes: Iterable<string>): AutolinkTerm[] {
  const out: AutolinkTerm[] = [];
  for (const code of codes) {
    let label: string;
    try {
      label = getOccupation(code).label.en;
    } catch {
      continue;
    }
    // "Nurse", "Chef": too short to link without false hits; "Software Engineer" is fine.
    if (label.length < 8 || /[()/]/.test(label)) continue;
    out.push({ phrase: label, href: `/careers/${code}` });
  }
  return out;
}

/** Other articles (by their first three keywords of ≥ 8 characters) and non-empty blog hubs. */
export function blogTerms(
  posts: { category: string; slug: string; keywords: string[] }[],
  categories: { slug: string; name: string; count: number }[],
): AutolinkTerm[] {
  const out: AutolinkTerm[] = [];
  for (const p of posts) {
    for (const k of p.keywords.slice(0, 3)) if (k.trim().length >= 8) out.push({ phrase: k.trim(), href: `/blog/${p.category}/${p.slug}` });
  }
  for (const c of categories) if (c.count > 0) out.push({ phrase: c.name, href: `/blog/${c.slug}` });
  return out;
}

/** Evergreen product phrases that always point at a product page. */
export const SITE_TERMS: AutolinkTerm[] = [
  { phrase: "how Onward Scout works", href: "/how-it-works" },
  { phrase: "Onward Scout pricing", href: "/pricing" },
  { phrase: "application guides", href: "/guides" },
];
