import * as cheerio from "cheerio";

/** The slice of domhandler's node shape the renderer reads (kept local: domhandler is cheerio's dependency, not ours). */
interface DomNode {
  type: string;
  data?: string;
  name?: string;
  children?: DomNode[];
}

/*
 * HTML → readable text plus the metadata pages publish about themselves (title, meta
 * description, Open Graph, JSON-LD). Used for links a user pastes (personal sites,
 * portfolios, company pages, program pages) and for HTML uploads. Page text is DATA:
 * callers never follow instructions found in it.
 */

export interface ReadablePage {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  canonical: string | null;
  lang: string | null;
  /** Open Graph / Twitter card properties, e.g. {"og:type": "profile"}. */
  meta: Record<string, string>;
  /** Parsed JSON-LD objects (arrays and @graph flattened). */
  jsonLd: unknown[];
  /** Main content as text: block elements on their own lines, list items as "- ". */
  text: string;
  /** Absolute http(s) links found in the main content (deduplicated, at most 150). */
  links: Array<{ url: string; text: string }>;
}

const MAX_TEXT = 100_000;
const MAX_LINKS = 150;

const DROP = "script, style, noscript, template, svg, canvas, iframe, object, embed, form, button, select, input, textarea, dialog, [hidden], [aria-hidden=true]";
const CHROME = "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], .cookie, .cookies, #cookie-banner, .newsletter";

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "thead", "tfoot", "tr", "ul", "br", "summary", "details",
]);

function absolute(href: string, base: string | null): string | null {
  try {
    const u = base ? new URL(href, base) : new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function flattenJsonLd(value: unknown, out: unknown[]): void {
  if (Array.isArray(value)) {
    for (const v of value) flattenJsonLd(v, out);
    return;
  }
  if (value && typeof value === "object") {
    const graph = (value as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) {
      for (const v of graph) flattenJsonLd(v, out);
      return;
    }
    out.push(value);
  }
}

function collapse(s: string): string {
  return s.replace(/[ \t\r\f\v ]+/g, " ");
}

/** Serialises a subtree to text with line breaks around block elements. */
function renderText(nodes: DomNode[], parts: string[]): void {
  for (const node of nodes) {
    if (node.type === "text") {
      parts.push(collapse(node.data ?? ""));
      continue;
    }
    if (node.type !== "tag") continue;
    const el = node;
    const name = (el.name ?? "").toLowerCase();
    if (name === "br") {
      parts.push("\n");
      continue;
    }
    const block = BLOCK.has(name);
    if (block) parts.push("\n");
    if (/^h[1-6]$/.test(name)) parts.push(`${"#".repeat(Number(name[1]))} `);
    if (name === "li") parts.push("- ");
    if (name === "td" || name === "th") parts.push(" | ");
    renderText(el.children ?? [], parts);
    if (block) parts.push("\n");
  }
}

export function htmlToReadable(html: string, baseUrl: string | null): ReadablePage {
  const $ = cheerio.load(html);
  const meta: Record<string, string> = {};
  $("meta").each((_i, el) => {
    const key = ($(el).attr("property") ?? $(el).attr("name") ?? "").trim().toLowerCase();
    const content = ($(el).attr("content") ?? "").trim();
    if (!key || !content) return;
    if (key.startsWith("og:") || key.startsWith("twitter:") || key.startsWith("profile:") || key.startsWith("article:") || key === "description" || key === "author" || key === "keywords") {
      if (!(key in meta)) meta[key] = content.slice(0, 1000);
    }
  });

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw || raw.length > 200_000) return;
    try {
      flattenJsonLd(JSON.parse(raw), jsonLd);
    } catch {
      // Broken JSON-LD is common (trailing commas, HTML entities); the page text still carries the content.
    }
  });

  const title = (meta["og:title"] ?? $("title").first().text().trim()) || $("h1").first().text().trim() || null;
  const description = meta["description"] ?? meta["og:description"] ?? meta["twitter:description"] ?? null;
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalHref ? absolute(canonicalHref, baseUrl) : null;
  const imageHref = meta["og:image"] ?? meta["twitter:image"];
  const image = imageHref ? absolute(imageHref, baseUrl) : null;
  const lang = ($("html").attr("lang") ?? "").trim() || null;

  $(DROP).remove();
  // Prefer the page's own main content; fall back to the body without site chrome.
  const main = $("main, [role=main], article").first();
  let root = main;
  if (main.length === 0 || main.text().trim().length < 200) {
    $(CHROME).remove();
    // cheerio.load always wraps fragments in <html><body>, so body exists.
    root = $("body");
  } else {
    main.find(CHROME).remove();
    root = main;
  }

  const links: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  root.find("a[href]").each((_i, el) => {
    if (links.length >= MAX_LINKS) return;
    const url = absolute($(el).attr("href") ?? "", baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ url, text: collapse($(el).text()).trim().slice(0, 200) });
  });

  const parts: string[] = [];
  renderText((root.toArray() as unknown as DomNode[]).flatMap((n) => n.children ?? []), parts);
  const text = parts
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

  return {
    title: title ? collapse(title).trim().slice(0, 300) : null,
    description: description ? collapse(description).trim().slice(0, 1000) : null,
    siteName: meta["og:site_name"] ?? null,
    image,
    canonical,
    lang,
    meta,
    jsonLd: jsonLd.slice(0, 20),
    text,
    links,
  };
}
