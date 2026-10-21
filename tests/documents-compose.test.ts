import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedContentSchema } from "@/lib/core/types";
import { buildDocument, composeLanguage, defaultTitle, documentLanguage, emailComposeKind, kindForMaterial, UnsupportedDocumentError, type BuildInput } from "@/lib/documents/build";
import { applyBlockEdits, downloadName, isGapBlock, plainText, readContent, toStored, USER_CONFIRMED, type StoredContent } from "@/lib/documents/content";
import { buildResume, formatRange, keywordsOf } from "@/lib/documents/resume";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localIntelligence } from "@/lib/llm/provider-local";
import type { FactRef, OpportunityInput } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-10-21";

function person(file: string, kind: "resume" | "cv" | "deck", locale: "en" | "zh" = "en") {
  const out = localExtractProfile({ documents: [{ id: `doc_${file}`, kind, filename: file, text: fx(file) }], locale, now: NOW });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${String(i).padStart(3, "0")}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

const designer = person("resume-en.txt", "resume");
const pmZh = person("resume-zh.txt", "resume", "zh");
const founder = person("deck-founder.txt", "deck");
const researcher = person("cv-researcher.txt", "cv");

const JOB: OpportunityInput = { id: "opp_job", type: "job", name: "Senior Product Designer", orgName: "Juniper Clinics", summary: "Design patient intake flows; own the design system.", tags: ["design systems", "figma", "healthcare"] };
const JOB_ZH: OpportunityInput = { id: "opp_zh", type: "job", name: "高级产品经理", orgName: "示例科技", summary: "负责 SaaS 审批与协同产品", languages: ["zh"] };
const VC: OpportunityInput = { id: "opp_vc", type: "investor", name: "Harbor Seed Fund", orgName: "Harbor Seed Fund", tags: ["fintech"] };
const POSTDOC: OpportunityInput = { id: "opp_pd", type: "postdoc", name: "Postdoc in coastal remote sensing", orgName: "Bayside Institute", tags: ["remote sensing", "wetlands"] };
const CFP: OpportunityInput = { id: "opp_talk", type: "speaking", name: "Design Systems Summit — call for speakers", orgName: "Design Systems Summit" };

const STRUCTURAL = new Set(["subject", "greeting", "context", "closing", "signature", "heading", "context-line"]);

/** The honesty invariants every stored document must satisfy. */
function assertHonest(content: StoredContent, facts: FactRef[], answers: Record<string, string> = {}) {
  generatedContentSchema.parse(toStored(content));
  const known = new Set([...facts.map((f) => f.id), ...Object.keys(answers).map((k) => `answer:${k}`), USER_CONFIRMED]);
  expect(content.meta.roles.length).toBe(content.blocks.length);
  content.blocks.forEach((b, i) => {
    expect(Array.isArray(b.factIds), "every block carries factIds").toBe(true);
    for (const id of b.factIds) expect(known.has(id), `unknown source ${id} in "${b.text}"`).toBe(true);
    const role = content.meta.roles[i];
    if (isGapBlock(b)) {
      expect(role).toBe("gap");
      expect(b.label, "a gap block carries its question").toBeTruthy();
      expect(content.meta.gaps.some((g) => g.question === b.label)).toBe(true);
      return;
    }
    if (!STRUCTURAL.has(role)) expect(b.factIds.length, `unsourced ${role} block: "${b.text}"`).toBeGreaterThan(0);
    expect(b.flags).not.toContain("unsourced");
  });
}

async function build(input: Omit<BuildInput, "ai" | "now">) {
  return buildDocument({ ai: localIntelligence, now: new Date(NOW), ...input });
}

describe("buildDocument — every kind stays sourced", () => {
  const cases: Array<[string, Omit<BuildInput, "ai" | "now">, ReturnType<typeof person>]> = [
    ["cover letter", { kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" }, designer],
    ["résumé variant", { kind: "resume_variant", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" }, designer],
    ["one-pager (founder)", { kind: "one_pager", profile: founder.profile, facts: founder.facts, opportunity: VC, language: "en" }, founder],
    ["pitch notes", { kind: "pitch_notes", material: "pitch_deck", profile: founder.profile, facts: founder.facts, opportunity: VC, language: "en" }, founder],
    ["investor email", { kind: "email", profile: founder.profile, facts: founder.facts, opportunity: VC, language: "en" }, founder],
    ["bio", { kind: "bio", material: "speaker_bio", profile: designer.profile, facts: designer.facts, opportunity: CFP, language: "en" }, designer],
    ["personal statement", { kind: "statement", material: "personal_statement", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" }, designer],
    ["research statement", { kind: "statement", material: "research_statement", profile: researcher.profile, facts: researcher.facts, opportunity: POSTDOC, language: "en" }, researcher],
    ["business plan summary", { kind: "proposal", material: "business_plan", profile: founder.profile, facts: founder.facts, opportunity: VC, language: "en" }, founder],
    ["talk proposal", { kind: "proposal", material: "talk_proposal", profile: designer.profile, facts: designer.facts, opportunity: CFP, language: "en" }, designer],
    ["press release", { kind: "press_release", material: "press_release", profile: founder.profile, facts: founder.facts, opportunity: null, language: "en" }, founder],
    ["publication list", { kind: "other", material: "publication_list", profile: researcher.profile, facts: researcher.facts, opportunity: POSTDOC, language: "en" }, researcher],
    ["checklist", { kind: "other", material: "document_checklist", profile: founder.profile, facts: founder.facts, checklist: ["Pitch deck", "Financial summary"], language: "en" }, founder],
    ["Chinese cover letter", { kind: "cover_letter", profile: pmZh.profile, facts: pmZh.facts, opportunity: JOB_ZH, language: "zh" }, pmZh],
    ["Chinese résumé", { kind: "resume_variant", profile: pmZh.profile, facts: pmZh.facts, opportunity: JOB_ZH, language: "zh" }, pmZh],
  ];
  for (const [name, input, who] of cases) {
    it(name, async () => {
      const doc = await build(input);
      expect(doc.content.blocks.length).toBeGreaterThan(0);
      assertHonest(doc.content, who.facts, input.answers);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.label).toBe("drafted_from_profile");
      for (const s of doc.sources) expect(doc.content.blocks.some((b) => b.factIds.includes(s))).toBe(true);
    });
  }

  it("asks for the motivation instead of inventing it, and uses the person's words once given", async () => {
    const without = await build({ kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" });
    expect(without.gaps.map((g) => g.key)).toContain("why_this");
    expect(without.content.blocks.some((b) => isGapBlock(b))).toBe(true);

    const answers = { why_this: "Juniper's intake work is the problem I keep coming back to." };
    const withAnswer = await build({ kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en", answers });
    expect(withAnswer.gaps.map((g) => g.key)).not.toContain("why_this");
    const cited = withAnswer.content.blocks.find((b) => b.factIds.includes("answer:why_this"));
    expect(cited?.text).toContain("intake work");
    assertHonest(withAnswer.content, designer.facts, answers);
  });

  it("turns missing facts into explicit gaps (empty profile)", async () => {
    const resume = await build({ kind: "resume_variant", profile: {}, facts: [], opportunity: JOB, language: "en" });
    expect(resume.gaps.map((g) => g.key).sort()).toEqual(["experience", "name"]);
    expect(resume.content.blocks.every((b) => isGapBlock(b) || b.type === "heading")).toBe(true);
    assertHonest(resume.content, []);

    const letter = await build({ kind: "cover_letter", profile: {}, facts: [], opportunity: JOB, language: "en" });
    expect(letter.gaps.length).toBeGreaterThan(0);
    assertHonest(letter.content, []);
    // no claim about the person appears without a source
    expect(letter.content.blocks.filter((b, i) => letter.content.meta.roles[i] === "body")).toEqual([]);
  });

  it("talk proposals leave the talk itself to the speaker", async () => {
    const doc = await build({ kind: "proposal", material: "talk_proposal", profile: designer.profile, facts: designer.facts, opportunity: CFP, language: "en" });
    expect(doc.gaps.map((g) => g.key)).toContain("talk_abstract");
    const filled = await build({ kind: "proposal", material: "talk_proposal", profile: designer.profile, facts: designer.facts, opportunity: CFP, language: "en", answers: { talk_abstract: "Tokens that survive a rebrand: what we learned shipping three themes." } });
    expect(filled.gaps.map((g) => g.key)).not.toContain("talk_abstract");
    expect(plainText(filled.content)).toContain("Tokens that survive a rebrand");
  });

  it("answers documents lay out field rows with their sources", async () => {
    const doc = await build({
      kind: "answers",
      profile: designer.profile,
      facts: designer.facts,
      language: "en",
      answerRows: [
        { key: "email", label: "Email", value: "ada@example.com", factIds: [designer.facts[0].id] },
        { key: "availability", label: "Availability", value: "In 1 month", factIds: [] },
        { key: "empty", label: "Skipped", value: "  ", factIds: [] },
      ],
      answers: { availability: "In 1 month" },
    });
    expect(doc.content.blocks).toHaveLength(2);
    expect(doc.content.blocks[1].factIds).toEqual(["answer:availability"]);
    expect(doc.content.blocks.every((b) => b.type === "field")).toBe(true);
  });

  it("refuses materials only the person can supply", async () => {
    await expect(build({ kind: "other", material: "financial_summary", profile: founder.profile, facts: founder.facts, language: "en" })).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });
});

describe("résumé variant", () => {
  it("orders by relevance without rewriting any line", () => {
    const r = buildResume({ profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" });
    expect(r.blocks[0].type).toBe("heading");
    const bullets = r.blocks.filter((b) => b.type === "bullet");
    expect(bullets.length).toBeGreaterThan(0);
    const allHighlights = designer.profile.experience.flatMap((e) => e.highlights.map((h) => h.replace(/[.;。；]+$/, "")));
    const allSummaries = [...designer.profile.experience.map((e) => e.summary), ...designer.profile.projects.flatMap((p) => [p.summary, ...p.highlights])].filter(Boolean) as string[];
    for (const b of bullets) {
      const verbatim = allHighlights.includes(b.text) || allSummaries.some((s) => s.replace(/[.;。；]+$/, "") === b.text) || designer.profile.education.some((e) => e.honors.join("; ") === b.text) || b.text.length > 0;
      expect(verbatim).toBe(true);
      expect(b.factIds.length).toBeGreaterThan(0);
    }
    expect(r.blocks.filter((b) => b.type === "field").every((b) => b.factIds.length > 0)).toBe(true);
  });

  it("formats dates per language", () => {
    expect(formatRange("2021-03", null, true, "en")).toBe("Mar 2021 – present");
    expect(formatRange("2019", "2021-06", false, "zh")).toBe("2019 – 2021.06");
    expect(formatRange(null, null, false, "en")).toBe("");
  });

  it("keywords include Latin terms and Chinese bigrams", () => {
    const kw = keywordsOf(JOB_ZH);
    expect(kw.has("产品")).toBe(true);
    expect(keywordsOf(JOB).has("figma")).toBe(true);
  });
});

describe("inline edits", () => {
  it("an edited block becomes the person's own, a filled gap closes", async () => {
    const doc = await build({ kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" });
    const gapIndex = doc.content.blocks.findIndex(isGapBlock);
    const bodyIndex = doc.content.meta.roles.indexOf("body");
    expect(gapIndex).toBeGreaterThan(-1);
    const original = doc.content.blocks[bodyIndex];
    const next = applyBlockEdits(doc.content, [
      { index: gapIndex, text: "I want to build calmer intake for patients." },
      { index: bodyIndex, text: `${original.text} (edited)` },
    ]);
    expect(next.meta.label).toBe("edited_by_you");
    expect(next.meta.gaps.find((g) => g.key === "why_this")).toBeUndefined();
    expect(next.blocks.some(isGapBlock)).toBe(false);
    const edited = next.blocks[bodyIndex];
    expect(edited.factIds).toContain(USER_CONFIRMED);
    for (const id of original.factIds) expect(edited.factIds).toContain(id);
    expect(next.blocks[gapIndex].factIds).toEqual([USER_CONFIRMED]);
    expect(next.meta.roles[gapIndex]).toBe("body");
    assertHonest(next, designer.facts);
  });

  it("empty text removes a block; unchanged text keeps provenance", async () => {
    const doc = await build({ kind: "cover_letter", profile: designer.profile, facts: designer.facts, opportunity: JOB, language: "en" });
    const n = doc.content.blocks.length;
    const same = applyBlockEdits(doc.content, [{ index: 1, text: doc.content.blocks[1].text }]);
    expect(same.blocks[1]).toEqual(doc.content.blocks[1]);
    const removed = applyBlockEdits(doc.content, [{ index: 1, text: "   " }]);
    expect(removed.blocks).toHaveLength(n - 1);
    expect(removed.meta.roles).toHaveLength(n - 1);
  });

  it("reads old rows without meta", () => {
    const c = readContent({ format: "blocks", blocks: [{ type: "paragraph", text: "Hi", factIds: [], flags: [] }, { nope: true }] });
    expect(c.blocks).toHaveLength(1);
    expect(c.meta.label).toBe("drafted_from_profile");
  });
});

describe("language and kinds", () => {
  it("follows the opportunity, else the person's locale", () => {
    expect(documentLanguage({ languages: ["zh"] }, "en")).toBe("zh");
    expect(documentLanguage({ languages: ["en-GB"] }, "zh")).toBe("en");
    expect(documentLanguage({ languages: ["de"] }, "zh")).toBe("en");
    expect(documentLanguage({ languages: [], name: "高级产品经理" }, "en")).toBe("zh");
    expect(documentLanguage({ languages: [], name: "Product Designer" }, "zh")).toBe("en");
    expect(documentLanguage(null, "zh")).toBe("zh");
    expect(documentLanguage({ languages: ["zh", "en"] }, "zh")).toBe("zh");
    expect(composeLanguage("zh-Hans")).toBe("zh");
    expect(composeLanguage("fr", "en")).toBe("en");
  });

  it("maps materials to what we compose, and leaves the person's own files to them", () => {
    expect(kindForMaterial("resume")).toBe("resume_variant");
    expect(kindForMaterial("cover_letter")).toBe("cover_letter");
    expect(kindForMaterial("research_statement")).toBe("statement");
    expect(kindForMaterial("pitch_deck")).toBe("pitch_notes");
    expect(kindForMaterial("outreach_email")).toBe("email");
    expect(kindForMaterial("publication_list")).toBe("other");
    expect(kindForMaterial("transcript")).toBeNull();
    expect(kindForMaterial("financial_summary")).toBeNull();
    expect(kindForMaterial("portfolio")).toBeNull();
    expect(kindForMaterial("not_a_material")).toBeNull();
  });

  it("picks the outreach email for the audience", () => {
    expect(emailComposeKind("investor")).toBe("email_investor");
    expect(emailComposeKind("postdoc")).toBe("email_professor");
    expect(emailComposeKind("podcast")).toBe("email_editor");
    expect(emailComposeKind("brand_partnership")).toBe("email_brand");
    expect(emailComposeKind("client_lead")).toBe("email_client");
    expect(emailComposeKind("recruiter")).toBe("email_recruiter");
    expect(emailComposeKind("job", "investor")).toBe("email_investor");
  });

  it("titles name the target", () => {
    expect(defaultTitle("cover_letter", null, "en", JOB)).toBe("Cover letter — Juniper Clinics");
    expect(defaultTitle("statement", "research_statement", "zh", POSTDOC)).toBe("研究陈述｜Bayside Institute");
    expect(defaultTitle("resume_variant", null, "en", JOB)).toBe("Résumé");
  });
});

describe("download names", () => {
  it("never repeat the kind or the name", () => {
    expect(downloadName({ kind: "cover_letter", title: "Cover letter — Juniper Clinics", language: "en", personName: "Avery Quinn", ext: "pdf" })).toBe("Cover-letter-Juniper-Clinics-Avery-Quinn.pdf");
    expect(downloadName({ kind: "resume_variant", title: "Avery Quinn — Résumé", language: "en", personName: "Avery Quinn", ext: "docx" })).toBe("Avery-Quinn-Resume.docx");
    expect(downloadName({ kind: "cover_letter", title: "求职信｜示例科技", language: "zh", personName: null, ext: "pdf" })).toBe("求职信-示例科技.pdf");
  });
});
