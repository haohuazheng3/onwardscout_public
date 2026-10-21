import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * getIntelligence(): provider selection, per-user monthly budget, fallback to the local
 * engine on any Claude failure, and llm_calls accounting — with the database, the error
 * inbox and the Claude client replaced by in-memory fakes (no network, no key).
 */

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  spentCents: 0,
  claude: { mode: "ok" as "ok" | "refuse" },
  captured: [] as unknown[],
}));

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/errors", () => ({ captureError: async (err: unknown) => void state.captured.push(err) }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: async (row: Record<string, unknown>) => void state.inserted.push(row) }),
    select: () => ({ from: () => ({ where: async () => [{ total: state.spentCents }] }) }),
  },
}));
vi.mock("@/lib/llm/provider-anthropic", async () => {
  const { localIntelligence } = await import("@/lib/llm/provider-local");
  const { LlmError } = await import("@/lib/llm/types");
  class FakeClaude {
    readonly provider = "anthropic" as const;
    static fromKey() {
      return new FakeClaude();
    }
    async classifyReply(input: never, ctx?: { report?: (u: unknown) => void }) {
      ctx?.report?.({ model: "claude-haiku-5-5", inputTokens: 100, outputTokens: 20, cachedTokens: 0, cacheWriteTokens: 0, costCents: 0.5 });
      if (state.claude.mode === "refuse") throw new LlmError("refusal", "declined", "general_harms");
      const r = await localIntelligence.classifyReply(input);
      return { ...r, summary: `claude: ${r.summary}` };
    }
  }
  return { AnthropicIntelligence: FakeClaude };
});

import { getIntelligence } from "@/lib/llm";

const ENV = { ...process.env };

beforeEach(() => {
  state.inserted.length = 0;
  state.captured.length = 0;
  state.spentCents = 0;
  state.claude.mode = "ok";
});
afterEach(() => {
  process.env = { ...ENV };
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("getIntelligence", () => {
  it("uses the local engine when no key is configured, and logs the call at zero cost", async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    const intel = getIntelligence({ userId: "user_1" });
    expect(intel.provider).toBe("local");
    const r = await intel.classifyReply({ text: "Let's set up a call" });
    expect(r.classification).toBe("meeting");
    await settle();
    expect(state.inserted[0]).toMatchObject({ userId: "user_1", purpose: "classify_reply", provider: "local", model: "local-heuristics", costCents: 0, ok: true });
  });

  it("uses Claude when the key is set and the person is within budget", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const intel = getIntelligence({ userId: "user_2" });
    expect(intel.provider).toBe("anthropic");
    const r = await intel.classifyReply({ text: "Let's set up a call" });
    expect(r.summary).toMatch(/^claude:/);
    await settle();
    expect(state.inserted[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", inputTokens: 100, costCents: 0.5, ok: true });
  });

  it("falls back to local once the monthly budget is spent", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    process.env.LLM_USER_MONTHLY_CENTS = "300";
    state.spentCents = 300;
    const r = await getIntelligence({ userId: "user_over_budget" }).classifyReply({ text: "Let's set up a call" });
    expect(r.summary).not.toMatch(/^claude:/);
    await settle();
    expect(state.inserted[0]).toMatchObject({ provider: "local" });
  });

  it("answers with the local engine when Claude refuses, logging both attempts", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    state.claude.mode = "refuse";
    const r = await getIntelligence({ userId: "user_3" }).classifyReply({ text: "Unfortunately we're passing." });
    expect(r.classification).toBe("rejected");
    await settle();
    expect(state.inserted.map((x) => [x.provider, x.ok])).toEqual([
      ["anthropic", false],
      ["local", true],
    ]);
    expect(String(state.inserted[0].error)).toMatch(/LlmError: declined \(general_harms\)/);
    expect(state.captured).toHaveLength(1);
  });

  it("serves the mock provider only outside production", async () => {
    process.env.LLM_PROVIDER = "mock";
    expect(getIntelligence().provider).toBe("mock");
    process.env.VERCEL_ENV = "production";
    expect(getIntelligence().provider).toBe("local");
  });
});
