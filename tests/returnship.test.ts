import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALWAYS_PREPARED, computeGaps, isCareerBreakReasonQuestion, questionsFromDocumentGaps } from "@/lib/applications/gaps";
import type { RequirementsLike } from "@/lib/applications/types";
import { orderForDebit, usableFor } from "@/lib/credits";
import { buildDocument, dropOptionalGaps, isOptionalGapQuestion } from "@/lib/documents/build";
import { CAREER_BREAK_REASONS, careerBreakDetail, careerBreakFromProfile, careerBreakSentence, careerBreakSince } from "@/lib/documents/career-break";
import { readContent } from "@/lib/documents/content";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localIntelligence } from "@/lib/llm/provider-local";
import type { FactRef } from "@/lib/llm/types";
import { daysLeft, reminderCopy, reminderWindow } from "@/lib/reminders";
import { applyPath, isAnonymousStartPath } from "@/lib/site";

/*
 * The returnship push (2026-10-31): the career break as the person names it (never guessed),
 * the materials every returnship gets, apply-from-a-listing paths that work signed out, season
 * passes that pay only for their own programmes, and deadline reminders.
 */

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

/** The fixture résumé of someone whose last role ended in August 2022 (no current role). */
function returner() {
  const text = fx("resume-en.txt").replace("Mar 2021 – Present", "Mar 2021 – Aug 2022");
  const out = localExtractProfile({ documents: [{ id: "doc_resume", kind: "resume", filename: "resume.txt", text }], locale: "en", now: "2026-10-31" });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

function current() {
  const out = localExtractProfile({ documents: [{ id: "doc_resume", kind: "resume", filename: "resume.txt", text: fx("resume-en.txt") }], locale: "en", now: "2026-10-31" });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

const RETURNSHIP = { id: "opp_ret", type: "returnship", name: "Return to Work Program", orgName: "Morgan Stanley", requiredMaterials: ["resume"], functions: [], industries: ["finance"], tags: ["returnship"], geo: { remote: "onsite" as const } };
const HANDOFF: RequirementsLike = { channel: "CH6", fields: [], materials: ["resume"], questions: [], requiresAccount: true, requiresPayment: false, captchaLikely: false, notes: [] };

describe("the career break", () => {
  it("dates the break from the end of the most recent role, only when no role is current", () => {
    const r = returner();
    const since = careerBreakSince(r.profile, r.facts);
    expect(since?.date).toBe("2022-08");
    expect(since?.ids.length).toBeGreaterThan(0);
    const c = current();
    expect(careerBreakSince(c.profile, c.facts)).toBeNull();
  });

  it("says the reason the way the person chose it, or in their own words", () => {
    expect(careerBreakSentence("caregiving", "2022-08", "en")).toBe("I stepped away from work in Aug 2022 to care for my family.");
    expect(careerBreakSentence("health", null, "en")).toBe("I took a career break to focus on my health.");
    expect(careerBreakSentence("I moved to Lisbon and learned Portuguese.", "2022-08", "en")).toBe("I stepped away from work in Aug 2022: I moved to Lisbon and learned Portuguese.");
    expect(careerBreakSentence("Raising twins", null, "en")).toBe("I took a career break: raising twins.");
    expect(careerBreakSentence("caregiving", "2022-08", "zh")).toBe("我在 2022.08 离开职场，照顾家人。");
    expect(careerBreakDetail("personal", "en")).toBe("Personal reasons");
    expect(careerBreakDetail("Raising twins", "en")).toBe("Raising twins");
    expect(CAREER_BREAK_REASONS.map((r) => r.value)).toEqual(["caregiving", "health", "relocation", "study", "venture", "personal"]);
  });
});

describe("returnship applications", () => {
  const r = returner();
  const gaps = computeGaps({ language: "en", opportunity: RETURNSHIP, requirements: HANDOFF, mappings: [], drafts: [], answers: {}, documentsOnFile: [], profile: r.profile, accountEmail: "avery@example.com" });

  it("always prepares the returner résumé, a cover letter and the career-break note", () => {
    expect(ALWAYS_PREPARED.returnship).toEqual(["resume_variant", "cover_letter", "career_break_statement"]);
    expect(gaps.compose).toEqual(
      expect.arrayContaining([
        { kind: "resume_variant", material: "resume" },
        { kind: "cover_letter", material: "cover_letter" },
        { kind: "statement", material: "career_break_statement" },
      ]),
    );
  });

  it("asks the reason as one tap, never guessing it", () => {
    const q = gaps.questions.find((x) => x.fieldName === "career_break");
    expect(q?.kind).toBe("choice");
    expect(q?.options?.map((o) => o.value)).toEqual(CAREER_BREAK_REASONS.map((x) => x.value));
    expect(q?.required).toBe(true);
  });

  it("writes the note from the person's answer and their documents' dates", async () => {
    const built = await buildDocument({ ai: localIntelligence, kind: "statement", material: "career_break_statement", profile: r.profile, facts: r.facts, opportunity: RETURNSHIP, answers: { career_break: "caregiving" }, language: "en" });
    expect(built.title).toBe("Career-break note — Morgan Stanley");
    const first = built.content.blocks.find((b) => b.type === "paragraph");
    expect(first?.text).toBe("I stepped away from work in Aug 2022 to care for my family.");
    expect(first?.factIds[0]).toBe("answer:career_break");
    expect(first?.factIds.length).toBeGreaterThan(1);
  });

  it("leaves a spot only the person can fill while the reason is unanswered", async () => {
    const built = await buildDocument({ ai: localIntelligence, kind: "statement", material: "career_break_statement", profile: r.profile, facts: r.facts, opportunity: RETURNSHIP, answers: {}, language: "en" });
    expect(built.gaps.map((g) => g.key)).toContain("career_break");
    expect(readContent(built.content).blocks.some((b) => b.flags.includes("needs_confirmation") && b.factIds.length === 0)).toBe(true);
  });

  it("names the break on the résumé instead of leaving a silent gap", async () => {
    const built = await buildDocument({ ai: localIntelligence, kind: "resume_variant", profile: r.profile, facts: r.facts, opportunity: RETURNSHIP, answers: { career_break: "caregiving" }, language: "en" });
    const i = built.content.blocks.findIndex((b) => b.type === "field" && b.label === "Career break");
    expect(i).toBeGreaterThan(-1);
    expect(built.content.blocks[i].text).toBe("Aug 2022 – present");
    expect(built.content.blocks[i + 1].text).toBe("Caring for children or family");
    const withoutAnswer = await buildDocument({ ai: localIntelligence, kind: "resume_variant", profile: r.profile, facts: r.facts, opportunity: RETURNSHIP, answers: {}, language: "en" });
    expect(withoutAnswer.content.blocks.some((b) => b.label === "Career break")).toBe(false);
  });
});

describe("apply from a listing", () => {
  it("lets /app/apply/<id> through signed out, in both languages", () => {
    expect(applyPath("opp_abc123def456")).toBe("/app/apply/opp_abc123def456");
    expect(isAnonymousStartPath("/app/apply/opp_abc123def456")).toBe(true);
    expect(isAnonymousStartPath("/zh/app/apply/opp_abc123def456")).toBe(true);
    expect(isAnonymousStartPath("/app/apply/not-an-id")).toBe(false);
    expect(isAnonymousStartPath("/app/applications/app_abc123")).toBe(false);
    expect(isAnonymousStartPath("/app/start")).toBe(true);
  });
});

describe("season pass credits", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  const lot = (id: string, scope: string[], expires: string | null, created: string) => ({ id, remaining: 5, expiresAt: expires ? new Date(expires) : null, scope, createdAt: new Date(created), status: "active" });
  const lots = [lot("pack", [], "2027-01-01", "2026-10-01"), lot("trial", [], "2026-12-01", "2026-10-02"), lot("returner", ["returnship"], "2027-02-01", "2026-10-20"), lot("startup", ["accelerator", "pitch_event"], "2027-02-01", "2026-10-21")];

  it("pays for a programme only with general credits or a pass that covers it", () => {
    expect(usableFor(lots, "returnship").map((l) => l.id).sort()).toEqual(["pack", "returner", "trial"]);
    expect(usableFor(lots, "hackathon").map((l) => l.id).sort()).toEqual(["pack", "trial"]);
    expect(usableFor(lots, null).map((l) => l.id).sort()).toEqual(["pack", "trial"]);
  });

  it("uses the matching pass before general credits", () => {
    expect(orderForDebit(usableFor(lots, "returnship"), now).map((l) => l.id)).toEqual(["returner", "trial", "pack"]);
    expect(orderForDebit(usableFor(lots, "pitch_event"), now).map((l) => l.id)).toEqual(["startup", "trial", "pack"]);
  });
});

describe("deadline reminders", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("reminds 7 days and 2 days before, never after", () => {
    expect(reminderWindow(new Date("2026-11-30T23:59:00Z"), now)).toBeNull();
    expect(reminderWindow(new Date("2026-11-26T12:00:00Z"), now)).toBe(7);
    expect(reminderWindow(new Date("2026-11-22T00:00:00Z"), now)).toBe(2);
    expect(reminderWindow(new Date("2026-11-20T11:00:00Z"), now)).toBeNull();
    expect(daysLeft(new Date("2026-11-22T00:00:00Z"), now)).toBe(2);
    expect(daysLeft(new Date("2026-11-20T18:00:00Z"), now)).toBe(1);
  });

  it("says what is waiting, in the person's language", () => {
    expect(reminderCopy({ name: "ReEntry Program", days: 2, started: true, questions: 1 }, "en")).toEqual({
      title: "ReEntry Program closes in 2 days",
      body: "Your materials are drafted; one quick question only you can answer and it is ready for your tap.",
    });
    expect(reminderCopy({ name: "ReEntry Program", days: 1, started: false, questions: 0 }, "en").title).toBe("ReEntry Program closes in 1 day");
    expect(reminderCopy({ name: "ReEntry Program", days: 7, started: true, questions: 0 }, "zh").title).toBe("ReEntry Program 还有 7 天截止");
  });
});

describe("one question per thing only the person can say", () => {
  it("folds every writer's wording of 'why apply' into the one motivation question, and never asks optional spots", () => {
    const qs = questionsFromDocumentGaps(
      [
        { key: "why_join_ms", question: "Why do you want to join Morgan Stanley's Return to Work Program, and which area interests you?" },
        { key: "why_ms", question: "Is there a specific reason you want to return through Morgan Stanley rather than another employer?" },
        { key: "break_more", question: "Would you like to say anything about your career break since August 2022? This is optional." },
        { key: "location", question: "Which programme location are you applying for?" },
      ],
      {},
      "en",
    );
    expect(qs.map((q) => q.fieldName)).toEqual(["why_this", "location"]);
    expect(isOptionalGapQuestion("Is there anything else you'd like to mention?")).toBe(true);
    expect(isOptionalGapQuestion("Is there anything from your break since August 2022 you want to mention, such as courses or freelance work?")).toBe(true);
    expect(isOptionalGapQuestion("What did you do during your career break since August 2022?")).toBe(false);
    expect(isOptionalGapQuestion("Which programme location are you applying for?")).toBe(false);
  });

  it("drops a spot the writer offered as optional before anyone sees it", () => {
    const content = {
      format: "blocks" as const,
      blocks: [
        { type: "paragraph" as const, text: "I led the redesign of the intake flow.", factIds: ["fct_1"], flags: [] },
        { type: "paragraph" as const, label: "Would you like to add anything about your break? This is optional.", text: "[Your words]", factIds: [], flags: ["needs_confirmation" as const] },
      ],
      meta: { ...readContent({ format: "blocks", blocks: [] }).meta, roles: ["body", "gap"], gaps: [{ key: "break_more", question: "Would you like to add anything about your break? This is optional." }] },
    };
    const trimmed = dropOptionalGaps(content);
    expect(trimmed.blocks).toHaveLength(1);
    expect(trimmed.meta.gaps).toEqual([]);
  });

  it("leaves the note's 'why now' as the one motivation spot until the person answers", async () => {
    const r = returner();
    const built = await buildDocument({ ai: localIntelligence, kind: "statement", material: "career_break_statement", profile: r.profile, facts: r.facts, opportunity: RETURNSHIP, answers: { career_break: "caregiving" }, language: "en" });
    expect(built.gaps.map((g) => g.key)).toContain("why_this");
    expect(built.gaps.find((g) => g.key === "why_this")?.question).toBe("Why are you applying to Morgan Stanley?");
  });
});

describe("what the person's own résumé already says (end-to-end walk 2026-10-31)", () => {
  it("takes a career-break reason stated outright in the summary, and only then", async () => {
    const { careerBreakFromProfile } = await import("@/lib/documents/career-break");
    const base = returner().profile;
    expect(careerBreakFromProfile({ ...base, summary: "Data analyst with 8 years of experience. Returning after a career break to care for my family." })).toBe("caregiving");
    expect(careerBreakFromProfile({ ...base, summary: "Data analyst with 8 years of experience." })).toBeNull();
    // A job bullet about a caregiving product is not a reason for a break.
    const withBullet = { ...base, summary: null, experience: base.experience.map((e, i) => (i === 0 ? { ...e, highlights: [...e.highlights, "Built scheduling tools for caregivers"] } : e)) };
    expect(careerBreakFromProfile(withBullet)).toBeNull();
    // Two different reasons: we ask instead of choosing.
    expect(careerBreakFromProfile({ ...base, summary: "Took parental leave, then went back to university full-time study." })).toBeNull();
  });

  it("answers the career-break question from the profile instead of asking it again", () => {
    const r = returner();
    const profile = { ...r.profile, summary: "Returning after a career break to care for my family." };
    const gaps = computeGaps({ language: "en", opportunity: RETURNSHIP, requirements: HANDOFF, mappings: [], drafts: [], answers: {}, documentsOnFile: [], profile, accountEmail: null });
    expect(gaps.autoAnswers.career_break).toMatchObject({ value: "caregiving", source: "profile" });
    expect(gaps.questions.some((q) => q.fieldName === "career_break")).toBe(false);
  });

  it("reuses the reason the person gave on an earlier application", () => {
    const r = returner();
    const gaps = computeGaps({ language: "en", opportunity: RETURNSHIP, requirements: HANDOFF, mappings: [], drafts: [], answers: {}, previous: { career_break: "venture" }, documentsOnFile: [], profile: r.profile, accountEmail: null });
    expect(gaps.autoAnswers.career_break).toMatchObject({ value: "venture", source: "user", confirmed: true, label: "My own project or business" });
    expect(gaps.questions.some((q) => q.fieldName === "career_break")).toBe(false);
    const own = computeGaps({ language: "en", opportunity: RETURNSHIP, requirements: HANDOFF, mappings: [], drafts: [], answers: {}, previous: { career_break: "Raising twins" }, documentsOnFile: [], profile: r.profile, accountEmail: null });
    expect(own.autoAnswers.career_break).toMatchObject({ value: "Raising twins", source: "user" });
    expect(own.autoAnswers.career_break.label).toBeUndefined();
  });

  it("puts 'returning after caregiving' first when the documents say so and no role is current", async () => {
    const { preferExplicitCues } = await import("@/lib/llm/local/identity");
    const model = [
      { code: "T2" as const, confidence: 0.8, why: "career change", stage: null },
      { code: "E3" as const, confidence: 0.7, why: "senior analyst", stage: null },
    ];
    const local = [{ code: "T6" as const, confidence: 0.6, why: "Career break / returning to work", stage: null }];
    const r = returner();
    expect(preferExplicitCues(model, local, r.profile).map((g) => g.code)).toEqual(["T6", "T2", "E3"]);
    expect(preferExplicitCues(model, local, r.profile)[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(preferExplicitCues(model, local, current().profile).map((g) => g.code)).toEqual(["T2", "E3"]);
    expect(preferExplicitCues(model, [], r.profile)).toBe(model);
  });

  it("shows a degree's field once", async () => {
    const { degreeWithField } = await import("@/lib/core/labels");
    expect(degreeWithField("B.S. in Statistics", "Statistics")).toBe("B.S. in Statistics");
    expect(degreeWithField("B.S.", "Statistics")).toBe("B.S., Statistics");
    expect(degreeWithField(null, "Statistics")).toBe("Statistics");
    expect(degreeWithField("MBA", null)).toBe("MBA");
  });

  it("lets a plan point someone back from caregiving at returnships", async () => {
    const { QUICK_GOALS, quickGoalsFor } = await import("@/lib/profile/quick-goals");
    expect(QUICK_GOALS.find((g) => g.id === "returnship")).toMatchObject({ sub: "G1.9", paths: ["work"] });
    expect(quickGoalsFor(["T6"]).first.map((g) => g.id)).toContain("returnship");
  });
});

describe("the career break is asked once", () => {
  it("folds a writer's 'was your break for…' into the career-break question, not 'what did you do'", () => {
    expect(isCareerBreakReasonQuestion("Was your career break since August 2022 for caregiving, and can you confirm you are available full-time?")).toBe(true);
    expect(isCareerBreakReasonQuestion("Why did you step away from work?")).toBe(true);
    expect(isCareerBreakReasonQuestion("What did you do during your career break since August 2022?")).toBe(false);
    const qs = questionsFromDocumentGaps([{ key: "break_care", question: "Was your career break since August 2022 for caregiving?" }, { key: "auth", question: "Are you authorised to work in the US?" }], {}, "en");
    expect(qs.map((q) => q.fieldName)).toEqual(["career_break", "auth"]);
  });
});

describe("returnship milestones fit how many returnships exist", () => {
  it("caps the application milestone for a returnship goal and names it", async () => {
    const { buildMilestones } = await import("@/lib/core/playbooks");
    const job = buildMilestones("G1", { intensity: "steady", horizonMonths: 6 });
    const returnship = buildMilestones("G1", { intensity: "steady", horizonMonths: 6, sub: "G1.9" });
    const apps = (ms: typeof job) => ms.find((m) => m.metric === "applications");
    expect(apps(job)?.target).toBeGreaterThan(12);
    expect(apps(returnship)?.target).toBe(12);
    expect(apps(returnship)?.title.en).toBe("Apply to 12 returnships that fit you");
    expect(returnship.filter((m) => m.metric !== "applications").map((m) => m.title.en)).toEqual(job.filter((m) => m.metric !== "applications").map((m) => m.title.en));
  });
});

describe("a returner's own 'Career break' section (walk 2026-11-03)", () => {
  function elena() {
    const out = localExtractProfile({ documents: [{ id: "doc_cv", kind: "resume", filename: "cv.txt", text: fx("resume-returner-en.txt") }], locale: "en", now: "2026-11-03" });
    const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
    return { profile: out.profile, facts };
  }

  it("reads the section as a section, not as more summary", () => {
    const { profile } = elena();
    expect(profile.summary ?? "").not.toMatch(/career break full-time parent/i);
    expect(profile.experience.some((e) => /parent/i.test(e.title ?? ""))).toBe(true);
  });

  it("dates the break from the line that is the break", () => {
    const e = elena();
    expect(careerBreakSince(e.profile, e.facts)?.date).toBe("2020-03");
  });

  it("does not let volunteering during the break move its start", () => {
    const e = elena();
    const profile = { ...e.profile, experience: e.profile.experience.filter((x) => !/parent/i.test(x.title ?? "")).concat([{ ...e.profile.experience[0], id: "exp_vol", title: "Treasurer", organization: "Parents' Association", employmentType: "volunteer" as const, startDate: "2022", endDate: "2025", current: false }]) };
    const facts = e.facts.concat([{ id: "fct_vol", path: "/experience/exp_vol", claim: "Treasurer", value: null, quote: "Treasurer", sourceDocId: "doc_cv", confidence: 0.9 }]);
    expect(careerBreakSince(profile, facts)?.date).toBe("2020-02");
  });

  it("takes 'caring for my two young children' as the stated reason", () => {
    expect(careerBreakFromProfile({ summary: "Returning after a five-year career break caring for my two young children.", experience: [] })).toBe("caregiving");
    expect(careerBreakFromProfile({ summary: "Built tools for caring teams.", experience: [] })).toBeNull();
  });

  it("lists the break once, with capitalised bullets", async () => {
    const e = elena();
    const built = await buildDocument({ ai: localIntelligence, kind: "resume_variant", profile: e.profile, facts: e.facts, opportunity: RETURNSHIP, answers: { career_break: "caregiving" }, language: "en" });
    const labels = built.content.blocks.filter((b) => b.type === "field").map((b) => b.label ?? "");
    expect(labels.filter((l) => /career break|parent/i.test(l))).toEqual(["Career break"]);
    const i = built.content.blocks.findIndex((b) => b.type === "field" && b.label === "Career break");
    expect(built.content.blocks[i].text).toBe("Mar 2020 – present");
    for (const b of built.content.blocks.filter((x) => x.type === "bullet")) expect(b.text).not.toMatch(/^[a-z]{2}/);
  });
});
