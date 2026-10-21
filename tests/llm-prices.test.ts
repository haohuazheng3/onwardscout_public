import { describe, expect, it } from "vitest";
import { MODEL_HAIKU, MODEL_OPUS, attemptCostCents, priceOf, responseCostCents } from "@/lib/llm/prices";

describe("prices", () => {
  it("Opus 5.5: $4 / $20 per MTok, cache reads $0.20, 5-minute writes $5, 1-hour writes $8", () => {
    expect(attemptCostCents(MODEL_OPUS, { input_tokens: 1_000_000 })).toBeCloseTo(400);
    expect(attemptCostCents(MODEL_OPUS, { output_tokens: 1_000_000 })).toBeCloseTo(2000);
    expect(attemptCostCents(MODEL_OPUS, { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(20);
    expect(attemptCostCents(MODEL_OPUS, { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(500);
    expect(attemptCostCents(MODEL_OPUS, { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 } })).toBeCloseTo(800);
  });

  it("Haiku 5.5: $0.10 / $0.50, and the long-prompt card above 100K tokens", () => {
    expect(attemptCostCents(MODEL_HAIKU, { input_tokens: 1_000_000 })).toBeCloseTo(50); // > 100K prompt → $0.50
    expect(attemptCostCents(MODEL_HAIKU, { input_tokens: 100_000, output_tokens: 10_000 })).toBeCloseTo(1 + 0.5);
    expect(attemptCostCents(MODEL_HAIKU, { input_tokens: 50_000, cache_read_input_tokens: 60_000, output_tokens: 1000 })).toBeCloseTo(50_000 * 0.5e-4 + 60_000 * 0.05e-4 + 1000 * 2.5e-4);
  });

  it("unknown models are priced conservatively", () => {
    expect(priceOf("claude-something-new").input).toBeGreaterThanOrEqual(5);
    expect(priceOf("anthropic.claude-opus-5-5").input).toBe(4);
  });

  it("sums iterations when present", () => {
    expect(
      responseCostCents(MODEL_OPUS, {
        input_tokens: 1,
        output_tokens: 1,
        iterations: [
          { model: MODEL_OPUS, input_tokens: 10_000 },
          { model: "claude-opus-5", input_tokens: 10_000, output_tokens: 10_000 },
        ],
      }),
    ).toBeCloseTo(4 + 5 + 25);
  });
});
