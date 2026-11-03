/**
 * Inline JSON-LD. `<`, `>`, `&` and the line/paragraph separators are escaped so the payload
 * can never close the script tag or break the HTML parser, whatever strings it carries.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/**
 * Several nodes go out as one `@graph` object, never a bare array: readers that look up
 * `data["@context"]` (browser and analytics scripts among them) throw on a top-level array.
 */
export function asGraph(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  const nodes = data.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const { "@context": _context, ...rest } = node as Record<string, unknown>;
    void _context;
    return rest;
  });
  return { "@context": "https://schema.org", "@graph": nodes };
}

export function JsonLd({ data, id }: { data: unknown; id?: string }) {
  return <script type="application/ld+json" id={id} dangerouslySetInnerHTML={{ __html: serializeJsonLd(asGraph(data)) }} />;
}
