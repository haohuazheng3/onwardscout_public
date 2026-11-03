import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocument } from "@/lib/documents/build";
import { personNotes, readContent, type StoredContent } from "@/lib/documents/content";
import { deckSlides } from "@/lib/documents/deck";
import { revisedContent } from "@/lib/documents/revision";
import { metricOf } from "@/lib/llm/local/compose";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { feedbackIntent, localReviseDocument } from "@/lib/llm/local/revise";
import { AnthropicIntelligence, type AnthropicLike } from "@/lib/llm/provider-anthropic";
import { localIntelligence } from "@/lib/llm/provider-local";
import type { FactRef, RevisedDocument } from "@/lib/llm/types";

/*
 * The materials studio: the pitch deck (composed as slides, read back by deck.ts), the person's
 * note on a draft ("tell the AI what to change") on every engine, and how a revision is stored.
 */

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = new Date("2026-10-30T00:00:00Z");

function founder() {
  const out = localExtractProfile({ documents: [{ id: "doc_deck", kind: "deck", filename: "deck.txt", text: fx("deck-founder.txt") }], locale: "en", now: "2026-10-21" });
  const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, quote: f.quote, sourceDocId: f.sourceDocId, confidence: f.confidence }));
  return { profile: out.profile, facts };
}

const accelerator = { id: "opp_acc", type: "accelerator", name: "Harbor Accelerator", orgName: "Harbor" };

describe("metricOf", () => {
  it("reads a figure and what it measures", () => {
    expect(metricOf("2,000 monthly active users")).toEqual({ value: "2,000", label: "Monthly active users" });
    expect(metricOf("$73K ARR, growing 14% month over month")).toEqual({ value: "$73K", label: "ARR, growing 14% month over month" });
    expect(metricOf("MRR $12k")).toEqual({ value: "$12k", label: "MRR" });
    expect(metricOf("118% net revenue retention")?.value).toBe("118%");
    expect(metricOf("月活 2万")).toEqual({ value: "2万", label: "月活" });
  });
  it("leaves sentences and years alone", () => {
    expect(metricOf("Grew revenue 3x in the six months after launch")).toBeNull();
    expect(metricOf("Since 2021")).toBeNull();
    expect(metricOf("Pilot signed with a regional chain")).toBeNull();
  });
});

describe("deckSlides", () => {
  const b = (type: "heading" | "paragraph" | "bullet" | "field", text: string, extra: { label?: string; gap?: boolean } = {}) => ({
    type,
    text,
    ...(extra.label ? { label: extra.label } : {}),
    factIds: extra.gap ? [] : ["fct_1"],
    flags: extra.gap ? (["needs_confirmation"] as const).slice() : [],
  });
  it("lays out title, statement, metrics and points slides", () => {
    const slides = deckSlides(
      [
        b("heading", "Acme"),
        b("paragraph", "Payroll for clinics"),
        b("heading", "The problem"),
        b("paragraph", "Clinics lose 6 hours a week"),
        b("heading", "Traction"),
        b("field", "41", { label: "Paying clinics" }),
        b("bullet", "Pilot with a hospital group"),
        b("heading", "Team"),
        b("bullet", "Ada · CEO"),
        b("bullet", "Lin · CTO"),
        b("heading", "The ask"),
        b("paragraph", "[Amount and round]", { label: "How much are you raising?", gap: true }),
      ],
      "Overview",
    );
    expect(slides.map((s) => s.layout)).toEqual(["title", "statement", "metrics", "points", "points"]);
    expect(slides[2].items[0]).toMatchObject({ kind: "metric", text: "41", label: "Paying clinics", block: 5 });
    expect(slides[4].items[0]).toMatchObject({ kind: "gap", label: "How much are you raising?" });
  });
  it("starts a slide when the deck has no heading yet", () => {
    expect(deckSlides([b("paragraph", "Loose text")], "Overview")[0]).toMatchObject({ title: "Overview", block: -1 });
  });
});

describe("pitch deck (local engine)", () => {
  it("builds the deck from the founder's facts, every claim sourced", async () => {
    const f = founder();
    const deck = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", profile: f.profile, facts: f.facts, opportunity: accelerator, language: "en", now: NOW });
    expect(deck.content.meta.composer).toBe("pitch_deck");
    const slides = deckSlides(deck.content.blocks, "Overview");
    const titles = slides.map((s) => s.title);
    expect(titles[0]).toBe("Tallyfern");
    expect(titles).toEqual(expect.arrayContaining(["The problem", "Our solution", "Traction", "Team", "The ask"]));
    expect(slides.find((s) => s.title === "Traction")?.items.filter((i) => i.kind === "metric").length).toBeGreaterThanOrEqual(2);
    for (const block of deck.content.blocks) if (block.type !== "heading") expect(block.factIds.length).toBeGreaterThan(0);
    expect(deck.content.meta.gaps).toEqual([]);
  });

  it("asks for what only the founder knows, and uses the answer once given", async () => {
    const empty = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", profile: {}, facts: [], opportunity: accelerator, language: "en", now: NOW });
    // A deck's company-and-one-liner spot is the application's one idea question (spots.ts).
    expect(empty.content.meta.gaps.map((g) => g.key)).toEqual(["idea"]);
    const f = founder();
    const noProblem = f.facts.filter((x) => !x.path.endsWith("/problem"));
    const answered = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", profile: f.profile, facts: noProblem, opportunity: accelerator, language: "en", answers: { problem: "Owners close their books at midnight" }, now: NOW });
    const problem = deckSlides(answered.content.blocks, "Overview").find((s) => s.title === "The problem");
    expect(problem?.items[0]).toMatchObject({ kind: "statement", text: "Owners close their books at midnight" });
    expect(answered.content.blocks[problem!.items[0].block].factIds).toEqual(["answer:problem"]);
  });

  it("writes the deck in Chinese", async () => {
    const deck = await buildDocument({ ai: localIntelligence, kind: "pitch_notes", profile: founder().profile, facts: founder().facts, opportunity: accelerator, language: "zh", now: NOW });
    expect(deckSlides(deck.content.blocks, "概述").map((s) => s.title)).toEqual(expect.arrayContaining(["问题", "解决方案", "团队"]));
  });
});

describe("feedbackIntent", () => {
  it("reads language, length and tone in either language", () => {
    expect(feedbackIntent("Write it in Chinese")).toEqual({ shorter: false, language: "zh", tone: null });
    expect(feedbackIntent("改成英文，再精简一点")).toEqual({ shorter: true, language: "en", tone: null });
    expect(feedbackIntent("Make it shorter and more confident").tone).toBe("enthusiastic");
    expect(feedbackIntent("语气更亲切").tone).toBe("warm");
    expect(feedbackIntent("Add our pilot customers")).toEqual({ shorter: false, language: null, tone: null });
  });
});

describe("localReviseDocument", () => {
  const blocks = [
    { type: "heading" as const, role: "heading", text: "Traction", factIds: [] },
    { type: "paragraph" as const, role: "body", text: "We have 41 paying restaurants. Revenue grows 14% a month. Retention is 118%.", factIds: ["fct_1"] },
    { type: "bullet" as const, role: "body", text: "One", factIds: ["fct_2"] },
    { type: "bullet" as const, role: "body", text: "Two", factIds: ["fct_2"] },
    { type: "bullet" as const, role: "body", text: "Three", factIds: ["fct_2"] },
    { type: "bullet" as const, role: "body", text: "Four", factIds: ["fct_2"] },
    { type: "paragraph" as const, role: "body", text: "My own words. Kept whole.", factIds: ["user:confirmed"] },
    { type: "paragraph" as const, role: "gap", label: "How much are you raising?", text: "[Amount]", factIds: [], flags: ["needs_confirmation" as const] },
  ];
  const base = { kind: "pitch_notes", title: "Deck", blocks, profile: {}, facts: [], language: "en" as const };

  it("shortens without touching the person's words or the open spots", () => {
    const r = localReviseDocument({ ...base, feedback: "Make it shorter" });
    expect(r.applied).toBe(true);
    expect(r.blocks.map((b) => b.text)).toEqual(["Traction", "We have 41 paying restaurants. Revenue grows 14% a month.", "One", "Two", "Three", "My own words. Kept whole.", "[Amount]"]);
    expect(r.changes[0]).toMatch(/Shortened in 2 places/);
  });

  it("declines a note it cannot act on, in the note's language", () => {
    expect(localReviseDocument({ ...base, feedback: "Add a slide on competition" })).toMatchObject({ applied: false, changes: [], reason: expect.stringMatching(/edit any sentence/) });
    expect(localReviseDocument({ ...base, feedback: "加一页竞品分析" }).reason).toMatch(/直接点开/);
  });
});

describe("revisedContent", () => {
  const previous: StoredContent = readContent({
    format: "blocks",
    blocks: [{ type: "paragraph", text: "Old", factIds: ["fct_1"], flags: [] }],
    meta: { composer: "pitch_deck", revisions: [{ note: "Restored version 1", changes: [], at: "2026-10-29T00:00:00.000Z", restore: true }, { note: "shorter", changes: ["x"], at: "2026-10-29T01:00:00.000Z" }] },
  });
  const revised: RevisedDocument = {
    applied: true,
    title: "Deck",
    language: "en",
    blocks: [
      { type: "heading", role: "heading", text: "Traction", factIds: [], flags: [] },
      { type: "field", role: "body", label: "Pilot customers", text: "3", factIds: ["answer:note_2"], flags: [] },
      { type: "paragraph", role: "gap", text: "[Competitors]", factIds: [], flags: ["needs_confirmation"] },
    ],
    gaps: [{ key: "competition", question: "Who else solves this?" }],
    changes: ["Traction now shows the 3 pilots"],
    reason: null,
    label: "written_with_ai",
  };

  it("keeps roles, labels the open spot with its question and appends the note", () => {
    const c = revisedContent(previous, revised, "add our 3 pilots", NOW);
    expect(c.meta.roles).toEqual(["heading", "body", "gap"]);
    expect(c.blocks[2]).toMatchObject({ label: "Who else solves this?", factIds: [] });
    expect(c.meta.label).toBe("written_with_ai");
    expect(c.meta.composer).toBe("pitch_deck");
    expect(personNotes(c.meta)).toEqual(["shorter", "add our 3 pilots"]);
    expect(c.meta.revisions.at(-1)).toEqual({ note: "add our 3 pilots", changes: ["Traction now shows the 3 pilots"], at: NOW.toISOString(), restore: false });
  });
});

describe("reviseDocument (Claude provider, fake client)", () => {
  it("cites the note as the person's statement, drops unknown sources and flags unsourced claims", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client: AnthropicLike = {
      beta: {
        messages: {
          stream(params) {
            calls.push(params);
            const json = {
              title: "Deck",
              language: "en",
              blocks: [
                { type: "heading", role: "heading", label: null, text: "Traction", factIds: [] },
                { type: "field", role: "body", label: "Pilot customers", text: "3", factIds: ["answer:note_2"] },
                { type: "bullet", role: "body", label: null, text: "41 paying restaurants", factIds: ["fct_1", "fct_999"] },
                { type: "bullet", role: "body", label: null, text: "Invented claim", factIds: ["fct_404"] },
              ],
              gaps: [],
              changes: ["Added the pilots"],
            };
            return { finalMessage: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 10, output_tokens: 10 } }) };
          },
        },
      },
    };
    const r = await new AnthropicIntelligence(client).reviseDocument({
      kind: "pitch_notes",
      title: "Deck",
      blocks: [{ type: "bullet", role: "body", text: "41 paying restaurants", factIds: ["fct_1"] }],
      feedback: "we have 3 pilot customers",
      notes: ["shorter"],
      profile: {},
      facts: [{ id: "fct_1", path: "/packs/founder/ventures/0/traction/items/0", claim: "41 paying restaurants" }],
      language: "en",
    });
    expect(r).toMatchObject({ applied: true, label: "written_with_ai", changes: ["Added the pilots"] });
    expect(r.blocks[1].factIds).toEqual(["answer:note_2"]);
    expect(r.blocks[2].factIds).toEqual(["fct_1"]);
    expect(r.blocks[3]).toMatchObject({ factIds: [], flags: ["unsourced"] });
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain("revise the document");
    expect(sent).toContain("answer:note_2");
    expect((calls[0] as { model: string }).model).toBe("claude-opus-5-5");
  });
});
