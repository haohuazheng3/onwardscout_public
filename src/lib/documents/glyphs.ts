/*
 * What the PDF standard fonts can carry (pure; no renderer import, so callers that only decide
 * whether a CJK font is needed stay light).
 */

export class CjkFontUnavailableError extends Error {
  constructor() {
    super("This document needs a Chinese font that could not be loaded right now.");
    this.name = "CjkFontUnavailableError";
  }
}

/** WinAnsi (Helvetica's encoding) covers Latin-1 plus a few typographic marks; anything else needs the fallback font. */
const OUTSIDE_WINANSI = /[^\u0000-ÿŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™]/;

export function needsExtendedFont(texts: string[]): boolean {
  return texts.some((t) => OUTSIDE_WINANSI.test(t));
}
