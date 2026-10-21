import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AnthropicIntelligence, stableJson, type AnthropicLike } from "@/lib/llm/provider-anthropic";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { LlmError, emptyIR, type UsageReport } from "@/lib/llm/types";

/*
 * The Claude provider against a fake client: no network, no key. Checks the request shape
 * the API requires (adaptive thinking, explicit effort, structured outputs, fallbacks only
 * on Opus, cache breakpoints) and the response handling (refusal, max_tokens, validation,
 * cost reporting, unsourced claims flagged).
 */

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

/** The request fields these tests read. */
interface Req {
  model: string;
  thinking: unknown;
  output_config: { effort: string; format: { type: string; schema: { additionalProperties?: boolean } } };
  fallbacks?: unknown;
  betas?: unknown;
  tool_choice?: unknown;
  system: Array<{ cache_control?: unknown }>;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string; cache_control?: unknown; source?: { media_type?: string } }> }>;
}
const req = (call: { params: Record<string, unknown> }) => call.params as unknown as Req;

function fakeClient(reply: (params: Record<string, unknown>) => unknown) {
  const calls: Array<{ params: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const client: AnthropicLike = {
    beta: {
      messages: {
        stream(params, options) {
          calls.push({ params, options });
          return { finalMessage: async () => reply(params) };
        },
      },
    },
  };
  return { client, calls };
}

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };
const message = (json: unknown, extra: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(json) }],
  usage,
  ...extra,
});

describe("request shape", () => {
  it("classifyReply: Haiku 5.5, low effort, structured output, no fallbacks, cached system prompt", async () => {
    const { client, calls } = fakeClient(() => ({ ...message({ classification: "meeting", summary: "s", nextStep: "n", confidence: 0.9 }), model: "claude-haiku-5-5" }));
    const intel = new AnthropicIntelligence(client);
    const reports: UsageReport[] = [];
    const r = await intel.classifyReply({ text: "Can we talk Tuesday?" }, { report: (u) => reports.push(u) });
    expect(r.classification).toBe("meeting");
    const p = req(calls[0]);
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config.effort).toBe("low");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p.output_config.format.schema.additionalProperties).toBe(false);
    expect(p.fallbacks).toBeUndefined();
    expect(p.betas).toBeUndefined();
    expect(p.tool_choice).toBeUndefined();
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(p.messages)).toContain("<reply>");
    // The last message is the user's: no assistant prefill.
    expect(p.messages.at(-1)?.role).toBe("user");
    expect(calls[0].options).toMatchObject({ maxRetries: 2 });
    // Haiku 5.5: $0.10 in, $0.50 out, cache reads $0.01 per MTok → (100 + 250 + 20) µ$ → 0.037 cents.
    expect(reports[0].costCents).toBeCloseTo(0.037, 4);
  });

  it("compose: Opus 5.5, high effort, server-side fallbacks, profile context cached", async () => {
    const { client, calls } = fakeClient(() => message({ title: "t", blocks: [{ type: "paragraph", role: "body", label: null, text: "I build things.", factIds: ["fct_1"] }], gaps: [], notes: [] }));
    const intel = new AnthropicIntelligence(client);
    await intel.compose({ kind: "bio", profile: {}, facts: [{ id: "fct_1", path: "/identity/name", claim: "Name: Kai" }], language: "en" });
    const p = req(calls[0]);
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config.effort).toBe("high");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.thinking).toEqual({ type: "adaptive" });
    const first = p.messages[0].content[0];
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.text).toContain("<profile>");
    expect(first.text).toContain('"id":"fct_1"');
  });

  it("extractProfile sends scans as document blocks and text as tagged data", async () => {
    const ir = emptyIR();
    ir.identity.push({ field: "name", value: "Avery Quinn", src: { docId: "doc_en", quote: "AVERY QUINN", confidence: 0.9 } });
    const { client, calls } = fakeClient(() => message({ ir, identities: [{ code: "E3", confidence: 0.8, why: "Senior title", stage: null }], gaps: ["Where do you want to work?"] }));
    const intel = new AnthropicIntelligence(client);
    const out = await intel.extractProfile({
      documents: [
        { id: "doc_en", kind: "resume", filename: "r.txt", text: fx("resume-en.txt") },
        { id: "doc_scan", kind: "certificate", filename: "c.pdf", text: "", imageBase64: "JVBERi0xLjQK", mediaType: "application/pdf" },
      ],
      locale: "en",
    });
    const content = req(calls[0]).messages[0].content;
    expect(content.some((b) => b.type === "document" && b.source?.media_type === "application/pdf")).toBe(true);
    expect(content.some((b) => b.type === "text" && String(b.text).startsWith('<document id="doc_en"'))).toBe(true);
    expect(req(calls[0]).output_config.effort).toBe("medium");
    expect(out.profile.identity.name).toBe("Avery Quinn");
    expect(out.facts[0]).toMatchObject({ path: "/identity/name", sourceDocId: "doc_en", confidence: 0.9 });
    expect(out.profile.roles[0]).toMatchObject({ code: "E3", inferred: true });
    expect(out.gaps).toEqual(["Where do you want to work?"]);
  });

  it("stable JSON sorts keys so the cached prefix is byte-identical", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
});

describe("response handling", () => {
  it("checks stop_reason before reading content: refusal and max_tokens become LlmError", async () => {
    const refused = new AnthropicIntelligence(fakeClient(() => ({ ...message({}), stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] })).client);
    await expect(refused.classifyReply({ text: "x" })).rejects.toMatchObject({ name: "LlmError", code: "refusal", detail: "cyber" });
    const truncated = new AnthropicIntelligence(fakeClient(() => ({ ...message({}), stop_reason: "max_tokens" })).client);
    await expect(truncated.classifyReply({ text: "x" })).rejects.toMatchObject({ code: "truncated" });
  });

  it("validates the parsed output with zod", async () => {
    const bad = new AnthropicIntelligence(fakeClient(() => message({ classification: "maybe", summary: 1 })).client);
    await expect(bad.classifyReply({ text: "x" })).rejects.toBeInstanceOf(LlmError);
    const notJson = new AnthropicIntelligence(fakeClient(() => ({ ...message({}), content: [{ type: "text", text: "Sure! Here you go" }] })).client);
    await expect(notJson.classifyReply({ text: "x" })).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("prices every attempt when a fallback model served the response", async () => {
    const reports: UsageReport[] = [];
    const intel = new AnthropicIntelligence(
      fakeClient(() =>
        message(
          { title: "t", blocks: [], gaps: [], notes: [] },
          {
            model: "claude-opus-5",
            usage: {
              ...usage,
              iterations: [
                { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                { type: "fallback_message", model: "claude-opus-5", input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              ],
            },
          },
        ),
      ).client,
    );
    await intel.compose({ kind: "bio", profile: {}, facts: [], language: "en" }, { report: (u) => reports.push(u) });
    // Opus 5.5 declined: 1000 × $4/M = 0.4¢; Opus 5 served: 1000 × $5/M + 1000 × $25/M = 3¢.
    expect(reports[0].costCents).toBeCloseTo(3.4, 4);
    expect(reports[0].model).toBe("claude-opus-5");
  });

  it("flags model claims that cite no valid fact as unsourced, never trusting them silently", async () => {
    const intel = new AnthropicIntelligence(
      fakeClient(() =>
        message({
          title: "Bio",
          blocks: [
            { type: "paragraph", role: "body", label: null, text: "Kai leads design at Acme.", factIds: ["fct_1"] },
            { type: "paragraph", role: "body", label: null, text: "Kai won three awards.", factIds: ["fct_999"] },
            { type: "paragraph", role: "gap", label: null, text: "[Why Acme]", factIds: [] },
          ],
          gaps: [{ key: "why_this", question: "Why Acme?" }],
          notes: [],
        }),
      ).client,
    );
    const doc = await intel.compose({ kind: "bio", profile: {}, facts: [{ id: "fct_1", path: "/experience/x", claim: "Design lead at Acme" }], language: "en" });
    expect(doc.label).toBe("written_with_ai");
    expect(doc.blocks[0]).toMatchObject({ factIds: ["fct_1"], flags: [] });
    expect(doc.blocks[1]).toMatchObject({ factIds: [], flags: ["unsourced"] });
    expect(doc.blocks[2].flags).toEqual(["needs_confirmation"]);
  });

  it("keeps deterministic hard filters authoritative when Claude scores matches", async () => {
    const profile = localExtractProfile({ documents: [{ id: "d", kind: "resume", filename: "r", text: fx("resume-en.txt") }], locale: "en", now: "2026-10-21" }).profile;
    const intel = new AnthropicIntelligence(
      fakeClient(() => ({
        ...message({ matches: [{ opportunityId: "past", goalId: null, fit: 90, winProbability: 0.5, effort: 10, value: 80, eligible: true, reasons: ["Great"], gaps: [], blockers: [] }] }),
        model: "claude-haiku-5-5",
      })).client,
    );
    const [m] = await intel.scoreMatches({ profile, goals: [], opportunities: [{ id: "past", type: "job", name: "Designer", deadline: "2026-01-01" }], now: "2026-10-21" });
    expect(m.eligible).toBe(false);
    expect(m.winProbability).toBe(0);
    expect(m.blockers).toContain("The deadline has passed");
  });

  it("never lets the model fill consent or self-identification fields", async () => {
    const intel = new AnthropicIntelligence(
      fakeClient(() => message({ fields: [{ name: "consent", value: "true", source: "profile", key: "consent", factIds: [], confidence: 1, needsUser: false }, { name: "gender", value: "Woman", source: "profile", key: "eeo", factIds: [], confidence: 1, needsUser: false }] })).client,
    );
    const out = await intel.mapFormFields({ fields: [{ name: "consent", label: "I agree to the terms", type: "checkbox" }, { name: "gender", label: "Gender", type: "select", options: ["Woman", "Man"] }], profile: {} });
    expect(out.every((f) => f.source === "user" && f.value === null && f.needsUser)).toBe(true);
  });

  it("guards the browser agent before calling the model", async () => {
    const { client, calls } = fakeClient(() => message({ action: "submit", target: 'button "Submit"', value: null, done: false, needsUser: false, reason: "go" }));
    const intel = new AnthropicIntelligence(client);
    const captcha = await intel.planBrowserStep({ goal: "g", pageSummary: "Verify you are human", axTree: '- iframe "reCAPTCHA"' });
    expect(captcha).toMatchObject({ action: "stop", needsUser: true });
    expect(calls).toHaveLength(0);
    const step = await intel.planBrowserStep({ goal: "g", pageSummary: "", axTree: '- textbox "Name": Kai\n- button "Submit"', allowSubmit: false });
    expect(step).toMatchObject({ action: "stop", done: true });
  });
});
