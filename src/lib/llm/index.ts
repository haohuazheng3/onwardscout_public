import "server-only";
import { waitUntil } from "@vercel/functions";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appState, applications, llmCalls } from "@/lib/db/schema";
import { env, llmApplicationCents, llmUserMonthlyCents, selectLlmProvider } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { notifyOwner } from "@/lib/notify";
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
  type RecommendDirectionsInput,
  type ReviseDocumentInput,
  type ProviderName,
  type Purpose,
  type ScoreMatchesInput,
  type UsageReport,
} from "./types";

/*
 * The one entry point features use: `getIntelligence({ userId, applicationId })`.
 *
 * Selection (build contract): LLM_PROVIDER when set, else `anthropic` when ANTHROPIC_API_KEY is
 * set, else `local` (src/lib/env.ts `selectLlmProvider`; `mock` is refused on production).
 *
 * Claude is only for paid work (owner decision 2026-11-03: the API budget goes to the people who
 * bought an application). A call runs on Claude only when it names an **unlocked** application
 * (`applicationId` whose row has `unlocked_at`, i.e. paid $19 once or a pass credit) or when an
 * internal job that already checked passes `paid: true`; everything else — signed-out drafts, the
 * free preview, onboarding plans, matching, the crawler, system work — runs on the deterministic
 * local engine at no cost. Paid work is budgeted twice: per application (LLM_APPLICATION_CENTS,
 * default $2.50) and per person per calendar month (LLM_USER_MONTHLY_CENTS, default $20); over
 * either, the call runs on `local`.
 *
 * Any Claude failure (timeout, API error, refusal, truncated or invalid output) is logged
 * (llm_calls ok=false + error inbox as a warning) and the call is answered by `local`, so a
 * person always gets a result. Every call — local ones too, at zero cost — is written to
 * llm_calls in the background, with the application it served.
 */

export * from "./types";
export { MODEL_HAIKU, MODEL_OPUS, PRICES, attemptCostCents, responseCostCents } from "./prices";
export { localIntelligence } from "./provider-local";
export { classifyQuestion } from "./local/compose";
export { feedbackIntent, type FeedbackIntent } from "./local/revise";
export { fieldKey, parseAxTree } from "./local/forms";
export { stripQuoted } from "./local/reply";

const LOCAL_MODEL = "local-heuristics";
const BUDGET_TTL_MS = 60_000;

export interface LogCallInput {
  userId?: string | null;
  /** The unlocked application the call worked for, when there is one. */
  applicationId?: string | null;
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
      applicationId: row.applicationId ?? null,
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

/** Cents spent on model calls for one application, over its whole life. */
export async function applicationSpendCents(applicationId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${llmCalls.costCents}), 0)` })
    .from(llmCalls)
    .where(eq(llmCalls.applicationId, applicationId));
  return Number(rows[0]?.total ?? 0);
}

const budgetCache = new Map<string, { at: number; spent: number }>();

/** An anonymous draft (`anon_*`, the signed-out /app/start or /app/apply). */
export function isAnonymousOwner(userId: string): boolean {
  return userId.startsWith("anon_");
}

/**
 * Whether an application was paid for (`unlocked_at` set). Positive answers are remembered for a
 * minute (an unlock never comes back on its own except through a refund); a negative answer is
 * asked again on the next call, so a job that started on the preview switches to Claude the
 * moment the person pays.
 */
const unlockedCache = new Map<string, number>();

async function isUnlockedApplication(applicationId: string): Promise<boolean> {
  const at = unlockedCache.get(applicationId);
  if (at && Date.now() - at < BUDGET_TTL_MS) return true;
  const rows = await db.select({ unlockedAt: applications.unlockedAt }).from(applications).where(eq(applications.id, applicationId)).limit(1);
  const unlocked = Boolean(rows[0]?.unlockedAt);
  if (unlocked) {
    if (unlockedCache.size > 2000) unlockedCache.clear();
    unlockedCache.set(applicationId, Date.now());
  }
  return unlocked;
}

/** Forget a cached unlock (a refund locked the application again). */
export function forgetUnlocked(applicationId: string): void {
  unlockedCache.delete(applicationId);
}

/**
 * While the Claude account cannot be used (credit balance spent, key revoked), every call would
 * fail first and then fall back: the instance stops asking for a while instead, and the owner is
 * told once (at most every 12 hours across instances).
 */
const UNAVAILABLE_PAUSE_MS = 15 * 60_000;
let claudeUnavailableUntil = 0;

async function noteUnavailable(err: LlmError): Promise<void> {
  claudeUnavailableUntil = Date.now() + UNAVAILABLE_PAUSE_MS;
  const claimed = await db
    .insert(appState)
    .values({ key: "llm:unavailable_alert", value: { at: new Date().toISOString(), detail: err.detail ?? err.message } })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value: { at: new Date().toISOString(), detail: err.detail ?? err.message }, updatedAt: sql`now()` },
      setWhere: sql`${appState.updatedAt} < now() - interval '12 hours'`,
    })
    .returning({ key: appState.key });
  if (!claimed.length) return;
  await notifyOwner({
    subject: "Claude API unavailable: paid applications run on the local engine",
    text: `Claude refused a call: ${(err.detail ?? err.message).slice(0, 300)}\n\nUntil it works again every unlocked application is written by the local engine (honest, but plainer). If the credit balance is spent, top it up in the Claude Console (Plans & Billing); nothing else needs to change. The site checks again every 15 minutes.`,
  });
}

async function cachedSpend(key: string, read: () => Promise<number>): Promise<number> {
  const cached = budgetCache.get(key);
  if (cached && Date.now() - cached.at < BUDGET_TTL_MS) return cached.spent;
  const spent = await read();
  budgetCache.set(key, { at: Date.now(), spent });
  return spent;
}

/** Paid work stays within its application's budget and its person's monthly one. */
async function withinBudget(userId: string | null, applicationId: string | null): Promise<boolean> {
  const checks: Promise<boolean>[] = [];
  if (applicationId) checks.push(cachedSpend(`app:${applicationId}`, () => applicationSpendCents(applicationId)).then((spent) => spent < llmApplicationCents()));
  if (userId) checks.push(cachedSpend(userId, () => monthlySpendCents(userId)).then((spent) => spent < llmUserMonthlyCents()));
  return (await Promise.all(checks)).every(Boolean);
}

function noteSpend(userId: string | null | undefined, applicationId: string | null | undefined, cents: number): void {
  if (userId) {
    const c = budgetCache.get(userId);
    if (c) c.spent += cents;
  }
  if (applicationId) {
    const c = budgetCache.get(`app:${applicationId}`);
    if (c) c.spent += cents;
  }
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
  /** The application the call works for: Claude only when it is unlocked (paid). */
  applicationId?: string | null;
  /**
   * The caller already established that this is paid work (an internal job for an unlocked
   * application, e.g. reading the profile again before it is written). Never set from a request.
   */
  paid?: boolean;
  /** Force a provider (admin diagnostics, tests). `anthropic` still needs the key. */
  provider?: ProviderName;
}

class TrackedIntelligence implements Intelligence {
  /** The configured provider; a call may still run on `local` (budget spent, Claude failed). */
  readonly provider: ProviderName;
  /** The engine that actually produced the last result (labels: "Written with AI" only when it was Claude). */
  lastProvider: ProviderName | null = null;

  constructor(private readonly opts: GetIntelligenceOptions) {
    this.provider = opts.provider ?? selectLlmProvider();
  }

  /** Paid work: an unlocked application, or a job that already checked. Asked on every call. */
  private async entitled(): Promise<boolean> {
    if (this.opts.paid === true) return true;
    if (!this.opts.applicationId) return false;
    return isUnlockedApplication(this.opts.applicationId);
  }

  /**
   * The engine for this call: Claude for paid work within its budgets, else local (or mock in
   * tests). Checked on every call (cached for a minute and updated with each call's cost), so a
   * long job switches to Claude the moment its application is paid for, and to local as soon as
   * a budget is spent.
   */
  private async primary(): Promise<Intelligence> {
    if (this.provider === "mock") return mockIntelligence;
    if (this.provider !== "anthropic") return localIntelligence;
    try {
      const client = anthropic();
      if (Date.now() < claudeUnavailableUntil) return localIntelligence;
      if (!(await this.entitled())) return localIntelligence;
      if (!(await withinBudget(this.opts.userId ?? null, this.opts.applicationId ?? null))) return localIntelligence;
      return client;
    } catch (err) {
      await captureError(err, { route: "llm/select", severity: "warn" });
      return localIntelligence;
    }
  }

  private async call<T>(purpose: Purpose, run: (engine: Intelligence, ctx: CallContext) => Promise<T>): Promise<T> {
    const engine = await this.primary();
    const userId = this.opts.userId ?? null;
    const applicationId = this.opts.applicationId ?? null;
    const usages: UsageReport[] = [];
    // Paid work always gets the full settings (the economy tier was for free use, which no longer reaches Claude).
    const ctx: CallContext = { userId, report: (u) => usages.push(u), tier: engine.provider === "anthropic" ? "standard" : undefined };
    const started = Date.now();
    try {
      const result = await run(engine, ctx);
      this.lastProvider = engine.provider;
      const u = sumUsage(usages);
      noteSpend(userId, applicationId, u.costCents);
      background(logCall({ userId, applicationId, purpose, provider: engine.provider, model: engine.provider === "local" ? LOCAL_MODEL : u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedTokens: u.cachedTokens, costCents: u.costCents, ms: Date.now() - started, ok: true }));
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      const u = sumUsage(usages);
      noteSpend(userId, applicationId, u.costCents);
      const message = err instanceof Error ? `${err.name}: ${err.message}${err instanceof LlmError && err.detail ? ` (${err.detail})` : ""}` : String(err);
      background(logCall({ userId, applicationId, purpose, provider: engine.provider, model: engine.provider === "local" ? LOCAL_MODEL : u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cachedTokens: u.cachedTokens, costCents: u.costCents, ms, ok: false, error: message }));
      if (engine.provider === "local") throw err;
      if (err instanceof LlmError && err.code === "unavailable") {
        await noteUnavailable(err).catch((e) => captureError(e, { route: "llm/unavailable", severity: "warn" }));
      } else {
        await captureError(err, { route: `llm/${purpose}`, severity: "warn", context: { provider: engine.provider, code: err instanceof LlmError ? err.code : null } });
      }
      // The person still gets an answer: the deterministic engine takes over.
      const t2 = Date.now();
      const result = await run(localIntelligence, { userId });
      this.lastProvider = "local";
      background(logCall({ userId, applicationId, purpose, provider: "local", model: LOCAL_MODEL, ms: Date.now() - t2, ok: true }));
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
  recommendDirections(input: RecommendDirectionsInput) {
    return this.call("recommend_directions", (e, ctx) => e.recommendDirections(input, ctx));
  }
  reviseDocument(input: ReviseDocumentInput) {
    return this.call("revise_document", (e, ctx) => e.reviseDocument(input, ctx));
  }
}

/** The engine that actually ran an intelligence's last call (falls back to the configured one). */
export function actualProvider(ai: Intelligence): ProviderName {
  return (ai as { lastProvider?: ProviderName | null }).lastProvider ?? ai.provider;
}

/**
 * The engine that produced a person's latest successful call of a kind (from `llm_calls`), e.g.
 * whether their current match ranking really came from Claude. Null when there is none.
 */
export async function lastCallProvider(userId: string, purpose: Purpose): Promise<string | null> {
  const rows = await db
    .select({ provider: llmCalls.provider })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), eq(llmCalls.purpose, purpose), eq(llmCalls.ok, true)))
    .orderBy(sql`${llmCalls.createdAt} desc`)
    .limit(1);
  return rows[0]?.provider ?? null;
}

/**
 * The intelligence for one person and, for paid work, the application it serves (or for system
 * work with `userId: null`). Cheap to create: create one per request/job. The provider is
 * resolved lazily on the first call.
 */
export function getIntelligence(opts: GetIntelligenceOptions = {}): Intelligence {
  return new TrackedIntelligence(opts);
}
