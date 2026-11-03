import type { GeneratedBlock } from "@/lib/core/types";
import { deckSlides, type DeckItem, type DeckSlide } from "./deck";

/*
 * The pitch deck as a 16:9 PowerPoint (pptxgenjs), laid out from the same slides the room
 * previews (deck.ts): a dark title slide, then one slide per section — a statement slide for a
 * single sentence, metric tiles for figures, points otherwise. Every slide keeps its full text in
 * the speaker notes. Neutral styling with one quiet accent: it is the founder's deck, not ours.
 * Spots only the founder can fill show in amber with the question.
 */

export interface PptxInput {
  title: string;
  language: string;
  blocks: GeneratedBlock[];
  personName?: string | null;
}

const INK = "121614";
const INK2 = "3E4541";
const MUTED = "626A65";
const LINE = "E3E5E1";
const ACCENT = "1E5A48";
const ACCENT_LIGHT = "5FC2A0";
const GAP = "9A6B00";
const GAP_BG = "FFF6E0";

const W = 13.333;

/** Points text for the notes: what the presenter says on this slide. */
function notesOf(s: DeckSlide): string {
  return s.items.map((i) => (i.kind === "metric" && i.label ? `${i.label}: ${i.text}` : i.kind === "gap" ? `${i.label ?? ""} ${i.text}`.trim() : i.text)).join("\n\n");
}

function gapText(i: DeckItem): string {
  return i.label ? `${i.text}  —  ${i.label}` : i.text;
}

export async function renderPptx(input: PptxInput): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  const zh = input.language.startsWith("zh");
  const face = zh ? "Microsoft YaHei" : "Calibri";
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = input.title;
  pptx.author = input.personName ?? "";
  pptx.company = "";

  const slides = deckSlides(input.blocks, zh ? "概述" : "Overview");
  const brand = slides[0]?.title ?? input.title;
  const total = slides.length;

  slides.forEach((s, n) => {
    const slide = pptx.addSlide();
    slide.addNotes(notesOf(s));

    if (s.layout === "title") {
      slide.background = { color: INK };
      slide.addShape("rect", { x: 0.8, y: 4.15, w: 1.4, h: 0.09, fill: { color: ACCENT_LIGHT }, line: { color: ACCENT_LIGHT } });
      slide.addText(s.title, { x: 0.8, y: 1.5, w: W - 1.6, h: 1.6, fontFace: face, fontSize: 48, bold: true, color: "FFFFFF", valign: "bottom", fit: "shrink" });
      const lines = s.items.filter((i) => i.kind === "statement" || i.kind === "gap");
      const people = s.items.filter((i) => i.kind === "point");
      if (lines.length) {
        slide.addText(
          lines.map((i) => ({ text: i.kind === "gap" ? gapText(i) : i.text, options: { color: i.kind === "gap" ? "E0B44C" : "C9CFCB", breakLine: true } })),
          { x: 0.8, y: 3.1, w: W - 1.6, h: 1.0, fontFace: face, fontSize: 22, valign: "top", fit: "shrink" },
        );
      }
      if (people.length) slide.addText(people.map((p) => p.text).join("   ·   "), { x: 0.8, y: 4.5, w: W - 1.6, h: 0.6, fontFace: face, fontSize: 16, color: "A3ABA6" });
      return;
    }

    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", { x: 0.8, y: 1.32, w: 0.9, h: 0.07, fill: { color: ACCENT }, line: { color: ACCENT } });
    slide.addText(s.title, { x: 0.8, y: 0.45, w: W - 1.6, h: 0.85, fontFace: face, fontSize: 30, bold: true, color: INK, valign: "bottom", fit: "shrink" });
    slide.addShape("line", { x: 0.8, y: 6.85, w: W - 1.6, h: 0, line: { color: LINE, width: 0.75 } });
    slide.addText(brand, { x: 0.8, y: 6.9, w: 8, h: 0.35, fontFace: face, fontSize: 10, color: MUTED });
    slide.addText(`${n + 1} / ${total}`, { x: W - 2.8, y: 6.9, w: 2, h: 0.35, fontFace: face, fontSize: 10, color: MUTED, align: "right" });

    const metrics = s.items.filter((i) => i.kind === "metric").slice(0, 4);
    const rest = s.items.filter((i) => !metrics.includes(i));
    let top = 1.75;

    if (metrics.length) {
      const gapX = 0.3;
      const tileW = (W - 1.6 - gapX * (metrics.length - 1)) / metrics.length;
      metrics.forEach((m, k) => {
        const x = 0.8 + k * (tileW + gapX);
        slide.addShape("roundRect", { x, y: top, w: tileW, h: 1.9, fill: { color: "F5F4F0" }, line: { color: LINE, width: 0.75 }, rectRadius: 0.12 });
        slide.addText(m.text, { x: x + 0.25, y: top + 0.2, w: tileW - 0.5, h: 0.95, fontFace: face, fontSize: 36, bold: true, color: ACCENT, valign: "bottom", fit: "shrink" });
        if (m.label) slide.addText(m.label, { x: x + 0.25, y: top + 1.15, w: tileW - 0.5, h: 0.6, fontFace: face, fontSize: 14, color: INK2, valign: "top", fit: "shrink" });
      });
      top += 2.25;
    }

    if (!rest.length) return;
    if (s.layout === "statement" && rest.length === 1) {
      slide.addText(rest[0].text, { x: 0.8, y: top, w: W - 1.6, h: 6.6 - top, fontFace: face, fontSize: 28, color: INK2, valign: "middle", fit: "shrink", paraSpaceAfter: 6 });
      return;
    }
    slide.addText(
      rest.slice(0, 6).map((i) =>
        i.kind === "gap"
          ? { text: gapText(i), options: { color: GAP, highlight: GAP_BG, breakLine: true, bullet: false } }
          : { text: i.text, options: { bullet: i.kind === "point" ? { indent: 18 } : false, color: i.kind === "statement" ? INK : INK2, breakLine: true } },
      ),
      { x: 0.8, y: top, w: W - 1.6, h: 6.6 - top, fontFace: face, fontSize: metrics.length ? 18 : 22, valign: "top", paraSpaceAfter: 12, fit: "shrink" },
    );
  });

  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return out;
}
