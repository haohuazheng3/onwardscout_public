import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExtractError, drawingMlText, extractFile, normalizeText, readZipDirectory, rtfToText, sniffFormat } from "@/lib/ingest/extract";
import { buildTextPdf } from "./fixtures/generate-binaries";

const bin = (f: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures", f)));

describe("extractFile", () => {
  it("reads a text PDF page by page (pdf-parse 2)", async () => {
    const r = await extractFile({ bytes: bin("resume.pdf"), filename: "resume.pdf" });
    expect(r.format).toBe("pdf");
    expect(r.pages).toBe(2);
    expect(r.text).toContain("JORDAN REYES");
    expect(r.text).toContain("jordan.reyes@example.com");
    expect(r.text).toContain("B.A. in Economics");
    expect(r.needsVision).toBe(false);
    expect(r.kind).toBe("resume");
  });

  it("flags a PDF without a text layer (a scan) for visual reading", async () => {
    const blank = buildTextPdf([[]]);
    const r = await extractFile({ bytes: new Uint8Array(blank), filename: "scan.pdf" });
    expect(r.format).toBe("pdf");
    expect(r.needsVision).toBe(true);
    expect(r.mediaType).toBe("application/pdf");
    expect(r.warnings.join(" ")).toMatch(/visually/);
  });

  it("reads DOCX with mammoth", async () => {
    const r = await extractFile({ bytes: bin("resume.docx"), filename: "resume.docx" });
    expect(r.format).toBe("docx");
    expect(r.text).toContain("Priya Shah-Lindgren");
    expect(r.text).toContain("Cut API p95 latency from 900 ms to 180 ms");
    expect(r.kind).toBe("resume");
  });

  it("reads PPTX slides in order, with speaker notes", async () => {
    const r = await extractFile({ bytes: bin("deck.pptx"), filename: "Fernbrook.pptx" });
    expect(r.format).toBe("pptx");
    expect(r.pages).toBe(3);
    const s1 = r.text.indexOf("[Slide 1]");
    const s2 = r.text.indexOf("[Slide 2]");
    const s3 = r.text.indexOf("[Slide 3]");
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(r.text).toContain("Cold-chain monitoring for small grocers");
    expect(r.text).toContain("Notes: Open with the spoilage story.");
    expect(r.text).toContain("$41K ARR");
    expect(r.kind).toBe("deck");
  });

  it("reads plain text, UTF-8 Chinese and GB18030", async () => {
    const utf8 = await extractFile({ bytes: bin("resume-zh.txt"), filename: "简历.txt" });
    expect(utf8.text).toContain("林晓雨");
    const gb = new Uint8Array(Buffer.from([0xc1, 0xd6, 0xcf, 0xfe, 0xd3, 0xea])); // 林晓雨 in GB18030
    const r = await extractFile({ bytes: gb, filename: "name.txt" });
    expect(r.text).toBe("林晓雨");
  });

  it("returns no text for images and asks for visual reading", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const r = await extractFile({ bytes: png, filename: "certificate.png", contentType: "image/png" });
    expect(r.format).toBe("image");
    expect(r.text).toBe("");
    expect(r.needsVision).toBe(true);
    expect(r.mediaType).toBe("image/png");
  });

  it("refuses legacy Office files, empty files and oversized files with a human message", async () => {
    await expect(extractFile({ bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), filename: "old.doc" })).rejects.toThrow(/Export it as PDF/);
    await expect(extractFile({ bytes: new Uint8Array(), filename: "empty.pdf" })).rejects.toBeInstanceOf(ExtractError);
    await expect(extractFile({ bytes: new Uint8Array(26 * 1024 * 1024), filename: "big.pdf" })).rejects.toThrow(/larger than/);
  });

  it("refuses zip bombs before inflating them", async () => {
    // Central directory claiming a 1 GB entry compressed into 1 KB.
    const name = Buffer.from("word/document.xml");
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(1024, 20);
    cd.writeUInt32LE(1024 * 1024 * 1024, 24);
    cd.writeUInt16LE(name.length, 28);
    name.copy(cd, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(4, 16);
    const bytes = new Uint8Array(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]));
    expect(readZipDirectory(bytes)?.[0].uncompressedSize).toBe(1024 * 1024 * 1024);
    expect(sniffFormat(bytes, "x.docx").format).toBe("docx");
    await expect(extractFile({ bytes, filename: "bomb.docx" })).rejects.toThrow(/unusually large/);
  });
});

describe("text helpers", () => {
  it("keeps column gaps as double spaces and drops zero-width characters", () => {
    expect(normalizeText("2021.07 - 至今\t\t上海某公司​   产品经理\r\n\r\n\r\n\r\nNext")).toBe("2021.07 - 至今  上海某公司  产品经理\n\nNext");
  });

  it("reads DrawingML paragraphs and line breaks", () => {
    const xml = '<p:sld><a:p><a:r><a:t>Hello &amp; </a:t></a:r><a:r><a:t>world</a:t></a:r></a:p><a:p><a:r><a:t>A</a:t></a:r><a:br/><a:r><a:t>B</a:t></a:r></a:p></p:sld>';
    expect(drawingMlText(xml)).toEqual(["Hello & world", "A", "B"]);
  });

  it("strips RTF control words", () => {
    expect(rtfToText("{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}\\f0\\fs24 Hello\\par World}").trim()).toBe("Hello\nWorld");
  });
});
