/**
 * A deliberately tiny inline markup for long-form copy kept as data (legal texts, FAQ links):
 * `**bold**`, `` `code` `` and `[label](href)`. Nothing else — no HTML, no nesting — so a
 * translation can never inject markup. Pure; rendered by <Rich> (./Rich.tsx).
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits a string into text, bold, code and link tokens (adjacent text is merged). */
export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  };
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    const index = m.index ?? 0;
    pushText(src.slice(at, index));
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) {
      if (isSafeHref(m[4])) out.push({ kind: "link", text: m[3], href: m[4] });
      else pushText(m[3]);
    }
    at = index + m[0].length;
  }
  pushText(src.slice(at));
  return out;
}

/** Only same-site paths (optionally with #anchor), https and mailto links are rendered as links. */
export function isSafeHref(href: string): boolean {
  if (href.startsWith("/")) return !href.startsWith("//") && !href.startsWith("/\\");
  if (href.startsWith("#")) return true;
  return /^https:\/\/[^\s]+$/.test(href) || /^mailto:[^\s@]+@[^\s@]+$/.test(href);
}

/** The same text without markup (for JSON-LD, meta descriptions and accessible names). */
export function plainInline(src: string): string {
  return parseInline(src)
    .map((t) => t.text)
    .join("");
}

/**
 * Replaces `{name}` placeholders with known values. Unknown names are left untouched, so a
 * literal brace in copy survives and a missing value is visible in review rather than blank.
 */
export function fillVars(src: string, vars: Readonly<Record<string, string | number>>): string {
  return src.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Splits an internal href into its path and #fragment (the locale-aware Link needs the path). */
export function splitHash(href: string): { path: string; hash: string } {
  const i = href.indexOf("#");
  return i < 0 ? { path: href, hash: "" } : { path: href.slice(0, i), hash: href.slice(i) };
}
