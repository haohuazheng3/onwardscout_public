import "server-only";
import { waitUntil } from "@vercel/functions";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCalls } from "@/lib/db/schema";
import { env, llmUserMonthlyCents, selectLlmProvider } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { AnthropicIntelligence } from "./provider-anthropic";
import { localIntelligence } from "./provider-local";
import { mockIntelligence } from "./provider-mock";
import { roundCents } from "./prices";
import {
  LlmError,
  type AnswerQuestionsInput,
  type CallContext,
  type ClassifyReplyInput,
  type ComposeInput,
  type ExtractProfileInput,
  type Intelligence,
  type MapFormFieldsInput,
  type NormalizeOpportunityInput,
  type PlanBrowserStepInput,
  type ProviderName,
  type Purpose,
  type ScoreMatchesInput,
  type UsageReport,
} from "./types";

/*
 * The one entry point features use: `getIntelligence({ userId })`.
 *
 * Selection (build contract): LLM_PROVIDER when set, else `anthropic` when ANTHROPIC_API_KEY is
 * set, else `local` (src/lib/env.ts `selectLlmProvider`; `mock` is refused on production).
 * With `anthropic`, the person's spend this calendar month (UTC) is summed from llm_calls;
 * at or over LLM_USER_MONTHLY_CENTS (default 300) the call runs on `local` instead.
 * Any Claude failure (timeout, API error, refusal, truncated or invalid output) is logged
 * (llm_calls ok=false + error inbox as a warning) and the call is answered by `local`, so a
 * person always gets a result. Every call — local ones too, at zero cost — is written to
 * llm_calls in the background.
 */

export * from "./types";
export { MODEL_HAIKU, MODEL_OPUS, PRICES, attemptCostCents, responseCostCents } from "./prices";
export { localIntelligence } from "./provider-local";
export { classifyQuestion } from "./local/compose";
export { fieldKey, parseAxTree } from "./local/forms";
export { stripQuoted } from "./local/reply";

const LOCAL_MODEL = "local-heuristics";
const BUDGET_TTL_MS = 60_000;

export interface LogCallInput {
  userId?: string | null;
  purpose: Purpose | string;
  provider: ProviderName | string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costCents?: number;
  ms: number;
  ok: boolean;
  error?: string | null;
}

/** Writes one llm_calls row. Never throws (accounting must not break the person's flow). */
export async function logCall(row: LogCallInput): Promise<void> {
  try {
    await db.insert(llmCalls).values({
      id: newId("llm"),
      userId: row.userId ?? null,
      purpose: row.purpose,
      provider: row.provider,
      model: row.model,
      inputTokens: Math.round(row.inputTokens ?? 0),
      outputTokens: Math.round(row.outputTokens ?? 0),
      cachedTokens: Math.round(row.cachedTokens ?? 0),
      costCents: roundCents(row.costCents ?? 0),
      ms: Math.round(row.ms),
      ok: row.ok,
      error: row.error ? row.error.slice(0, 1000) : null,
    });
  } catch (err) {
    console.error("[llm] could not write llm_calls", err);
  }
}

/** Cents spent on model calls by a person in the current calendar month (UTC). */
export async function monthlySpendCents(userId: string, now = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${llmCalls.costCents}), 0)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), gte(llmCalls.createdAt, monthStart)));
  return Number(rows[0]?.total ?? 0);
}

const budgetCache = new Map<string, { at: number; spent: number }>();

async function withinBudget(userId: string): Promise<boolean> {
  const cached = budgetCache.get(userId);
  let spent: number;
  if (cached && Date.now() - cached.at < BUDGET_TTL_MS) spent = cached.spent;
  else {
    spent = await monthlySpendCents(userId);
    budgetCache.set(userId, { at: Date.now(), spent });
  }
  return spent < llmUserMonthlyCents();
}

function noteSpend(userId: string | null | undefined, cents: number): void {
  if (!userId) return;
  const c = budgetCache.get(userId);
  if (c) c.spent += cents;
}

function sumUsage(usages: UsageReport[]): { model: string; inputTokens: number; outputTokens: number; cachedTokens: number; costCents: number } {
  return {
    model: usages[usages.length - 1]?.model ?? "unknown",
    inputTokens: usages.reduce((n, u) => n + u.inputTokens, 0),
    outputTokens: usages.reduce((n, u) => n + u.outputTokens, 0),
    cachedTokens: usages.reduce((n, u) => n + u.cachedTokens, 0),
    costCents: usages.reduce((n, u) => n + u.costCents, 0),
  };
}

function background(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    // Outside a request context the promise simply runs on its own.
    void p;
  }
}

let anthropicSingleton: AnthropicIntelligence | null = null;
function anthropic(): AnthropicIntelligence {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new LlmError("not_configured", "ANTHROPIC_API_KEY is not set");
  anthropicSingleton ??= AnthropicIntelligence.fromKey(key);
  return anthropicSingleton;
}

export interface GetIntelligenceOptions {
  /** The person the call is for (budget + accounting); null for system work (crawler, cron). */
  userId?: string | null;
  /** Force a provider (admin diagnostics, tests). `anthropic` still needs the key. */
  provider?: ProviderName;
}

class TrackedIntelligence implements Intelligence {
  /** The configured provider; a call may still run on `local` (budget spent, Claude failed). */
  readonly provider: ProviderName;

  constructor(private readonly opts: GetIntelligenceOptions) {
    this.provider = opts.provider ?? selectLlmProvider();
  }

  /**
   * The engine for this call: Claude while the person is within budget, else local (or mock
   * in tests). Checked on every call (cached for a minute and updated with each call's cost),
   * so a long job switches to local as soon as the budget is spent.
   */
  private async primary(): Promise<Intelligence> {
    if (this.provider === "mock") return mockIntelligence;
    if (this.provider !== "anthropic") return localIntelligence;
    try {
      const client = anthropic();
      if (this.opts.userId && !(await withinBudget(this.opts.userId))) return localIntelligence;
      return client;
    } catch (err) {
      await captureError(err, { route: "llm/select", severity: "warn" });
      return localIntelligence;
    }
  }

  private async call<T>(purpose: Purpose, run: (engine: Intelligence, ctx: CallContext) => Promise<T>): Promise<T> {
    const engine = await this.primary();
    const userId = this.opts.userId ?? null;
    const usages: UsageReport[] = [];
    const ctx: CallContext = { userId, report: (u) => usages.push(u) };
    const started = Date.now();
    try {
      const result = await run(engine, ctx);
      const u = sumUsage(usages);
      noteSpend(userId, u.costCents);
      background(logCall({ userId, purpose, provider: engine.provider, model: engine.provider === "local" ? LOCAL_MODEL : u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedTokens: u.cachedTokens, costCents: u.costCents, ms: Date.now() - started, ok: true }));
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      const u = sumUsage(usages);
      noteSpend(userId, u.costCents);
      const message = err instanceof Error ? `${err.name}: ${err.message}${err instanceof LlmError && err.detail ? ` (${err.detail})` : ""}` : String(err);
      background(logCall({ userId, purpose, provider: engine.provider, model: engine.provider === "local" ? LOCAL_MODEL : u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedTokens: u.cachedTokens, costCents: u.costCents, ms, ok: false, error: message }));
      if (engine.provider === "local") throw err;
      await captureError(err, { route: `llm/${purpose}`, severity: "warn", context: { provider: engine.provider, code: err instanceof LlmError ? err.code : null } });
      // The person still gets an answer: the deterministic engine takes over.
      const t2 = Date.now();
      const result = await run(localIntelligence, { userId });
      background(logCall({ userId, purpose, provider: "local", model: LOCAL_MODEL, ms: Date.now() - t2, ok: true }));
      return result;
    }
  }

  extractProfile(input: ExtractProfileInput) {
    return this.call("extract_profile", (e, ctx) => e.extractProfile(input, ctx));
  }
  normalizeOpportunity(input: NormalizeOpportunityInput) {
    return this.call("normalize_opportunity", (e, ctx) => e.normalizeOpportunity(input, ctx));
  }
  scoreMatches(input: ScoreMatchesInput) {
    return this.call("score_matches", (e, ctx) => e.scoreMatches(input, ctx));
  }
  compose(input: ComposeInput) {
    return this.call("compose", (e, ctx) => e.compose(input, ctx));
  }
  answerQuestions(input: AnswerQuestionsInput) {
    return this.call("answer_questions", (e, ctx) => e.answerQuestions(input, ctx));
  }
  classifyReply(input: ClassifyReplyInput) {
    return this.call("classify_reply", (e, ctx) => e.classifyReply(input, ctx));
  }
  mapFormFields(input: MapFormFieldsInput) {
    return this.call("map_form_fields", (e, ctx) => e.mapFormFields(input, ctx));
  }
  planBrowserStep(input: PlanBrowserStepInput) {
    return this.call("plan_browser_step", (e, ctx) => e.planBrowserStep(input, ctx));
  }
}

/**
 * The intelligence for one person (or for system work with `userId: null`). Cheap to create:
 * create one per request/job. The provider is resolved lazily on the first call.
 */
export function getIntelligence(opts: GetIntelligenceOptions = {}): Intelligence {
  return new TrackedIntelligence(opts);
}
