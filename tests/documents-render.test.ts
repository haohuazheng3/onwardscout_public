import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocument } from "@/lib/documents/build";
import { looksLikeFont, setCjkFontFiles, ttfUrlsFromCss, type CjkFontFiles } from "@/lib/documents/fonts";
import { renderDocx } from "@/lib/documents/render-docx";
import { CjkFontUnavailableError, cjkSyllables, needsExtendedFont, renderPdf } from "@/lib/documents/render-pdf";
import { renderPptx, slidesFrom } from "@/lib/documents/render-pptx";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localIntelligence } from "@/lib/llm/provider-local";
import type { FactRef } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = new Date("2026-10-21T00:00:00Z");

function person(file: string, kind: "resume" | "deck", locale: "en" | "zh") {
  const out = localExtractProfile({ documents: [{ id: `doc_${file}`, kind, filename: file, text: fx(file) }], locale, now: "2026-10-21" });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

/**
 * A local single-face CJK font for the Chinese PDF: CJK_TEST_FONT, else a system font.
 * CI runners usually have none; the Chinese PDF case then checks the DOCX fallback contract
 * instead (production fetches Noto Sans SC, see src/lib/documents/fonts.ts).
 */
const CJK_FONT = [process.env.CJK_TEST_FONT, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf", "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", "/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf"].find(
  (p): p is string => Boolean(p && existsSync(p) && /\.(ttf|otf)$/i.test(p)),
);
const cjk: CjkFontFiles | null = CJK_FONT ? { regular: CJK_FONT, bold: CJK_FONT } : null;

const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString("latin1") === "%PDF-";
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

describe("render — English", async () => {
  const designer = person("resume-en.txt", "resume", "en");
  const opp = { id: "opp_job", type: "job", name: "Senior Product Designer", orgName: "Juniper Clinics", tags: ["design systems", "figma"] };
  const letter = await buildDocument({ ai: localIntelligence, kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: opp, language: "en", answers: { why_this: "Juniper's intake work is the problem I keep coming back to." }, now: NOW });
  const resume = await buildDocument({ ai: localIntelligence, kind: "resume_variant", profile: designer.profile, facts: designer.facts, opportunity: opp, language: "en", now: NOW });

  it("produces a cover letter PDF whose text is the composed text", async () => {
    const bytes = await renderPdf({ kind: "cover_letter", title: letter.title, language: "en", blocks: letter.content.blocks, roles: letter.content.meta.roles, personName: "Avery Quinn", date: NOW });
    expect(isPdf(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1500);
    const text = (await pdfText(bytes)).replace(/\s+/g, " ");
    expect(text).toContain("21 October 2026");
    expect(text).toContain("Juniper Clinics");
    expect(text).toContain("intake work");
  });

  it("produces a résumé PDF and DOCX", async () => {
    const input = { kind: "resume_variant" as const, title: resume.title, language: "en", blocks: resume.content.blocks, roles: resume.content.meta.roles };
    const pdf = await renderPdf(input);
    expect(isPdf(pdf)).toBe(true);
    expect((await pdfText(pdf)).replace(/\s+/g, " ")).toContain("Quillfeather Health");
    const docx = await renderDocx(input);
    expect(isZip(docx)).toBe(true);
    const xml = await docxXml(docx);
    expect(xml).toContain("Quillfeather Health");
    expect(xml).toContain("Microsoft YaHei");
  });

  it("produces pitch notes as PPTX", async () => {
    const founder = person("deck-founder.txt", "deck", "en");
    const notes = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", profile: founder.profile, facts: founder.facts, opportunity: { id: "o", type: "investor", name: "Harbor Seed Fund", orgName: "Harbor Seed Fund" }, language: "en", now: NOW });
    const pptx = await renderPptx({ title: notes.title, language: "en", blocks: notes.content.blocks, personName: "Founder" });
    expect(isZip(pptx)).toBe(true);
    expect(slidesFrom(notes.content.blocks, "Overview").length).toBeGreaterThan(0);
  });
});

describe("render — Chinese", async () => {
  const pm = person("resume-zh.txt", "resume", "zh");
  const opp = { id: "opp_zh", type: "job", name: "高级产品经理", orgName: "示例科技", languages: ["zh"] };
  const letter = await buildDocument({ ai: localIntelligence, kind: "cover_letter", profile: pm.profile, facts: pm.facts, opportunity: opp, language: "zh", answers: { why_this: "我一直关注协同办公产品，希望把审批体验做得更顺畅。" }, now: NOW });
  const resume = await buildDocument({ ai: localIntelligence, kind: "resume_variant", profile: pm.profile, facts: pm.facts, opportunity: opp, language: "zh", now: NOW });
  const input = { kind: "cover_letter" as const, title: letter.title, language: "zh", blocks: letter.content.blocks, roles: letter.content.meta.roles, date: NOW };

  it("needs the CJK font for a PDF and says so when it is missing", async () => {
    expect(needsExtendedFont([letter.content.blocks.map((b) => b.text).join("")])).toBe(true);
    await expect(renderPdf(input, { cjk: null })).rejects.toBeInstanceOf(CjkFontUnavailableError);
  });

  it("produces DOCX bytes (the fallback that always works)", async () => {
    const docx = await renderDocx(input);
    expect(isZip(docx)).toBe(true);
    const xml = await docxXml(docx);
    expect(xml).toContain("示例科技");
    expect(xml).toContain("2026年10月21日");
    const r = await renderDocx({ kind: "resume_variant", title: resume.title, language: "zh", blocks: resume.content.blocks, roles: resume.content.meta.roles });
    expect(isZip(r)).toBe(true);
  });

  it.skipIf(!cjk)("produces a Chinese PDF with a CJK font, text intact", async () => {
    const pdf = await renderPdf(input, { cjk });
    expect(isPdf(pdf)).toBe(true);
    const text = (await pdfText(pdf)).replace(/\s+/g, "");
    expect(text).toContain("示例科技");
    expect(text).toContain("希望把审批体验做得更顺畅");
    // the font is subset, not embedded whole
    expect(pdf.length).toBeLessThan(2_000_000);
    const rpdf = await renderPdf({ kind: "resume_variant", title: resume.title, language: "zh", blocks: resume.content.blocks, roles: resume.content.meta.roles }, { cjk });
    expect((await pdfText(rpdf)).replace(/\s+/g, "")).toContain("上海云帆数字科技有限公司");
  });
});

describe("render helpers", () => {
  it("breaks Chinese between characters, keeps punctuation and Latin runs together", () => {
    expect(cjkSyllables("Figma")).toEqual(["Figma"]);
    expect(cjkSyllables("我们，在Q3上线。")).toEqual(["我", "", "们，", "", "在", "", "Q3", "", "上", "", "线。"]);
    expect(cjkSyllables("（试点）项目")).toEqual(["（试", "", "点）", "", "项", "", "目"]);
  });

  it("knows which text Helvetica can carry", () => {
    expect(needsExtendedFont(["Résumé — “quoted” • 3–5"])).toBe(false);
    expect(needsExtendedFont(["Kraków"])).toBe(false);
    expect(needsExtendedFont(["Łódź"])).toBe(true);
    expect(needsExtendedFont(["简历"])).toBe(true);
  });

  it("reads TrueType URLs from the Google Fonts CSS", () => {
    const css = `@font-face {\n  font-family: 'Noto Sans SC';\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/s/notosanssc/v41/a.ttf) format('truetype');\n}\n@font-face {\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/s/notosanssc/v41/b.ttf) format('truetype');\n}`;
    expect(ttfUrlsFromCss(css)).toEqual({ 400: "https://fonts.gstatic.com/s/notosanssc/v41/a.ttf", 700: "https://fonts.gstatic.com/s/notosanssc/v41/b.ttf" });
    expect(ttfUrlsFromCss("nothing")).toEqual({});
    expect(looksLikeFont(new Uint8Array(10))).toBe(false);
    setCjkFontFiles(undefined);
  });
});

async function docxXml(bytes: Uint8Array): Promise<string> {
  const { inflateRawSync } = await import("node:zlib");
  const buf = Buffer.from(bytes);
  // Minimal zip walk: find word/document.xml's local header and inflate it.
  const name = "word/document.xml";
  let i = 0;
  while (i < buf.length - 30) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const size = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const fileName = buf.toString("utf8", i + 30, i + 30 + nameLen);
      const start = i + 30 + nameLen + extraLen;
      if (fileName === name) {
        const data = buf.subarray(start, start + size);
        return method === 8 ? inflateRawSync(data).toString("utf8") : data.toString("utf8");
      }
      i = start + size;
    } else i++;
  }
  throw new Error("document.xml not found");
}
