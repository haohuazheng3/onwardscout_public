import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALWAYS_PREPARED, computeGaps, hasStaleQuestions, missingFiles, normalizeAnswer, AnswerError, openRequired, questionsFromDocumentGaps } from "@/lib/applications/gaps";
import { fileItems, fileName, filesBlockConfirm, isLinkAnswer, laterMaterial } from "@/lib/applications/materials";
import { planPrepareStep } from "@/lib/applications/plan";
import type { RequirementsLike } from "@/lib/applications/types";
import { emptyProfile, type ApplicationQuestion, type Profile } from "@/lib/core/types";
import { buildDocument } from "@/lib/documents/build";
import { isGapBlock, plainText } from "@/lib/documents/content";
import { deckSlides } from "@/lib/documents/deck";
import { classifySpot, fillPlaceholder, listedOptions, profileSpotKey } from "@/lib/documents/spots";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localIntelligence } from "@/lib/llm/provider-local";
import type { ComposedBlock, ComposedDocument, FactRef, Intelligence, OpportunityInput } from "@/lib/llm/types";

/*
 * "Apply for me" must land in a room where the AI has done what it can and asks only a few
 * short things (production 2026-11-02: 11 applications, none submitted, 8 stuck in needs_info
 * behind walls of questions). Regressions for: profile values never asked, idea/team/track spots
 * folded into one question each, files that never hold the drafts back, and an application with
 * only optional or later items moving on to "ready".
 */

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = new Date("2026-11-02");

function person() {
  const out = localExtractProfile({ documents: [{ id: "doc_resume", kind: "resume", filename: "resume.txt", text: fx("resume-en.txt") }], locale: "en", now: "2026-11-02" });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

const KHACKS: OpportunityInput = { id: "opp_khacks", type: "hackathon", name: "K! Hacks 4.0", orgName: "CEG Tech Forum", requiredMaterials: ["application_form", "pitch_deck"], tags: ["hackathon", "agentic ai", "fintech"] };

/** A writer that answers like Claude did for K! Hacks: one gap per thing it lacked, each with its own key. */
function writer(blocks: Array<Partial<ComposedBlock> & { text: string }>, gaps: { key: string; question: string }[]): Pick<Intelligence, "compose" | "provider"> {
  const doc: ComposedDocument = {
    format: "blocks",
    kind: "pitch_deck",
    language: "en",
    title: "Pitch deck",
    blocks: blocks.map((b) => ({ type: b.type ?? "paragraph", role: b.role ?? "body", text: b.text, factIds: b.factIds ?? [], flags: b.flags ?? [], ...(b.label ? { label: b.label } : {}) })),
    gaps,
    notes: [],
    factIds: [],
    wordCount: 0,
    label: "written_with_ai",
  };
  return { provider: "anthropic", compose: async () => doc } as unknown as Pick<Intelligence, "compose" | "provider">;
}

const gap = (text: string, type: ComposedBlock["type"] = "paragraph") => ({ type, role: "gap" as const, text, flags: ["needs_confirmation" as const] });

/** Claude's K! Hacks deck (production): seven spots plus the presenter's name the profile already had. */
const KHACKS_GAPS = [
  { key: "project_name", question: "What is the name of your project or team?" },
  { key: "one_liner", question: "Describe the idea in one line." },
  { key: "presenter_name", question: "What is your full name?" },
  { key: "presenter_role", question: "What is your role in the team?" },
  { key: "track", question: "Which of the six K! Hacks domains is the idea for?" },
  { key: "problem", question: "What problem does the idea solve, and for whom?" },
  { key: "solution", question: "How does your solution work?" },
  { key: "teammates", question: "Who are your teammates?" },
];
const KHACKS_BLOCKS = [
  gap("[Project name]", "heading"),
  gap("[One-line description]"),
  gap("[Your full name]", "bullet"),
  gap("[Your role]", "bullet"),
  gap("[Domain]"),
  { type: "heading" as const, role: "heading" as const, text: "The problem" },
  gap("[The problem]"),
  { type: "heading" as const, role: "heading" as const, text: "Our solution" },
  gap("[How it works]"),
  { type: "heading" as const, role: "heading" as const, text: "Team" },
  gap("[Teammates]", "bullet"),
];

describe("spots: what a writer's gap really asks for", () => {
  const idea = { idea: true, slides: true };
  it("folds a hackathon deck's spots into the idea, the team and the track", () => {
    const keys = KHACKS_GAPS.map((g) => classifySpot(g, idea));
    expect(keys.map((s) => s.key)).toEqual(["idea", "idea", "full_name", "team", "track", "idea", "idea", "team"]);
    expect(classifySpot({ key: "x", question: "What's your project called?" }, idea).key).toBe("idea");
    expect(classifySpot({ key: "x", question: "你的项目叫什么名字？" }, idea).key).toBe("idea");
    expect(classifySpot({ key: "x", question: "Which track are you entering?" }, idea).key).toBe("track");
  });

  it("never folds the reasons for applying, and folds nothing outside a project or a startup", () => {
    expect(classifySpot({ key: "why_this", question: "Why are you applying?" }, idea).kind).toBe("own");
    expect(classifySpot({ key: "draw", question: "What draws you to the K! Hacks idea round?" }, idea).kind).toBe("own");
    expect(classifySpot({ key: "problem", question: "What problem are you solving?" }, { idea: false }).kind).toBe("own");
  });

  it("knows a profile value by its key or a short question, never by a writing task", () => {
    expect(profileSpotKey("presenter_name", "Presenter")).toBe("full_name");
    expect(profileSpotKey("applicant_email", "Email")).toBe("email");
    expect(profileSpotKey("uni", "Which university do you attend?")).toBe("school");
    expect(profileSpotKey("note", "Write the email you'd send to a judge")).toBeNull();
    expect(profileSpotKey("team_name", "What is your team name?")).toBeNull();
    expect(profileSpotKey("x", "项目名字是什么？")).toBeNull();
  });

  it("offers a track only when the organiser's own list is in the question", () => {
    expect(listedOptions("Which track will you enter: Agentic AI, FinTech or Health Tech?")).toEqual(["Agentic AI", "FinTech", "Health Tech"]);
    expect(listedOptions("Which domain is it for? (Agentic AI / FinTech / Health Tech)")).toEqual(["Agentic AI", "FinTech", "Health Tech"]);
    expect(listedOptions("Which of the six domains (incl. Agentic AI, FinTech, Health Tech) is it for?")).toEqual([]);
    expect(listedOptions("Which of the six K! Hacks domains is the idea for?")).toEqual([]);
  });

  it("fills a placeholder, never leaving a second one behind as if it were filled", () => {
    expect(fillPlaceholder("[Your full name]", "Avery Quinn")).toBe("Avery Quinn");
    expect(fillPlaceholder("Presented by [your name]", "Avery Quinn")).toBe("Presented by Avery Quinn");
    expect(fillPlaceholder("[Your name] · [Your role]", "Avery Quinn")).toBeNull();
  });
});

describe("documents: the K! Hacks deck", () => {
  const p = person();

  it("fills the presenter's name from the profile (cited), never asking it", async () => {
    const built = await buildDocument({ ai: writer(KHACKS_BLOCKS, KHACKS_GAPS), kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", now: NOW });
    const name = p.profile.identity.name!;
    const filled = built.content.blocks.find((b) => b.text === name);
    expect(filled).toBeTruthy();
    expect(isGapBlock(filled!)).toBe(false);
    expect(filled!.factIds.length).toBeGreaterThan(0);
    expect(filled!.factIds.every((id) => p.facts.some((f) => f.id === id))).toBe(true);
    expect(built.gaps.map((g) => g.key)).not.toContain("full_name");
    expect(built.gaps.map((g) => g.key)).not.toContain("presenter_name");
  });

  it("asks two things, not seven: the idea once and the team once (the unlisted track is picked on the form)", async () => {
    const built = await buildDocument({ ai: writer(KHACKS_BLOCKS, KHACKS_GAPS), kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", now: NOW });
    expect([...new Set(built.gaps.map((g) => g.key))]).toEqual(["idea", "team"]);
    // Every spot left is still paired with its question; the track's placeholder is gone.
    for (const b of built.content.blocks.filter(isGapBlock)) expect(built.content.meta.gaps.some((g) => g.question === b.label)).toBe(true);
    expect(plainText(built.content)).not.toContain("[Domain]");
    const qs = questionsFromDocumentGaps(built.gaps, {}, "en", { profile: p.profile });
    expect(qs.map((q) => q.fieldName)).toEqual(["idea", "team"]);
    expect(qs[0].prompt).toMatch(/What are you building/);
    expect(qs[1].kind).toBe("choice");
    expect(qs[1].options?.length).toBe(3);
    expect(questionsFromDocumentGaps(built.gaps, {}, "en", { oppType: "hackathon" })[1].options?.[0].value).toBe("Just me — I'm going solo");
    expect(questionsFromDocumentGaps(built.gaps, {}, "en", { oppType: "accelerator" })[1].options?.[0].value).toBe("I'm a solo founder");
  });

  it("asks the track as one tap when the organiser's options are known", async () => {
    const gaps = KHACKS_GAPS.map((g) => (g.key === "track" ? { ...g, question: "Which domain is the idea for? (Agentic AI / FinTech / Health Tech)" } : g));
    const built = await buildDocument({ ai: writer(KHACKS_BLOCKS, gaps), kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", now: NOW });
    const track = questionsFromDocumentGaps(built.gaps, {}, "en").find((q) => q.fieldName === "track");
    expect(track?.kind).toBe("choice");
    expect(track?.options?.map((o) => o.value)).toEqual(["Agentic AI", "FinTech", "Health Tech"]);
  });

  it("once the idea and the team are answered, a spot the writer still leaves is dropped (and its empty slide), not asked again", async () => {
    const after = writer(
      [
        gap("[Project name]", "heading"),
        { type: "paragraph", text: "An agent that reconciles a shop's UPI payments every night.", factIds: ["answer:idea"] },
        { type: "heading", role: "heading", text: "Team" },
        gap("[Teammates]", "bullet"),
      ],
      [
        { key: "project_name", question: "What is the project called?" },
        { key: "teammates", question: "Who are your teammates?" },
      ],
    );
    const answers = { idea: "An agent that reconciles a shop's UPI payments every night.", team: "Just me — I'm going solo" };
    const built = await buildDocument({ ai: after, kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", answers, now: NOW });
    expect(built.gaps).toEqual([]);
    expect(built.content.blocks.some(isGapBlock)).toBe(false);
    expect(deckSlides(built.content.blocks, "Overview").map((s) => s.title)).not.toContain("Team");
    expect(questionsFromDocumentGaps(built.gaps, {}, "en")).toEqual([]);
  });

  it("the local engine: one idea question, then a deck built from the person's sentence", async () => {
    const before = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", now: NOW });
    expect(before.gaps.map((g) => g.key)).toEqual(["idea"]);
    const idea = "A voice assistant that books clinic visits for patients who can't type";
    const after = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", material: "pitch_deck", profile: p.profile, facts: p.facts, opportunity: KHACKS, language: "en", answers: { idea }, now: NOW });
    expect(after.gaps).toEqual([]);
    expect(after.content.blocks.some(isGapBlock)).toBe(false);
    const said = after.content.blocks.find((b) => b.text.startsWith("A voice assistant"));
    expect(said?.factIds).toEqual(["answer:idea"]);
    // No slide is left with nothing on it.
    for (const s of deckSlides(after.content.blocks, "Overview")) expect(s.items.length).toBeGreaterThan(0);
    // Every source is a fact or the person's answer.
    for (const b of after.content.blocks) for (const id of b.factIds) expect(id === "answer:idea" || p.facts.some((f) => f.id === id)).toBe(true);
  });

  it("a name the profile holds without a source is one tap to confirm, an unknown one is typed", () => {
    const profile: Profile = { ...emptyProfile(), identity: { ...emptyProfile().identity, name: "Priya Raman" } };
    const [tap] = questionsFromDocumentGaps([{ key: "full_name", question: "What is your full name?" }], {}, "en", { profile });
    expect(tap).toMatchObject({ fieldName: "full_name", kind: "choice", options: [{ value: "Priya Raman", label: "Priya Raman" }] });
    const [typed] = questionsFromDocumentGaps([{ key: "full_name", question: "What is your full name?" }], {}, "en", { profile: emptyProfile() });
    expect(typed.kind).toBe("text");
  });

  it("offers the person's own projects as one-tap ideas", () => {
    const profile: Profile = { ...emptyProfile(), projects: [{ id: "prj_1", name: "Tidepool", role: null, url: null, startDate: null, endDate: null, summary: "A tide-pool field guide that identifies species from a photo.", highlights: [], skills: [] }] };
    const [q] = questionsFromDocumentGaps([{ key: "idea", question: "What's the project?" }], {}, "en", { profile });
    expect(q.kind).toBe("choice");
    expect(q.options?.[0].value).toBe("Tidepool: A tide-pool field guide that identifies species from a photo.");
    expect(normalizeAnswer(q, { value: null, custom: "Something new: a study planner" }, "en").value).toBe("Something new: a study planner");
  });
});

/* ------------------------------------------------------------------ files never hold the drafts back */

const handoff = (materials: string[]): RequirementsLike => ({ channel: "CH6", fields: [], materials, questions: [], requiresAccount: true, requiresPayment: false, captchaLikely: false, notes: [] });

function gapsFor(opp: { id: string; type: string; name: string; requiredMaterials: string[] }) {
  return computeGaps({ language: "en", opportunity: opp, requirements: handoff(opp.requiredMaterials), mappings: [], drafts: [], answers: {}, documentsOnFile: [], profile: person().profile });
}

describe("files only the person holds", () => {
  it("a hackathon's demo video and project are later items, never open questions", () => {
    const otari = gapsFor({ id: "opp_otari", type: "hackathon", name: "Mozilla Otari Hackathon", requiredMaterials: ["work_samples", "demo_video"] });
    const files = otari.questions.filter((q) => q.kind === "file");
    expect(files.map((q) => q.fieldName).sort()).toEqual(["material:demo_video", "material:work_samples"]);
    expect(files.every((q) => q.required === false)).toBe(true);
    expect(files.find((q) => q.fieldName === "material:demo_video")?.prompt).toBe("Your product demo video, when it's ready");
    expect(openRequired(otari.questions, {})).toEqual([]);
    expect(missingFiles(otari.questions, {})).toEqual([]);
    expect(fileItems(otari.questions, "hackathon").later).toHaveLength(2);
    // …and the AI still drafts what it can: the deck the judges see.
    expect(otari.compose).toContainEqual({ kind: "pitch_notes", material: "pitch_deck" });
  });

  it("an accelerator's demo video waits for nothing, and the deck and one-pager are drafted (YC had 0 documents)", () => {
    const yc = gapsFor({ id: "opp_yc", type: "accelerator", name: "Y Combinator", requiredMaterials: ["application_form", "demo_video"] });
    expect(yc.questions.find((q) => q.fieldName === "material:demo_video")?.required).toBe(false);
    expect(openRequired(yc.questions, {})).toEqual([]);
    expect(yc.compose.map((c) => c.kind)).toEqual(expect.arrayContaining(["answers", "pitch_notes", "one_pager"]));
    expect(ALWAYS_PREPARED.accelerator).toEqual(["pitch_deck", "one_pager"]);
  });

  it("a file the organiser needs waits at confirm (where we submit), not in needs_info", () => {
    const scholarship = gapsFor({ id: "opp_sch", type: "scholarship", name: "Merit Scholarship", requiredMaterials: ["transcript", "personal_statement"] });
    const t = scholarship.questions.find((q) => q.fieldName === "material:transcript")!;
    expect(t.required).toBe(true);
    expect(openRequired(scholarship.questions, {}).map((q) => q.fieldName)).not.toContain("material:transcript");
    expect(missingFiles(scholarship.questions, {}).map((q) => q.fieldName)).toEqual(["material:transcript"]);
    expect(fileName(t, "en")).toBe("Transcript");
    expect(filesBlockConfirm({ channel: "CH3", practice: false })).toBe(true);
    expect(filesBlockConfirm({ channel: "CH6", practice: false })).toBe(false); // attached on the official form
    expect(filesBlockConfirm({ channel: "CH2", practice: true })).toBe(false);
    const answered = { "material:transcript": { value: "doc_t", source: "user" as const, factIds: [], confirmed: true, fileKey: "docs/u/doc_t.pdf" } };
    expect(missingFiles(scholarship.questions, answered)).toEqual([]);
  });

  it("knows which files come later", () => {
    expect(laterMaterial("demo_video", "job")).toBe(true);
    expect(laterMaterial("work_samples", "hackathon")).toBe(true);
    expect(laterMaterial("work_samples", "open_call")).toBe(false);
    expect(laterMaterial("product_images", "accelerator")).toBe(true);
    expect(laterMaterial("transcript", "hackathon")).toBe(false);
  });

  it("takes a link instead of a file", () => {
    const q: ApplicationQuestion = { id: "material:demo_video", fieldName: "material:demo_video", prompt: "Your product demo video, when it's ready", kind: "file", why: "x", required: false };
    expect(normalizeAnswer(q, { value: "https://youtu.be/abc123" }, "en")).toMatchObject({ value: "https://youtu.be/abc123", fileKey: null, confirmed: true });
    expect(() => normalizeAnswer(q, { value: "my video" }, "en")).toThrow(AnswerError);
    expect(isLinkAnswer("https://github.com/me/repo")).toBe(true);
    expect(isLinkAnswer("javascript:alert(1)")).toBe(false);
  });
});

describe("an application with only optional or later items moves on", () => {
  it("is ready, with drafts visible and confirm available", () => {
    const otari = gapsFor({ id: "opp_otari", type: "hackathon", name: "Mozilla Otari Hackathon", requiredMaterials: ["work_samples", "demo_video"] });
    const optionalText: ApplicationQuestion = { id: "gap:track", fieldName: "track", prompt: "Track?", kind: "text", why: "x", required: false };
    const open = openRequired([...otari.questions, optionalText], {}).length;
    expect(open).toBe(0);
    expect(planPrepareStep({ status: "draft" }, "gaps", open)).toEqual({ ok: true, effects: [{ type: "transition", to: "preparing", actor: "system" }] });
    const plan = planPrepareStep({ status: "preparing" }, "composed", open);
    expect(plan.ok && plan.effects.find((e) => e.type === "transition")).toMatchObject({ to: "ready" });
  });

  it("while an essential spot is open it waits in needs_info, with the drafts already made", () => {
    const qs = questionsFromDocumentGaps([{ key: "idea", question: "What's the project?" }], {}, "en");
    const plan = planPrepareStep({ status: "preparing" }, "composed", openRequired(qs, {}).length);
    expect(plan.ok && plan.effects.find((e) => e.type === "transition")).toMatchObject({ to: "needs_info" });
  });
});

describe("applications stuck on the old questions", () => {
  const old = (key: string, prompt: string): ApplicationQuestion => ({ id: `gap:${key}`, fieldName: key, prompt, kind: "text", why: "x", required: true });

  it("are prepared again, folded (the K! Hacks rows asked seven things)", () => {
    expect(hasStaleQuestions(KHACKS_GAPS.map((g) => old(g.key, g.question)), "hackathon")).toBe(true);
    expect(hasStaleQuestions([old("presenter_name", "What is your full name?")], "job")).toBe(true);
    expect(hasStaleQuestions([old("name", "What name should we sign with?")], "job")).toBe(true);
  });

  it("while the folded questions themselves, and a returnship's, are current", () => {
    const folded = questionsFromDocumentGaps([{ key: "idea", question: "x" }, { key: "team", question: "y" }, { key: "full_name", question: "What is your full name?" }], {}, "en");
    expect(hasStaleQuestions(folded, "hackathon")).toBe(false);
    expect(hasStaleQuestions([old("why_this", "Why are you applying to Uber?"), { ...old("career_break", "What was your career break for?"), kind: "choice" }], "returnship")).toBe(false);
    expect(hasStaleQuestions([old("talk_abstract", "What is your talk called?")], "speaking")).toBe(false);
  });
});
