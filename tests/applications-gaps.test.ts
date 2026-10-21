import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProfile, type ApplicationAnswers, type ApplicationQuestion } from "@/lib/core/types";
import { AnswerError, composeMotivation, computeGaps, isMotivationQuestion, motivationOptions, needsMotivation, normalizeAnswer, openRequired, profileOptions, questionsFromDocumentGaps, type GapInput } from "@/lib/applications/gaps";
import { answerKeyOf, type RequirementsLike } from "@/lib/applications/types";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localAnswerQuestions } from "@/lib/llm/local/answers";
import { localMapFormFields } from "@/lib/llm/local/forms";
import type { FactRef } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const out = localExtractProfile({ documents: [{ id: "doc_resume", kind: "resume", filename: "resume-en.txt", text: fx("resume-en.txt") }], locale: "en", now: "2026-10-21" });
const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
const profile = out.profile;

const OPP = { id: "opp_1", type: "job", name: "Senior Product Designer", orgName: "Juniper Clinics", requiredMaterials: ["resume_variant", "cover_letter"], functions: ["design"], industries: [], tags: ["design systems"], geo: { remote: "remote" as const } };

/** The same opportunity without required materials (isolates one behaviour per test). */
const BARE = { ...OPP, requiredMaterials: [] };

/** The sandbox form, as a channel would describe it. */
const SANDBOX: RequirementsLike = {
  channel: "CH2",
  fields: [
    { name: "full_name", label: "Full name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone", type: "tel", required: false },
    { name: "location", label: "Where are you based?", type: "text", required: true },
    { name: "resume", label: "Résumé (PDF or DOCX)", type: "file", required: true },
    { name: "motivation", label: "Why do you want to join us?", type: "textarea", required: true, question: true },
    { name: "proud_project", label: "Tell us about a project you're proud of", type: "textarea", required: true, question: true },
    { name: "availability", label: "When could you start?", type: "select", required: true, choices: [
      { value: "immediately", label: "Immediately" },
      { value: "2-weeks", label: "Within 2 weeks" },
      { value: "1-month", label: "Within a month" },
    ] },
    { name: "consent", label: "I agree to the processing of my data for this application", type: "checkbox", required: true, userOnly: true },
  ],
  materials: ["resume_variant", "cover_letter"],
  questions: [],
  requiresAccount: false,
  requiresPayment: false,
  captchaLikely: false,
  notes: [],
};

function run(req: RequirementsLike, extra: Partial<GapInput> = {}, p = profile, f = facts) {
  const answersStr = Object.fromEntries(Object.entries(extra.answers ?? {}).map(([k, v]) => [k, String(v.value)]));
  const mappings = localMapFormFields({ fields: req.fields.map((x) => ({ name: x.name, label: x.label, type: x.type, options: x.choices ?? x.options, required: x.required, placeholder: null })), profile: p, facts: f, answers: answersStr, documents: [], language: "en" });
  const long = req.fields.filter((x) => x.type === "textarea");
  const drafts = localAnswerQuestions({ questions: [...req.questions.map((q) => ({ id: q.id, text: q.prompt, type: "long" })), ...long.map((x) => ({ id: x.name, text: x.label, type: "long" }))], profile: p, facts: f, answers: answersStr, language: "en" });
  return computeGaps({ language: "en", opportunity: OPP, requirements: req, mappings, drafts, answers: {}, documentsOnFile: [], profile: p, accountEmail: "avery@example.com", ...extra });
}

describe("computeGaps", () => {
  const r = run(SANDBOX);
  const byField = new Map(r.questions.map((q) => [q.fieldName, q]));

  it("settles what the profile already says, with its sources", () => {
    expect(r.autoAnswers.full_name?.value).toBe("Avery Quinn");
    expect(r.autoAnswers.email?.factIds.length).toBeGreaterThan(0);
    expect(r.autoAnswers.location?.source).toBe("profile");
    expect(byField.has("full_name")).toBe(false);
  });

  it("composes the résumé and cover letter instead of asking for files", () => {
    expect(r.compose.map((c) => c.kind).sort()).toEqual(["cover_letter", "resume_variant"]);
    expect(byField.has("resume")).toBe(false);
  });

  it("asks motivation as chips, never as a drafted text", () => {
    const q = byField.get("motivation")!;
    expect(q.kind).toBe("multi");
    expect(q.options!.length).toBeGreaterThanOrEqual(3);
    expect(q.draft).toBeUndefined();
    expect(isMotivationQuestion(q)).toBe(true);
    // the form's own "why" question covers the cover letter too: no second motivation question
    expect(byField.has("why_this")).toBe(false);
  });

  it("offers the form's own choices for select fields", () => {
    const q = byField.get("availability")!;
    expect(q.kind).toBe("choice");
    expect(q.options!.map((o) => o.value)).toEqual(["immediately", "2-weeks", "1-month"]);
  });

  it("leaves consent to the person as a confirm tap", () => {
    const q = byField.get("consent")!;
    expect(q.kind).toBe("confirm");
    expect(q.required).toBe(true);
  });

  it("drafts long answers from facts the person can keep, else asks", () => {
    const proud = r.autoAnswers.proud_project ?? null;
    const asked = byField.get("proud_project");
    expect(Boolean(proud) || Boolean(asked)).toBe(true);
    if (proud) {
      expect(proud.source).toBe("generated");
      expect(proud.factIds.length).toBeGreaterThan(0);
    } else {
      expect(asked!.kind).toBe("text");
      expect(asked!.draft).toBeTruthy();
    }
  });

  it("asks nothing it already has, and optional short fields are left alone", () => {
    const again = run(SANDBOX, { answers: { motivation: { value: "x", source: "user", factIds: [], confirmed: true, fileKey: null } } });
    expect(again.questions.find((q) => q.fieldName === "motivation")).toBeUndefined();
    expect(r.questions.find((q) => q.fieldName === "phone")).toBeUndefined();
  });

  it("is choice-first even with an empty profile: options from the account and common answers", () => {
    const empty = run(
      { ...SANDBOX, fields: [...SANDBOX.fields, { name: "years", label: "Years of experience", type: "text", required: true }, { name: "work_auth", label: "Are you authorized to work in the US?", type: "text", required: true }] },
      {},
      emptyProfile(),
      [],
    );
    const q = new Map(empty.questions.map((x) => [x.fieldName, x]));
    expect(q.get("email")?.kind).toBe("choice");
    expect(q.get("email")?.options?.[0].value).toBe("avery@example.com");
    expect(q.get("years")?.kind).toBe("choice");
    expect(q.get("work_auth")?.options?.map((o) => o.value)).toEqual(["Yes", "No"]);
    expect(q.get("full_name")?.kind).toBe("text"); // nothing to offer: text is unavoidable
  });

  it("reuses the person's earlier answers to facts about themselves", () => {
    const withPrev = run({ ...SANDBOX, materials: [], fields: [{ name: "start", label: "Earliest start date", type: "text", required: true }] }, { previous: { availability: "In 1 month" }, opportunity: BARE });
    expect(withPrev.autoAnswers.start).toMatchObject({ value: "In 1 month", source: "user", confirmed: true });
    expect(withPrev.questions).toHaveLength(0);
  });

  it("asks for files only the person holds, and attaches ones on record", () => {
    const req: RequirementsLike = { ...SANDBOX, fields: [], materials: ["transcript", "portfolio"] };
    const none = run(req);
    const t = none.questions.find((q) => q.fieldName === "material:transcript")!;
    expect(t.kind).toBe("file");
    expect(t.required).toBe(true);
    expect(none.questions.find((q) => q.fieldName === "material:portfolio")?.required).toBe(false);
    const onFile = run(req, { documentsOnFile: [{ id: "doc_t", kind: "transcript" }] });
    expect(onFile.attach).toEqual([{ field: "material:transcript", documentId: "doc_t" }]);
    expect(onFile.questions.find((q) => q.fieldName === "material:transcript")).toBeUndefined();
  });

  it("asks the motivation once for a cover letter when the form has no why-question", () => {
    const req: RequirementsLike = { ...SANDBOX, fields: SANDBOX.fields.filter((f) => f.name !== "motivation") };
    const res = run(req);
    const q = res.questions.find((x) => x.fieldName === "why_this")!;
    expect(q.kind).toBe("multi");
    expect(q.prompt).toContain("Juniper Clinics");
  });

  it("asks the speaker for their own talk", () => {
    const res = run({ ...SANDBOX, fields: [], materials: ["talk_proposal", "speaker_bio"] }, { opportunity: BARE });
    expect(res.compose.map((c) => `${c.kind}:${c.material}`)).toEqual(["proposal:talk_proposal", "bio:speaker_bio"]);
    expect(res.questions.find((q) => q.fieldName === "talk_abstract")?.kind).toBe("text");
  });

  it("composes outreach email only on the email channel", () => {
    expect(run({ ...SANDBOX, fields: [], materials: ["outreach_email"] }, { opportunity: BARE }).compose).toEqual([]);
    expect(run({ ...SANDBOX, channel: "CH4", fields: [], materials: [] }, { outreach: true, opportunity: BARE }).compose).toEqual([{ kind: "email", material: "outreach_email" }]);
  });

  it("organiser questions: motivation as chips, others drafted or asked", () => {
    const res = run({ ...SANDBOX, fields: [], materials: [], questions: [{ id: "q1", prompt: "Why are you interested in Juniper?" }, { id: "q2", prompt: "Describe your experience with design systems." }] });
    const q1 = res.questions.find((q) => q.fieldName === "q1")!;
    expect(q1.kind).toBe("multi");
    const q2 = res.autoAnswers.q2 ?? res.questions.find((q) => q.fieldName === "q2");
    expect(q2).toBeTruthy();
  });
});

describe("motivation", () => {
  it("offers first-person reasons built from the opportunity and the profile", () => {
    const opts = motivationOptions(OPP, profile, "en");
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts.some((o) => o.value.includes("Juniper Clinics"))).toBe(true);
    expect(opts.some((o) => o.value.includes("remote"))).toBe(true);
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
    const zh = motivationOptions({ ...OPP, orgName: "示例科技" }, profile, "zh");
    expect(zh.every((o) => /[一-鿿]/.test(o.value))).toBe(true);
  });

  it("turns chosen reasons into one sentence", () => {
    expect(composeMotivation(["It builds directly on my work as a designer", "I want to work in healthcare"], "en")).toBe("I'm applying because it builds directly on my work as a designer, and I want to work in healthcare.");
    expect(composeMotivation(["I believe in what Acme is building."], "en")).toBe("I'm applying because I believe in what Acme is building.");
    expect(composeMotivation(["远程的工作方式适合我"], "zh")).toBe("我申请的原因是：远程的工作方式适合我。");
    expect(composeMotivation([], "en")).toBe("");
  });

  it("knows which documents need it", () => {
    expect(needsMotivation([{ kind: "cover_letter", material: "cover_letter" }], false)).toBe(true);
    expect(needsMotivation([{ kind: "statement", material: "research_statement" }], false)).toBe(false);
    expect(needsMotivation([{ kind: "proposal", material: "business_plan" }], true)).toBe(false);
    expect(needsMotivation([{ kind: "proposal", material: "project_proposal" }], false)).toBe(true);
    expect(needsMotivation([{ kind: "resume_variant", material: "resume" }], false)).toBe(false);
  });
});

describe("answering", () => {
  const choice: ApplicationQuestion = { id: "field:availability", fieldName: "availability", prompt: "When could you start?", kind: "choice", options: [{ value: "immediately", label: "Immediately" }, { value: "1-month", label: "Within a month" }], why: "x", required: true };
  const multiWhy: ApplicationQuestion = { id: "field:motivation", fieldName: "motivation", prompt: "Why do you want to join us?", kind: "multi", options: [{ value: "I want to work in healthcare", label: "I want to work in healthcare" }, { value: "The remote setup fits how I work", label: "The remote setup fits how I work" }], why: "x", required: true };

  it("accepts only offered options (or the person's own words)", () => {
    expect(normalizeAnswer(choice, { value: "1-month" }, "en")).toMatchObject({ value: "1-month", source: "user", confirmed: true });
    expect(() => normalizeAnswer(choice, { value: "tomorrow" }, "en")).toThrow(AnswerError);
    expect(normalizeAnswer(choice, { value: null, custom: "After my notice period (6 weeks)" }, "en").value).toBe("After my notice period (6 weeks)");
    expect(() => normalizeAnswer(choice, { value: null }, "en")).toThrow(AnswerError);
  });

  it("motivation picks become a sentence in the person's voice", () => {
    const a = normalizeAnswer(multiWhy, { value: ["I want to work in healthcare", "The remote setup fits how I work"] }, "en");
    expect(a.value).toBe("I'm applying because I want to work in healthcare, and the remote setup fits how I work.");
    expect(a.factIds).toEqual([]);
    const own = normalizeAnswer(multiWhy, { value: [], custom: "Your intake work is the problem I keep coming back to." }, "en");
    expect(own.value).toBe("Your intake work is the problem I keep coming back to.");
  });

  it("text: keeping the draft is still the person's confirmation", () => {
    const q: ApplicationQuestion = { id: "q:1", fieldName: "q1", prompt: "Describe a project", kind: "text", why: "x", required: true, draft: "I built a design system." };
    expect(normalizeAnswer(q, { value: "I built a design system.", source: "generated" }, "en")).toMatchObject({ source: "generated", confirmed: true });
    expect(normalizeAnswer(q, { value: "I built a design system for 5 teams." }, "en")).toMatchObject({ source: "user", confirmed: true });
    expect(() => normalizeAnswer(q, { value: "   " }, "en")).toThrow(AnswerError);
  });

  it("consent needs a yes; files need a file", () => {
    const consent: ApplicationQuestion = { id: "field:consent", fieldName: "consent", prompt: "I agree", kind: "confirm", options: [{ value: "yes", label: "I agree" }], why: "x", required: true };
    expect(normalizeAnswer(consent, { value: true }, "en").value).toBe("yes");
    expect(() => normalizeAnswer(consent, { value: false }, "en")).toThrow(AnswerError);
    const file: ApplicationQuestion = { id: "material:transcript", fieldName: "material:transcript", prompt: "Upload", kind: "file", why: "x", required: true };
    expect(() => normalizeAnswer(file, {}, "en")).toThrow(AnswerError);
    expect(normalizeAnswer(file, { documentId: "doc_1", fileKey: "docs/u/doc_1.pdf" }, "en")).toMatchObject({ value: "doc_1", fileKey: "docs/u/doc_1.pdf" });
  });

  it("tracks what is still open", () => {
    const answers: ApplicationAnswers = { availability: { value: "1-month", source: "user", factIds: [], confirmed: true, fileKey: null } };
    const optional: ApplicationQuestion = { ...choice, id: "field:x", fieldName: "x", required: false };
    expect(openRequired([choice, multiWhy, optional], answers).map(answerKeyOf)).toEqual(["motivation"]);
  });

  it("document gaps become questions, optional ones never block", () => {
    const qs = questionsFromDocumentGaps(
      [
        { key: "name", question: "What name should we sign with?" },
        { key: "proud_why", question: "Why does this project matter to you? (optional)" },
      ],
      {},
      "en",
    );
    expect(qs.map((q) => q.fieldName)).toEqual(["name"]);
  });

  it("profile options come from what the profile holds", () => {
    expect(profileOptions("email", profile, "avery@example.com").map((o) => o.value)).toContain("avery.quinn@example.com");
    expect(profileOptions("school", profile).length).toBeGreaterThan(0);
    expect(profileOptions("unknown_key", profile)).toEqual([]);
  });
});
