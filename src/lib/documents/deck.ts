import type { GeneratedBlock } from "@/lib/core/types";
import { isGapBlock } from "./content";

/*
 * A pitch deck stored as blocks, read back as slides (pure, isomorphic: the room preview, the
 * PPTX and the PDF all lay out the same slides). Each heading starts a slide; the first slide is
 * the title slide. On a slide, a `field` block is a metric (label = what is measured, text = the
 * figure), a bullet is a point, a paragraph is a statement and a gap block is a fact only the
 * person can give (its label is the question).
 */

export type DeckItemKind = "metric" | "point" | "statement" | "gap";

export interface DeckItem {
  kind: DeckItemKind;
  text: string;
  label?: string;
  /** Index of the block in the document (edits and sources address blocks by index). */
  block: number;
}

export type SlideLayout = "title" | "metrics" | "statement" | "points";

export interface DeckSlide {
  title: string;
  /** Index of the heading block (-1 when the deck starts without one). */
  block: number;
  layout: SlideLayout;
  items: DeckItem[];
}

function itemOf(b: GeneratedBlock, i: number): DeckItem {
  if (isGapBlock(b)) return { kind: "gap", text: b.text, ...(b.label ? { label: b.label } : {}), block: i };
  if (b.type === "field") return { kind: "metric", text: b.text, ...(b.label ? { label: b.label } : {}), block: i };
  if (b.type === "bullet") return { kind: "point", text: b.text, block: i };
  return { kind: "statement", text: b.text, block: i };
}

export function deckSlides(blocks: GeneratedBlock[], fallbackTitle: string): DeckSlide[] {
  const slides: DeckSlide[] = [];
  let cur: DeckSlide | null = null;
  blocks.forEach((b, i) => {
    if (b.type === "heading" && !isGapBlock(b)) {
      cur = { title: b.text, block: i, layout: "points", items: [] };
      slides.push(cur);
      return;
    }
    if (!cur) {
      cur = { title: fallbackTitle, block: -1, layout: "points", items: [] };
      slides.push(cur);
    }
    cur.items.push(itemOf(b, i));
  });
  slides.forEach((s, n) => {
    s.layout = n === 0 ? "title" : s.items.some((x) => x.kind === "metric") ? "metrics" : s.items.length === 1 && s.items[0].kind === "statement" ? "statement" : "points";
  });
  return slides;
}
