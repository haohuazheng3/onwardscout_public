import { describe, expect, it } from "vitest";
import { mockIntelligence } from "@/lib/llm/provider-mock";
import { localIntelligence } from "@/lib/llm/provider-local";
import { BrowserStep, ComposedDocument, ExtractProfileOutput, FieldMapping, MatchScore, NormalizedOpportunity, QuestionAnswer, ReplyClassification } from "@/lib/llm/types";

describe("mock provider (tests only)", () => {
  it("returns schema-valid, deterministic output for every method", async () => {
    const ex = await mockIntelligence.extractProfile({ documents: [{ id: "doc_1", kind: "resume", filename: "r.txt", text: "Morgan Example\nProduct Analyst" }], locale: "en" });
    ExtractProfileOutput.parse(ex);
    expect(ex.profile.identity.name).toBe("Morgan Example");
    expect(ex.facts.every((f) => f.sourceDocId === "doc_1")).toBe(true);
    const facts = ex.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim }));
    NormalizedOpportunity.parse(await mockIntelligence.normalizeOpportunity({ url: "https://example.org" }));
    const scores = await mockIntelligence.scoreMatches({ profile: ex.profile, goals: [], opportunities: [{ id: "o1", type: "job", name: "x" }] });
    expect(scores.map((s) => MatchScore.parse(s).fit)).toEqual((await mockIntelligence.scoreMatches({ profile: ex.profile, goals: [], opportunities: [{ id: "o1", type: "job", name: "x" }] })).map((s) => s.fit));
    const doc = ComposedDocument.parse(await mockIntelligence.compose({ kind: "email_recruiter", profile: ex.profile, facts }));
    expect(doc.blocks.filter((b) => b.role === "body").every((b) => b.factIds.length > 0)).toBe(true);
    (await mockIntelligence.answerQuestions({ questions: [{ id: "q", text: "Why?" }], profile: ex.profile, facts })).forEach((a) => QuestionAnswer.parse(a));
    ReplyClassification.parse(await mockIntelligence.classifyReply({ text: "Unfortunately no" }));
    (await mockIntelligence.mapFormFields({ fields: [{ name: "consent", type: "checkbox" }], profile: ex.profile })).forEach((f) => expect(FieldMapping.parse(f).needsUser).toBe(true));
    BrowserStep.parse(await mockIntelligence.planBrowserStep({ goal: "g", pageSummary: "", axTree: "" }));
  });

  it("local provider implements the same interface", async () => {
    expect(localIntelligence.provider).toBe("local");
    const r = await localIntelligence.classifyReply({ text: "Let's set up a call" });
    expect(r.classification).toBe("meeting");
  });
});
