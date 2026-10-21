/*
 * Model prices (US dollars per million tokens) and the cost of a response in cents.
 * Source: the Claude API model-migration guide (Claude Opus 5.5: $4 / $20, cache reads
 * $0.20, 5-minute cache writes $5, 1-hour writes $8; Claude Haiku 5.5: $0.10 / $0.50 up to
 * a 100K-token prompt and $0.50 / $2.50 above, cache reads 0.1x input, writes 1.25x / 2x).
 * Server-side fallbacks may serve a response on Claude Opus 5 or Opus 4.8 ($5 / $25), so
 * those are priced too; an unknown model is priced at the most expensive known rate so the
 * per-user budget errs on the safe side.
 */

export const MODEL_OPUS = "claude-opus-5-5";
export const MODEL_HAIKU = "claude-haiku-5-5";

export interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface ModelPrice extends Rate {
  /** A second rate card for prompts above `threshold` tokens (Haiku 5.5). */
  long?: Rate & { threshold: number };
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    long: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 },
  },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
};

const FALLBACK_PRICE: ModelPrice = PRICES["claude-opus-5"];

export function priceOf(model: string | null | undefined): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  return PRICES[model] ?? PRICES[model.replace(/^anthropic\./, "").replace(/-\d{8}$/, "")] ?? FALLBACK_PRICE;
}

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

/** Cost of one sampling attempt, in US cents (fractional). */
export function attemptCostCents(model: string | null | undefined, u: TokenUsage): number {
  const p = priceOf(model);
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, write - w1h);
  const prompt = input + read + write;
  const r: Rate = p.long && prompt > p.long.threshold ? p.long : p;
  const dollars = (input * r.input + output * r.output + read * r.cacheRead + w5m * r.cacheWrite5m + w1h * r.cacheWrite1h) / 1_000_000;
  return dollars * 100;
}

export interface ResponseUsage extends TokenUsage {
  iterations?: Array<TokenUsage & { model?: string | null; type?: string }> | null;
}

/**
 * Cost of a whole response. With server-side fallbacks the top-level usage covers only the
 * attempt that produced the message; `usage.iterations` lists every attempt with its model,
 * so when present it is the source of truth.
 */
export function responseCostCents(model: string, usage: ResponseUsage): number {
  const its = usage.iterations ?? [];
  if (its.length) return its.reduce((sum, it) => sum + attemptCostCents(it.model ?? model, it), 0);
  return attemptCostCents(model, usage);
}

/** Rounds a cost to 4 decimal places of a cent for storage (`llm_calls.cost_cents` is real). */
export function roundCents(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}
