/**
 * Environment helpers. Values are read lazily (never at import time) so a missing optional
 * variable degrades one feature instead of crashing the whole app. Pure: safe in the proxy,
 * route handlers, server components and tests.
 */

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

/** An integer variable with a default; a malformed value falls back to the default. */
export function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw || !/^-?\d+$/.test(raw)) return fallback;
  return Number(raw);
}

/**
 * Which deployment this is, as Vercel labels it. Off Vercel (a local `next build && next start`,
 * any other host) there is no production deployment: VERCEL_ENV falls back to "development",
 * so live-key checkout, the production env tag on Stripe sessions and indexing all stay off.
 */
export const VERCEL_ENV = process.env.VERCEL_ENV ?? "development";
export const IS_PRODUCTION_DEPLOY = process.env.VERCEL_ENV === "production";

/**
 * The site is indexable only on the production deployment AND once SITE_INDEXABLE=1.
 * Until launch every environment sends noindex at both the meta and header level.
 */
export function isIndexable(): boolean {
  return process.env.VERCEL_ENV === "production" && process.env.SITE_INDEXABLE === "1";
}

export function adminEmails(): string[] {
  return (env("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

/** Variables the site needs to be fully functional; /api/health reports which are missing (names only). */
export const REQUIRED_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_CONTEXT",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_PACK_10",
  "STRIPE_PRICE_PACK_40",
  "FILES_BASE_URL",
  "FILES_SIGNING_SECRET",
  "FILES_API_TOKEN",
  "MAIL_WORKER_URL",
  "MAIL_WORKER_TOKEN",
  "INBOX_INGEST_SECRET",
  "INBOX_READ_TOKEN",
  "CRON_SECRET",
  "ADMIN_EMAILS",
  "NEXT_PUBLIC_FLOWGLANCE_KEY",
  "INTEGRATION_KEY",
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

export const LLM_PROVIDERS = ["anthropic", "local", "mock"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** INTEGRATION_KEY is a 32-byte AES-256 key written as 64 hex characters. */
export const INTEGRATION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export interface EnvProblems {
  /** Required (or required-by-configuration) variables that are not set. */
  missing: string[];
  /** Variables that are set but unusable, with a short reason. Names and reasons only, never values. */
  invalid: { name: string; reason: string }[];
}

/**
 * Everything wrong with the configuration, by name. /api/health turns red on any entry.
 * `vars` is injectable for tests; it defaults to process.env.
 */
export function envProblems(vars: Record<string, string | undefined> = process.env): EnvProblems {
  const get = (n: string) => {
    const v = vars[n];
    return v && v.trim() !== "" ? v.trim() : undefined;
  };
  const missing: string[] = REQUIRED_ENV.filter((n) => !get(n));
  const invalid: { name: string; reason: string }[] = [];

  // An explicit request for Claude without its key is a misconfiguration (the selection rule
  // would silently fall back to the local engine and nobody would notice).
  const requested = get("LLM_PROVIDER");
  if (requested && !(LLM_PROVIDERS as readonly string[]).includes(requested)) {
    invalid.push({ name: "LLM_PROVIDER", reason: `must be one of ${LLM_PROVIDERS.join(", ")}` });
  }
  if (requested === "anthropic" && !get("ANTHROPIC_API_KEY")) missing.push("ANTHROPIC_API_KEY");
  // Canned output must never reach real users.
  if (requested === "mock" && get("VERCEL_ENV") === "production") {
    invalid.push({ name: "LLM_PROVIDER", reason: "mock is for tests only and is refused on production" });
  }

  const key = get("INTEGRATION_KEY");
  if (key && !INTEGRATION_KEY_PATTERN.test(key)) invalid.push({ name: "INTEGRATION_KEY", reason: "must be 64 hex characters (32 bytes)" });

  const files = get("FILES_BASE_URL");
  if (files && !/^https?:\/\/[^/\s]+/.test(files)) invalid.push({ name: "FILES_BASE_URL", reason: "must be an absolute http(s) URL" });
  const mail = get("MAIL_WORKER_URL");
  if (mail && !/^https?:\/\/[^/\s]+/.test(mail)) invalid.push({ name: "MAIL_WORKER_URL", reason: "must be an absolute http(s) URL" });

  // Optional pairs: half a pair is a broken feature.
  if (Boolean(get("GOOGLE_OAUTH_CLIENT_ID")) !== Boolean(get("GOOGLE_OAUTH_CLIENT_SECRET"))) {
    missing.push(get("GOOGLE_OAUTH_CLIENT_ID") ? "GOOGLE_OAUTH_CLIENT_SECRET" : "GOOGLE_OAUTH_CLIENT_ID");
  }
  if (Boolean(get("RESEND_API_KEY")) !== Boolean(get("MAIL_FROM"))) {
    missing.push(get("RESEND_API_KEY") ? "MAIL_FROM" : "RESEND_API_KEY");
  }

  // A production build that does not know its deployment runs with every production-only feature off.
  if (get("NODE_ENV") === "production" && !get("VERCEL_ENV")) missing.push("VERCEL_ENV");
  return { missing, invalid };
}

/** Names of missing variables (see `envProblems` for invalid ones). */
export function missingEnv(): string[] {
  return envProblems().missing;
}

/**
 * The intelligence provider for this request: LLM_PROVIDER when it names a known provider,
 * else `anthropic` when ANTHROPIC_API_KEY is set, else `local`. An explicit `anthropic`
 * without a key degrades to `local` (and /api/health reports the missing key); `mock` is
 * never served on the production deployment.
 */
export function selectLlmProvider(vars: Record<string, string | undefined> = process.env): LlmProvider {
  const get = (n: string) => {
    const v = vars[n];
    return v && v.trim() !== "" ? v.trim() : undefined;
  };
  const hasKey = Boolean(get("ANTHROPIC_API_KEY"));
  const requested = get("LLM_PROVIDER");
  if (requested === "mock") return get("VERCEL_ENV") === "production" ? (hasKey ? "anthropic" : "local") : "mock";
  if (requested === "local") return "local";
  if (requested === "anthropic") return hasKey ? "anthropic" : "local";
  return hasKey ? "anthropic" : "local";
}

export interface Features {
  /** Which engine answers the Intelligence interface (src/lib/llm). */
  llmProvider: LlmProvider;
  /** Gmail outreach (CH4) can be connected: Google OAuth client configured. */
  gmail: boolean;
  /** Product email to users (digest, "needs you") goes out through Resend; otherwise in-app only. */
  mailer: boolean;
  /** The browser agent (CH3) may run; otherwise those applications go to the handoff panel. */
  browserAgent: boolean;
}

/**
 * Optional capabilities, resolved from the environment at call time. Everything else keeps
 * working when a feature is off: the UI says so instead of failing.
 */
export function features(vars: Record<string, string | undefined> = process.env): Features {
  const has = (n: string) => Boolean(vars[n] && vars[n]!.trim() !== "");
  return {
    llmProvider: selectLlmProvider(vars),
    gmail: has("GOOGLE_OAUTH_CLIENT_ID") && has("GOOGLE_OAUTH_CLIENT_SECRET"),
    mailer: has("RESEND_API_KEY") && has("MAIL_FROM"),
    browserAgent: (vars.BROWSER_AGENT_ENABLED ?? "").trim() === "1",
  };
}

/** The per-user monthly LLM budget in US cents (LLM_USER_MONTHLY_CENTS, default 300). */
export function llmUserMonthlyCents(): number {
  return Math.max(0, intEnv("LLM_USER_MONTHLY_CENTS", 300));
}

/** Which Stripe key is configured, by its shape only: `live`, `test` or `missing`. */
export function stripeKeyMode(vars: Record<string, string | undefined> = process.env): "live" | "test" | "missing" {
  const key = (vars.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return "missing";
  return /_test_/.test(key) ? "test" : "live";
}
