import { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, TabStopPosition, TabStopType, TextRun } from "docx";
import type { GeneratedBlock, GeneratedDocumentKind } from "@/lib/core/types";
import { isGapBlock } from "./content";

/*
 * DOCX twin of render-pdf: same three layouts (letter, résumé, one-pager), editable in Word,
 * Pages, WPS or Google Docs. Fonts are referenced, not embedded: Calibri for Latin text and
 * Microsoft YaHei for Chinese (Word substitutes PingFang SC on a Mac), so a Chinese document
 * reads correctly on the reader's machine — which also makes DOCX the fallback whenever the PDF
 * CJK font cannot be loaded.
 */

export interface DocxInput {
  kind: GeneratedDocumentKind;
  title: string;
  language: string;
  blocks: GeneratedBlock[];
  roles?: string[];
  personName?: string | null;
  date?: Date;
}

const INK = "121614";
const MUTED = "626A65";
const PINE = "1E5A48";
const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Calibri", eastAsia: "Microsoft YaHei" };

interface RunOpts {
  bold?: boolean;
  size?: number;
  color?: string;
  italics?: boolean;
  caps?: boolean;
}

/** One run per line; line breaks inside a block become real breaks. */
function textRuns(text: string, opts: RunOpts = {}): TextRun[] {
  const lines = text.split("\n");
  return lines.map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, font: FONT, bold: opts.bold, italics: opts.italics, allCaps: opts.caps, size: opts.size ?? 21, color: opts.color ?? INK }));
}

function gapParagraph(b: GeneratedBlock): Paragraph {
  return new Paragraph({
    children: textRuns(b.text, { italics: true, color: "3E4541" }),
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFF6E0" },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "E0B44C", space: 6 } },
    spacing: { after: 160 },
  });
}

function formatDate(d: Date, language: string): string {
  if (language.startsWith("zh")) return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function letter(input: DocxInput): Paragraph[] {
  const out: Paragraph[] = [];
  if (input.kind === "cover_letter") out.push(new Paragraph({ children: textRuns(formatDate(input.date ?? new Date(), input.language), { color: MUTED, size: 20 }), spacing: { after: 300 } }));
  if (input.kind !== "cover_letter" && input.kind !== "email") out.push(new Paragraph({ children: textRuns(input.title, { bold: true, size: 32 }), spacing: { after: 240 } }));
  input.blocks.forEach((b, i) => {
    const role = input.roles?.[i];
    if (isGapBlock(b)) return out.push(gapParagraph(b));
    if (role === "subject") return out.push(new Paragraph({ children: textRuns(b.text, { bold: true, size: 28 }), spacing: { after: 240 } }));
    switch (b.type) {
      case "heading":
        out.push(new Paragraph({ children: textRuns(b.text, { bold: true, size: 23 }), spacing: { before: 220, after: 80 }, keepNext: true }));
        break;
      case "bullet":
        out.push(new Paragraph({ children: textRuns(b.text), bullet: { level: 0 }, spacing: { after: 60 } }));
        break;
      case "field":
        if (b.label) out.push(new Paragraph({ children: textRuns(b.label, { bold: true, color: MUTED, size: 18 }), spacing: { before: 120, after: 20 }, keepNext: true }));
        out.push(new Paragraph({ children: textRuns(b.text), spacing: { after: 140 } }));
        break;
      default:
        out.push(new Paragraph({ children: textRuns(b.text), spacing: { before: role === "signature" ? 240 : 0, after: 160 }, alignment: AlignmentType.LEFT }));
    }
  });
  return out;
}

function resume(input: DocxInput): Paragraph[] {
  const out: Paragraph[] = [];
  const roles = input.roles ?? [];
  const zh = input.language.startsWith("zh");
  input.blocks.forEach((b, i) => {
    const role = roles[i];
    if (isGapBlock(b)) return out.push(gapParagraph(b));
    if (i === 0 && b.type === "heading") return out.push(new Paragraph({ children: textRuns(b.text, { bold: true, size: 40 }), spacing: { after: 40 } }));
    if (role === "context-line") return out.push(new Paragraph({ children: textRuns(b.text, { color: "3E4541", size: 22 }), spacing: { after: 20 } }));
    if (role === "contact") return out.push(new Paragraph({ children: textRuns(b.text, { color: MUTED, size: 18 }), spacing: { after: 120 } }));
    switch (b.type) {
      case "heading":
        out.push(
          new Paragraph({
            children: textRuns(b.text, { bold: true, color: PINE, size: 19, caps: !zh }),
            spacing: { before: 240, after: 100 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9DCD8", space: 2 } },
            keepNext: true,
          }),
        );
        break;
      case "field":
        out.push(
          new Paragraph({
            children: [...textRuns(b.label ?? "", { bold: true }), ...(b.text ? [new TextRun({ text: "\t", font: FONT }), ...textRuns(b.text, { color: MUTED, size: 18 })] : [])],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: 100, after: 30 },
            keepNext: true,
          }),
        );
        break;
      case "bullet":
        out.push(new Paragraph({ children: textRuns(b.text), bullet: { level: 0 }, spacing: { after: 30 } }));
        break;
      default:
        out.push(new Paragraph({ children: textRuns(b.text), spacing: { after: 80 } }));
    }
  });
  return out;
}

function onePager(input: DocxInput): Paragraph[] {
  const zh = input.language.startsWith("zh");
  const out: Paragraph[] = [
    new Paragraph({
      children: textRuns(input.title, { bold: true, size: 36 }),
      border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: PINE, space: 4 } },
      spacing: { after: 200 },
    }),
  ];
  for (const b of input.blocks) {
    if (isGapBlock(b)) {
      out.push(gapParagraph(b));
      continue;
    }
    if (b.type === "heading") out.push(new Paragraph({ children: textRuns(b.text, { bold: true, color: PINE, size: 19, caps: !zh }), spacing: { before: 180, after: 60 }, keepNext: true }));
    else if (b.type === "bullet") out.push(new Paragraph({ children: textRuns(b.text), bullet: { level: 0 }, spacing: { after: 40 } }));
    else if (b.type === "field") {
      if (b.label) out.push(new Paragraph({ children: textRuns(b.label, { bold: true, color: MUTED, size: 18 }), keepNext: true }));
      out.push(new Paragraph({ children: textRuns(b.text), spacing: { after: 120 } }));
    } else out.push(new Paragraph({ children: textRuns(b.text), spacing: { after: 120 } }));
  }
  return out;
}

export async function renderDocx(input: DocxInput): Promise<Uint8Array> {
  const children = input.kind === "resume_variant" ? resume(input) : input.kind === "one_pager" || input.kind === "pitch_notes" ? onePager(input) : letter(input);
  const doc = new Document({
    creator: "Onward Scout",
    title: input.title,
    description: input.title,
    styles: { default: { document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1160, right: 1160 } } }, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
