import type { GeneratedBlock } from "@/lib/core/types";
import { isGapBlock } from "./content";

/*
 * Pitch notes as a 16:9 deck (pptxgenjs): a title slide, then one slide per section of the
 * one-pager. Each slide shows short bullets; the full sentences go into the speaker notes, so
 * the person can present from their own facts. Plain, neutral styling — it is their deck.
 */

export interface PptxInput {
  title: string;
  language: string;
  blocks: GeneratedBlock[];
  personName?: string | null;
}

interface SlideSpec {
  heading: string;
  lines: string[];
  notes: string[];
  gap: boolean;
}

/** Groups blocks into slides at each heading (pure; exported for tests). */
export function slidesFrom(blocks: GeneratedBlock[], fallbackHeading: string): SlideSpec[] {
  const slides: SlideSpec[] = [];
  let cur: SlideSpec | null = null;
  for (const b of blocks) {
    if (b.type === "heading") {
      cur = { heading: b.text, lines: [], notes: [], gap: false };
      slides.push(cur);
      continue;
    }
    if (!cur) {
      cur = { heading: fallbackHeading, lines: [], notes: [], gap: false };
      slides.push(cur);
    }
    if (isGapBlock(b)) cur.gap = true;
    const text = b.type === "field" && b.label ? `${b.label}: ${b.text}` : b.text;
    cur.notes.push(text);
    // Slides carry the first sentence of each block; notes keep everything.
    const first = text.split(/(?<=[.!?。！？])\s*/)[0] ?? text;
    cur.lines.push(first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first);
  }
  return slides.filter((s) => s.lines.length || s.heading);
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

  const title = pptx.addSlide();
  title.background = { color: "FFFFFF" };
  title.addShape("rect", { x: 0.6, y: 3.55, w: 1.2, h: 0.08, fill: { color: "1E5A48" }, line: { color: "1E5A48" } });
  title.addText(input.title, { x: 0.6, y: 1.6, w: 12, h: 1.6, fontFace: face, fontSize: 40, bold: true, color: "121614", valign: "bottom" });
  if (input.personName) title.addText(input.personName, { x: 0.6, y: 3.8, w: 12, h: 0.6, fontFace: face, fontSize: 18, color: "626A65" });

  for (const s of slidesFrom(input.blocks, zh ? "概述" : "Overview")) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(s.heading, { x: 0.6, y: 0.4, w: 12, h: 0.9, fontFace: face, fontSize: 28, bold: true, color: "121614" });
    slide.addShape("rect", { x: 0.6, y: 1.3, w: 0.8, h: 0.06, fill: { color: "1E5A48" }, line: { color: "1E5A48" } });
    if (s.lines.length) {
      slide.addText(
        s.lines.slice(0, 6).map((l) => ({ text: l, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: 1.6, w: 12, h: 5.2, fontFace: face, fontSize: 18, color: s.gap ? "9A6B00" : "3E4541", valign: "top", paraSpaceAfter: 10 },
      );
    }
    slide.addNotes(s.notes.join("\n\n"));
  }

  const out = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return out;
}
