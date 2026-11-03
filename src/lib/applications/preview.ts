/*
 * The free preview of a locked application (pure, shared by the room and the apply page): each
 * document's headings and its first lines stay readable; the rest is sent as a same-shaped
 * stand-in (letters → x, CJK → 口) with the "masked" flag and no sources, so the page can blur it
 * without ever holding the text (the API is the boundary, not the CSS).
 */

/** Lines every locked document shows… */
const PREVIEW_BLOCKS = 2;
/** …and up to this many while none of the shown lines yet comes from the person's own documents. */
const PREVIEW_MAX_BLOCKS = 4;

/**
 * Which blocks of a locked document stay readable: headings, gaps (prompts to the person), the
 * subject and greeting, then the first lines — running on (up to PREVIEW_MAX_BLOCKS) until one
 * of them comes from the person's own documents, since "I am applying for…" alone would not show
 * anyone that the draft read their résumé. Contiguous: once a line is masked, the rest are. Pure.
 */
export function previewReveal(blocks: ReadonlyArray<{ type: string; factIds: readonly string[]; gap?: boolean }>, roles: ReadonlyArray<string | undefined>): boolean[] {
  let shown = 0;
  let sourced = false;
  return blocks.map((b, i) => {
    const role = roles[i] ?? (b.gap ? "gap" : "body");
    if (b.type === "heading" || b.gap || role === "subject" || role === "greeting") return true;
    if (shown < PREVIEW_BLOCKS || (!sourced && shown < PREVIEW_MAX_BLOCKS)) {
      shown++;
      if (b.factIds.some((id) => !id.startsWith("answer:"))) sourced = true;
      return true;
    }
    return false;
  });
}

export function maskText(text: string): string {
  return text.replace(/[\p{L}\p{N}]/gu, (c) => (/\p{Script=Han}/u.test(c) ? "口" : "x"));
}
