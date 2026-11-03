import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * getIntelligence(): provider selection, the paid-work gate (Claude only for an unlocked
 * application or a job that already checked), the two budgets, fallback to the local engine on
 * any Claude failure, and llm_calls accounting — with the database, the error inbox and the
 * Claude client replaced by in-memory fakes (no network, no key).
 */

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  spentCents: 0,
  unlocked: false,
  claude: { mode: "ok" as "ok" | "refuse" | "unavailable", calls: 0, tiers: [] as unknown[] },
  captured: [] as unknown[],
  alerts: [] as string[],
}));

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/errors", () => ({ captureError: async (err: unknown) => void state.captured.push(err) }));
vi.mock("@/lib/notify", () => ({ notifyOwner: async (m: { subject: string }) => (state.alerts.push(m.subject), true) }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        // llm_calls rows are awaited directly; the outage alert claims its app_state row with an upsert.
        if (typeof row.key === "string") return { onConflictDoUpdate: () => ({ returning: async () => [{ key: row.key }] }) };
        state.inserted.push(row);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        // Awaited: a spend sum (monthly or per application). `.limit(1)`: the application's unlock.
        where: () => Object.assign(Promise.resolve([{ total: state.spentCents }]), { limit: async () => (state.unlocked ? [{ unlockedAt: new Date() }] : []) }),
      }),
    }),
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
    async classifyReply(input: never, ctx?: { report?: (u: unknown) => void; tier?: unknown }) {
      state.claude.calls++;
      state.claude.tiers.push(ctx?.tier);
      if (state.claude.mode === "unavailable") throw new LlmError("unavailable", "Claude API unavailable 400 (classify_reply)", "Your credit balance is too low to access the Anthropic API.");
      ctx?.report?.({ model: "claude-haiku-5-5", inputTokens: 100, outputTokens: 20, cachedTokens: 0, cacheWriteTokens: 0, costCents: 0.5 });
      if (state.claude.mode === "refuse") throw new LlmError("refusal", "declined", "general_harms");
      const r = await localIntelligence.classifyReply(input);
      return { ...r, summary: `claude: ${r.summary}` };
    }
  }
  return { AnthropicIntelligence: FakeClaude };
});

import { forgetUnlocked, getIntelligence } from "@/lib/llm";

const ENV = { ...process.env };
const APP = "app_k3v9q2m8x1d4f6h7";
// Budgets and unlocks are cached per id for a minute: each case uses ids of its own.
let n = 0;
const fresh = () => `app_t${String(++n).padStart(15, "0")}`;

beforeEach(() => {
  forgetUnlocked(APP);
  state.inserted.length = 0;
  state.captured.length = 0;
  state.alerts.length = 0;
  state.spentCents = 0;
  state.unlocked = false;
  state.claude.mode = "ok";
  state.claude.calls = 0;
  state.claude.tiers.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  delete process.env.LLM_PROVIDER;
});
afterEach(() => {
  process.env = { ...ENV };
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const ask = (opts: Parameters<typeof getIntelligence>[0]) => getIntelligence(opts).classifyReply({ text: "Let's set up a call" });

describe("getIntelligence", () => {
  it("uses the local engine when no key is configured, and logs the call at zero cost", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const intel = getIntelligence({ userId: "user_1" });
    expect(intel.provider).toBe("local");
    const r = await intel.classifyReply({ text: "Let's set up a call" });
    expect(r.classification).toBe("meeting");
    await settle();
    expect(state.inserted[0]).toMatchObject({ userId: "user_1", purpose: "classify_reply", provider: "local", model: "local-heuristics", costCents: 0, ok: true });
  });

  it("asks Claude only for an unlocked application, and logs the application with the call", async () => {
    state.unlocked = true;
    const intel = getIntelligence({ userId: "user_2", applicationId: APP });
    expect(intel.provider).toBe("anthropic");
    const r = await intel.classifyReply({ text: "Let's set up a call" });
    expect(r.summary).toMatch(/^claude:/);
    await settle();
    expect(state.inserted[0]).toMatchObject({ provider: "anthropic", applicationId: APP, model: "claude-haiku-5-5", inputTokens: 100, costCents: 0.5, ok: true });
  });

  it("keeps the preview, free use and system work on the local engine even with the key set", async () => {
    // An application that was not paid for (the free preview).
    expect((await ask({ userId: "user_3", applicationId: APP })).summary).not.toMatch(/^claude:/);
    // A person's call outside any application (plan, matching), a signed-out draft, system work.
    expect((await ask({ userId: "user_3" })).summary).not.toMatch(/^claude:/);
    expect((await ask({ userId: "anon_abcdefghijkl1234" })).summary).not.toMatch(/^claude:/);
    expect((await ask({ userId: null })).summary).not.toMatch(/^claude:/);
    expect(state.claude.calls).toBe(0);
    await settle();
    expect(state.inserted.every((x) => x.provider === "local")).toBe(true);
  });

  it("trusts an internal job that already checked (`paid`), always at the full settings", async () => {
    const r = await ask({ userId: "user_4", paid: true });
    expect(r.summary).toMatch(/^claude:/);
    expect(state.claude.tiers).toEqual(["standard"]);
  });

  it("falls back to local once the application's budget or the person's monthly budget is spent", async () => {
    state.unlocked = true;
    process.env.LLM_APPLICATION_CENTS = "250";
    process.env.LLM_USER_MONTHLY_CENTS = "2000";
    state.spentCents = 250;
    expect((await ask({ userId: "user_over_app", applicationId: fresh() })).summary).not.toMatch(/^claude:/);
    process.env.LLM_APPLICATION_CENTS = "100000";
    state.spentCents = 2000;
    expect((await ask({ userId: "user_over_month", applicationId: fresh() })).summary).not.toMatch(/^claude:/);
    state.spentCents = 10;
    expect((await ask({ userId: "user_fine", applicationId: fresh() })).summary).toMatch(/^claude:/);
    await settle();
    expect(state.inserted.map((x) => x.provider)).toEqual(["local", "local", "anthropic"]);
  });

  it("answers with the local engine when Claude refuses, logging both attempts", async () => {
    state.claude.mode = "refuse";
    const r = await getIntelligence({ userId: "user_5", paid: true }).classifyReply({ text: "Unfortunately we're passing." });
    expect(r.classification).toBe("rejected");
    await settle();
    expect(state.inserted.map((x) => [x.provider, x.ok])).toEqual([
      ["anthropic", false],
      ["local", true],
    ]);
    expect(String(state.inserted[0].error)).toMatch(/LlmError: declined \(general_harms\)/);
    expect(state.captured).toHaveLength(1);
  });

  it("stops asking Claude for a while once the account is unavailable, and tells the owner once", async () => {
    state.claude.mode = "unavailable";
    const r = await getIntelligence({ userId: "user_6", paid: true }).classifyReply({ text: "Unfortunately we're passing." });
    expect(r.classification).toBe("rejected");
    await settle();
    expect(state.alerts).toHaveLength(1);
    expect(state.captured).toHaveLength(0);
    // The next paid call goes straight to the local engine without trying Claude again.
    await ask({ userId: "user_7", paid: true });
    expect(state.claude.calls).toBe(1);
  });

  it("serves the mock provider only outside production", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LLM_PROVIDER = "mock";
    expect(getIntelligence().provider).toBe("mock");
    process.env.VERCEL_ENV = "production";
    expect(getIntelligence().provider).toBe("local");
  });
});
