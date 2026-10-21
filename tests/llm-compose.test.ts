import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedContentSchema } from "@/lib/core/types";
import { localAnswerQuestions } from "@/lib/llm/local/answers";
import { classifyQuestion, localCompose } from "@/lib/llm/local/compose";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { COMPOSE_KINDS, ComposedDocument, toGeneratedContent, type ComposeKind, type FactRef, type OpportunityInput } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-10-21";

function profileOf(file: string, kind: "resume" | "cv" | "deck", locale: "en" | "zh" = "en") {
  const out = localExtractProfile({ documents: [{ id: `doc_${file}`, kind, filename: file, text: fx(file) }], locale, now: NOW });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${String(i).padStart(3, "0")}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

const PEOPLE = {
  designer: { ...profileOf("resume-en.txt", "resume"), opp: { id: "opp_job", type: "job", name: "Senior Product Designer", orgName: "Juniper Clinics", summary: "Design patient intake flows; own the design system.", tags: ["design systems", "figma", "healthcare"] } as OpportunityInput },
  pm_zh: { ...profileOf("resume-zh.txt", "resume", "zh"), opp: { id: "opp_zh", type: "job", name: "高级产品经理", orgName: "示例科技", summary: "负责 SaaS 审批与协同产品" } as OpportunityInput },
  founder: { ...profileOf("deck-founder.txt", "deck"), opp: { id: "opp_vc", type: "investor", name: "Harbor Seed Fund", orgName: "Harbor Seed Fund", tags: ["fintech", "smb"] } as OpportunityInput },
  researcher: { ...profileOf("cv-researcher.txt", "cv"), opp: { id: "opp_pd", type: "postdoc", name: "Postdoc in coastal remote sensing", orgName: "Bayside Institute", tags: ["remote sensing", "wetlands"] } as OpportunityInput },
};

/** The honesty invariants every composed document must satisfy. */
function assertHonest(doc: ComposedDocument, facts: FactRef[], answers: Record<string, string> = {}) {
  ComposedDocument.parse(doc);
  const known = new Set([...facts.map((f) => f.id), ...Object.keys(answers).map((k) => `answer:${k}`)]);
  for (const b of doc.blocks) {
    if (b.role === "body") {
      // Never a claim without a source.
      expect(b.factIds.length, `unsourced body block: "${b.text}"`).toBeGreaterThan(0);
      expect(b.flags).not.toContain("unsourced");
    }
    for (const id of b.factIds) expect(known.has(id), `unknown fact id ${id}`).toBe(true);
    if (b.role === "gap") {
      expect(b.flags).toContain("needs_confirmation");
      expect(b.factIds).toEqual([]);
    }
    if (b.role !== "gap") expect(b.text).not.toMatch(/^\[|^【/);
    expect(b.text.trim().length).toBeGreaterThan(0);
  }
  expect(doc.gaps.length).toBeGreaterThanOrEqual(doc.blocks.filter((b) => b.role === "gap").length > 0 ? 1 : 0);
  expect(new Set(doc.factIds)).toEqual(new Set(doc.blocks.flatMap((b) => b.factIds)));
  // Storable as F2's GeneratedContent.
  expect(generatedContentSchema.parse(toGeneratedContent(doc)).blocks).toHaveLength(doc.blocks.length);
}

describe("compose: honesty invariants for every kind and every kind of person", () => {
  for (const [who, person] of Object.entries(PEOPLE)) {
    for (const kind of COMPOSE_KINDS) {
      it(`${who} · ${kind}`, () => {
        const lang = who === "pm_zh" ? "zh" : "en";
        const doc = localCompose({ kind: kind as ComposeKind, profile: person.profile, facts: person.facts, opportunity: person.opp, language: lang, question: kind === "answer" ? "Tell us about yourself" : undefined, contact: { name: "Rosa Lindqvist" }, previous: kind === "email_follow_up" ? { subject: "Intro", sentAt: "2026-10-14" } : null, now: NOW });
        assertHonest(doc, person.facts);
        expect(doc.label).toBe("drafted_from_profile");
        expect(doc.language).toBe(lang);
      });
    }
  }
});

describe("cover letter", () => {
  const { profile, facts, opp } = PEOPLE.designer;

  it("cites the right facts, quotes the person's own results and leaves motivation to them", () => {
    const doc = localCompose({ kind: "cover_letter", profile, facts, opportunity: opp, language: "en", now: NOW });
    const text = doc.blocks.map((b) => b.text).join("\n");
    expect(doc.blocks[0]).toMatchObject({ role: "greeting", text: "Dear Juniper Clinics team," });
    expect(text).toContain("I'm writing to apply for the Senior Product Designer position at Juniper Clinics.");
    expect(text).toContain("I'm currently a Senior Product Designer at Quillfeather Health");
    expect(text).toContain("I led the redesign of the patient intake flow, cutting average completion time from 14 to 6 minutes");
    expect(doc.gaps.map((g) => g.key)).toContain("why_this");
    expect(doc.blocks.find((b) => b.role === "signature")?.text).toContain("Avery Quinn");
    const expFact = facts.find((f) => f.path.startsWith("/experience/") && f.claim.startsWith("Senior Product Designer"))!;
    expect(doc.blocks.find((b) => b.text.includes("led the redesign"))?.factIds).toContain(expFact.id);
  });

  it("uses the person's own answer verbatim instead of a gap", () => {
    const answers = { why_this: "Juniper's community clinics are where I get care myself, and I want intake to be painless there." };
    const doc = localCompose({ kind: "cover_letter", profile, facts, opportunity: opp, answers, language: "en", now: NOW });
    assertHonest(doc, facts, answers);
    expect(doc.gaps.map((g) => g.key)).not.toContain("why_this");
    expect(doc.blocks.find((b) => b.factIds.includes("answer:why_this"))?.text).toBe(answers.why_this);
  });

  it("respects the word budget by trimming lower-priority claims", () => {
    const long = localCompose({ kind: "cover_letter", profile, facts, opportunity: opp, language: "en", now: NOW });
    const short = localCompose({ kind: "cover_letter", profile, facts, opportunity: opp, language: "en", maxWords: 120, now: NOW });
    expect(short.wordCount).toBeLessThan(long.wordCount);
    expect(short.blocks.filter((b) => b.role === "body").length).toBeGreaterThan(0);
    assertHonest(short, facts);
  });

  it("writes in Chinese for a Chinese profile", () => {
    const { profile: p, facts: f, opp: o } = PEOPLE.pm_zh;
    const doc = localCompose({ kind: "cover_letter", profile: p, facts: f, opportunity: o, language: "zh", now: NOW });
    const text = doc.blocks.map((b) => b.text).join("\n");
    expect(text).toContain("我目前在上海云帆数字科技有限公司担任产品经理");
    expect(text).toContain("此致");
    expect(doc.gaps[0].question).toMatch(/吸引你/);
  });

  it("quotes lines in another language and says so", () => {
    const doc = localCompose({ kind: "cover_letter", profile, facts, opportunity: opp, language: "zh", now: NOW });
    expect(doc.notes.join(" ")).toMatch(/翻译/);
    expect(doc.blocks.some((b) => b.text.includes("「Led the redesign"))).toBe(true);
    assertHonest(doc, facts);
  });

  it("with no facts, writes nothing about the person — only gaps", () => {
    const doc = localCompose({ kind: "cover_letter", profile, facts: [], opportunity: opp, language: "en", now: NOW });
    assertHonest(doc, []);
    expect(doc.blocks.some((b) => b.role === "body")).toBe(false);
    expect(doc.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["why_this", "name"]));
  });

  it("ignores facts whose quote couldn't be verified (low confidence)", () => {
    const weak = facts.map((f) => ({ ...f, confidence: 0.2 }));
    const doc = localCompose({ kind: "bio", profile, facts: weak, language: "en", now: NOW });
    expect(doc.blocks.some((b) => b.role === "body")).toBe(false);
  });
});

describe("founder and researcher documents", () => {
  it("investor email: company, problem, traction, team and ask, each sourced; why-this-investor is a gap", () => {
    const { profile, facts, opp } = PEOPLE.founder;
    const doc = localCompose({ kind: "email_investor", profile, facts, opportunity: opp, language: "en", now: NOW });
    const text = doc.blocks.map((b) => b.text).join("\n");
    expect(doc.blocks[0]).toMatchObject({ role: "subject", type: "field" });
    expect(doc.blocks[0].text).toContain("Tallyfern");
    expect(text).toContain("Traction so far: 41 paying restaurants across Austin and Houston");
    expect(text).toContain("We're raising $1.5M");
    expect(text).toContain("Maya Okafor (CEO & Co-founder");
    expect(doc.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["why_investor", "name"]));
  });

  it("one-pager for a founder has headings and sourced bullets", () => {
    const { profile, facts } = PEOPLE.founder;
    const doc = localCompose({ kind: "one_pager", profile, facts, language: "en", now: NOW });
    expect(doc.blocks.filter((b) => b.role === "heading").map((b) => b.text)).toEqual(expect.arrayContaining(["Tallyfern", "Problem", "Traction", "Team", "The ask"]));
    expect(doc.blocks.filter((b) => b.type === "bullet").every((b) => b.factIds.length === 1)).toBe(true);
  });

  it("professor email cites research areas and publications, and asks for the specific interest", () => {
    const { profile, facts, opp } = PEOPLE.researcher;
    const doc = localCompose({ kind: "email_professor", profile, facts, opportunity: opp, contact: { name: "Rosa Lindqvist" }, language: "en", now: NOW });
    const text = doc.blocks.map((b) => b.text).join("\n");
    expect(doc.blocks.find((b) => b.role === "greeting")?.text).toBe("Dear Professor Lindqvist,");
    expect(text).toContain("My research focuses on salt-marsh resilience");
    expect(text).toMatch(/Relevant work includes "/);
    expect(doc.gaps.map((g) => g.key)).toContain("research_interest");
  });

  it("third-person bio uses the first name, never a pronoun", () => {
    const { profile, facts } = PEOPLE.designer;
    const doc = localCompose({ kind: "bio", profile, facts, language: "en", now: NOW });
    const text = doc.blocks.map((b) => b.text).join(" ");
    expect(text).toMatch(/^Avery Quinn is a Senior Product Designer at Quillfeather Health\./);
    expect(text).toContain("At Quillfeather Health, Avery led the redesign");
    expect(text.match(/Northwind Lending/g)?.length).toBe(1);
    expect(text).not.toMatch(/\b(he|she|his|her)\b/i);
  });
});

describe("application answers", () => {
  it("classifies common questions (English and Chinese)", () => {
    expect(classifyQuestion("Why do you want to join us?")).toBe("why_this");
    expect(classifyQuestion("Tell us about a project you're proud of")).toBe("proud_project");
    expect(classifyQuestion("Describe your startup in one sentence")).toBe("startup_description");
    expect(classifyQuestion("How will you use the funds?")).toBe("use_of_funds");
    expect(classifyQuestion("When can you start?")).toBe("availability");
    expect(classifyQuestion("请做一下自我介绍")).toBe("about_you");
    expect(classifyQuestion("你们的团队有哪些人？")).toBe("team");
    expect(classifyQuestion("What's your favourite colour?")).toBe("other");
  });

  it("answers factual and open questions from facts; motivation needs the person", () => {
    const { profile, facts, opp } = PEOPLE.designer;
    const answers = localAnswerQuestions({
      questions: [
        { id: "q1", text: "Email address", type: "email" },
        { id: "q2", text: "Current company" },
        { id: "q3", text: "Tell us about a project you're proud of", type: "long" },
        { id: "q4", text: "Why do you want to work at Juniper Clinics?", type: "long" },
        { id: "q5", text: "Gender", type: "choice", options: ["Woman", "Man", "Non-binary", "Prefer not to say"] },
        { id: "q6", text: "Desired salary" },
      ],
      profile,
      facts,
      opportunity: opp,
      language: "en",
    });
    const by = Object.fromEntries(answers.map((a) => [a.questionId, a]));
    expect(by.q1).toMatchObject({ answer: "avery.quinn@example.com", needsUser: false });
    expect(by.q1.factIds.length).toBe(1);
    expect(by.q2).toMatchObject({ answer: "Quillfeather Health", needsUser: false });
    expect(by.q3.answer).toMatch(/Pocket Pantry/);
    expect(by.q3.factIds.length).toBeGreaterThan(0);
    expect(by.q4.needsUser).toBe(true);
    expect(by.q4.reason).toMatch(/own words/);
    expect(by.q5).toMatchObject({ answer: null, needsUser: true });
    expect(by.q6).toMatchObject({ answer: null, needsUser: true });
  });

  it("founder questions come from the deck", () => {
    const { profile, facts } = PEOPLE.founder;
    const [traction, team, funds] = localAnswerQuestions({
      questions: [
        { id: "t", text: "What traction do you have?", type: "long" },
        { id: "m", text: "Who is on your team?", type: "long" },
        { id: "u", text: "How will you use the funds?", type: "long" },
      ],
      profile,
      facts,
      language: "en",
    });
    expect(traction.answer).toContain("$73K ARR");
    expect(traction.needsUser).toBe(false);
    expect(team.answer).toContain("Dev Raman");
    expect(funds.answer).toContain("50% engineering");
  });
});
