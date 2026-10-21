import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countPublicationLines, guessDocumentKind } from "@/lib/ingest/classify";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("guessDocumentKind", () => {
  it("recognises résumés from text structure even without a telling filename", () => {
    const g = guessDocumentKind({ filename: "document.pdf", text: fx("resume-en.txt"), pages: 1 });
    expect(g.kind).toBe("resume");
    expect(g.confidence).toBeGreaterThan(0.5);
  });

  it("recognises a Chinese 简历", () => {
    expect(guessDocumentKind({ filename: "林晓雨-产品经理.pdf", text: fx("resume-zh.txt") }).kind).toBe("resume");
    expect(guessDocumentKind({ filename: "个人简历.docx", text: "" }).kind).toBe("resume");
  });

  it("recognises a founder deck", () => {
    expect(guessDocumentKind({ filename: "Tallyfern Seed.pptx", text: fx("deck-founder.txt") }).kind).toBe("deck");
  });

  it("tells an academic CV from a résumé by its publications", () => {
    const text = fx("cv-researcher.txt");
    expect(countPublicationLines(text)).toBeGreaterThanOrEqual(3);
    expect(guessDocumentKind({ filename: "CV.pdf", text }).kind).toBe("cv");
  });

  it("reads a CV without publications as a résumé", () => {
    expect(guessDocumentKind({ filename: "CV_2026.pdf", text: fx("resume-en.txt") }).kind).toBe("resume");
  });

  it("recognises papers, transcripts, certificates, licences and cover letters", () => {
    expect(guessDocumentKind({ filename: "draft.pdf", text: "Abstract\nWe study salt marshes.\n1. Introduction\nText.\nReferences\nSmith et al. 2020", pages: 12 }).kind).toBe("paper");
    expect(guessDocumentKind({ filename: "official_transcript.pdf", text: "Official Transcript\nCourse Code  Course Title  Credits  Grade\nCumulative GPA 3.71" }).kind).toBe("transcript");
    expect(guessDocumentKind({ filename: "scan.jpg", text: "This is to certify that Ana Ruiz has successfully completed the course" }).kind).toBe("certificate");
    expect(guessDocumentKind({ filename: "rn.pdf", text: "Board of Nursing\nLicense Number: RN-445512\nRegistered Nurse" }).kind).toBe("license");
    expect(guessDocumentKind({ filename: "letter.docx", text: "Dear Hiring Manager,\nI am writing to apply...\nSincerely,\nAna" }).kind).toBe("cover_letter");
    expect(guessDocumentKind({ filename: "BP-2026.docx", text: "执行摘要\n市场分析\n财务预测\n股权结构" }).kind).toBe("business_plan");
  });

  it("says 'other' when there is no evidence", () => {
    const g = guessDocumentKind({ filename: "IMG_2041.heic", text: "" });
    expect(g.kind).toBe("other");
    expect(g.confidence).toBe(0);
  });
});
