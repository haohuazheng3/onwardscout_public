/*
 * Regenerates the small binary fixtures used by tests/ingest-extract.test.ts:
 *   resume.pdf  — a 2-page text PDF (standard Helvetica font, hand-built so the text layer is exact)
 *   resume.docx — a Word document (docx package)
 *   deck.pptx   — a 3-slide deck with speaker notes (pptxgenjs)
 * Every person and company is fictional. Run once and commit the outputs:
 *   npx tsx tests/fixtures/generate-binaries.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";

const OUT = path.dirname(fileURLToPath(import.meta.url));

/** A minimal, valid PDF: one Helvetica text object per page, exact xref offsets. */
export function buildTextPdf(pages: string[][]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: pages, 3: font, then per page: page + content stream.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const ops = ["BT", "/F1 11 Tf", "14 TL", "72 760 Td", ...lines.map((l, i) => `${i === 0 ? "" : "T* "}(${esc(l)}) Tj`), "ET"].join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function main(): Promise<void> {
  const pdf = buildTextPdf([
    [
      "JORDAN REYES",
      "Data Analyst",
      "Denver, CO | jordan.reyes@example.com | (303) 555-0187",
      "",
      "EXPERIENCE",
      "Data Analyst, Bramblewood Outfitters        Jan 2022 - Present",
      "- Built a demand forecast that cut stockouts by 22%",
      "- Automated weekly sales reporting in SQL and Python",
    ],
    [
      "EDUCATION",
      "Colorado Plains University",
      "B.A. in Economics, 2017 - 2021",
      "",
      "SKILLS",
      "SQL, Python, Tableau, Excel",
      "Fictional sample for automated tests.",
    ],
  ]);
  writeFileSync(path.join(OUT, "resume.pdf"), pdf);

  const doc = new Document({
    creator: "Onward Scout tests",
    title: "Sample résumé",
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Priya Shah-Lindgren")] }),
          new Paragraph("Backend Engineer | Seattle, WA | priya.sl@example.com"),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Experience")] }),
          new Paragraph("Backend Engineer, Larchmont Logistics        Aug 2020 – Present"),
          new Paragraph({ bullet: { level: 0 }, children: [new TextRun("Cut API p95 latency from 900 ms to 180 ms by redesigning the routing cache")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Education")] }),
          new Paragraph("University of Puget Lowlands"),
          new Paragraph("B.S. in Computer Science, 2016 – 2020"),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Skills")] }),
          new Paragraph("Go, PostgreSQL, Kubernetes, gRPC"),
          new Paragraph("Fictional sample for automated tests."),
        ],
      },
    ],
  });
  writeFileSync(path.join(OUT, "resume.docx"), await Packer.toBuffer(doc));

  const pptx = new PptxGenJS();
  pptx.title = "Fernbrook pitch (fictional)";
  const s1 = pptx.addSlide();
  s1.addText("Fernbrook", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 36 });
  s1.addText("Cold-chain monitoring for small grocers", { x: 0.5, y: 1.6, w: 9, h: 0.8, fontSize: 18 });
  s1.addNotes("Open with the spoilage story. Fictional company for tests.");
  const s2 = pptx.addSlide();
  s2.addText("Traction", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28 });
  s2.addText(
    [
      { text: "27 paying stores", options: { bullet: true, breakLine: true } },
      { text: "$41K ARR", options: { bullet: true } },
    ],
    { x: 0.5, y: 1.4, w: 9, h: 2 },
  );
  s2.addNotes("Numbers as of September.");
  const s3 = pptx.addSlide();
  s3.addText("The Ask", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28 });
  s3.addText("Raising $900K pre-seed", { x: 0.5, y: 1.4, w: 9, h: 0.8 });
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  writeFileSync(path.join(OUT, "deck.pptx"), buf);
  console.log("wrote resume.pdf, resume.docx, deck.pptx");
}

if (process.argv[1] && process.argv[1].endsWith("generate-binaries.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
