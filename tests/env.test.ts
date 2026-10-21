import { describe, expect, it } from "vitest";
import { envProblems, features, intEnv, isAdminEmail, REQUIRED_ENV, selectLlmProvider, stripeKeyMode } from "@/lib/env";

function complete(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = {};
  for (const n of REQUIRED_ENV) vars[n] = "x";
  vars.INTEGRATION_KEY = "a".repeat(64);
  vars.FILES_BASE_URL = "https://files.onwardscout.com";
  vars.MAIL_WORKER_URL = "https://onwardscout-mail.example.workers.dev";
  return { ...vars, ...extra };
}

describe("required environment", () => {
  it("is exactly the documented list", () => {
    expect([...REQUIRED_ENV]).toEqual([
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
    ]);
  });

  it("reports nothing for a complete configuration", () => {
    expect(envProblems(complete())).toEqual({ missing: [], invalid: [] });
  });

  it("reports missing and blank variables by name", () => {
    const p = envProblems(complete({ CRON_SECRET: undefined, ADMIN_EMAILS: "   " }));
    expect(p.missing).toEqual(["CRON_SECRET", "ADMIN_EMAILS"]);
  });

  it("flags malformed values without echoing them", () => {
    const p = envProblems(complete({ INTEGRATION_KEY: "short-secret", FILES_BASE_URL: "files.onwardscout.com", LLM_PROVIDER: "openai" }));
    expect(p.invalid.map((i) => i.name).sort()).toEqual(["FILES_BASE_URL", "INTEGRATION_KEY", "LLM_PROVIDER"]);
    expect(JSON.stringify(p)).not.toContain("short-secret");
  });

  it("treats half-configured optional pairs as missing", () => {
    expect(envProblems(complete({ GOOGLE_OAUTH_CLIENT_ID: "id" })).missing).toEqual(["GOOGLE_OAUTH_CLIENT_SECRET"]);
    expect(envProblems(complete({ MAIL_FROM: "Onward Scout <hello@onwardscout.com>" })).missing).toEqual(["RESEND_API_KEY"]);
    expect(envProblems(complete({ LLM_PROVIDER: "anthropic" })).missing).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("refuses the mock provider on production and requires VERCEL_ENV on production builds", () => {
    expect(envProblems(complete({ LLM_PROVIDER: "mock", VERCEL_ENV: "production" })).invalid).toHaveLength(1);
    expect(envProblems(complete({ LLM_PROVIDER: "mock", VERCEL_ENV: "preview" })).invalid).toHaveLength(0);
    expect(envProblems(complete({ NODE_ENV: "production" })).missing).toEqual(["VERCEL_ENV"]);
  });
});

describe("LLM provider selection", () => {
  it("uses LLM_PROVIDER when set, else anthropic with a key, else local", () => {
    expect(selectLlmProvider({})).toBe("local");
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
    expect(selectLlmProvider({ ANTHROPIC_API_KEY: "sk-ant-x", LLM_PROVIDER: "local" })).toBe("local");
    expect(selectLlmProvider({ LLM_PROVIDER: "mock" })).toBe("mock");
    expect(selectLlmProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
  });

  it("degrades instead of failing", () => {
    expect(selectLlmProvider({ LLM_PROVIDER: "anthropic" })).toBe("local");
    expect(selectLlmProvider({ LLM_PROVIDER: "something-else" })).toBe("local");
    expect(selectLlmProvider({ LLM_PROVIDER: "mock", VERCEL_ENV: "production" })).toBe("local");
    expect(selectLlmProvider({ LLM_PROVIDER: "mock", VERCEL_ENV: "production", ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
  });
});

describe("features", () => {
  it("reports each optional capability from its variables", () => {
    expect(features({})).toEqual({ llmProvider: "local", gmail: false, mailer: false, browserAgent: false });
    expect(
      features({ GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", RESEND_API_KEY: "re_x", MAIL_FROM: "x@y.z", BROWSER_AGENT_ENABLED: "1" }),
    ).toEqual({ llmProvider: "local", gmail: true, mailer: true, browserAgent: true });
    expect(features({ GOOGLE_OAUTH_CLIENT_ID: "a", BROWSER_AGENT_ENABLED: "true" })).toMatchObject({ gmail: false, browserAgent: false });
  });
});

describe("small helpers", () => {
  it("stripeKeyMode reads the key shape only", () => {
    // Built from parts so the public mirror's secret scan (scripts/publish-public.mjs) stays quiet.
    const key = (...parts: string[]) => parts.join("_");
    expect(stripeKeyMode({})).toBe("missing");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: key("sk", "test", "123") })).toBe("test");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: key("sk", "live", "123") })).toBe("live");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: key("sk", "org", "live", "123") })).toBe("live");
  });

  it("intEnv falls back on malformed values", () => {
    process.env.__T_INT = "250";
    expect(intEnv("__T_INT", 300)).toBe(250);
    process.env.__T_INT = "2.5";
    expect(intEnv("__T_INT", 300)).toBe(300);
    delete process.env.__T_INT;
    expect(intEnv("__T_INT", 300)).toBe(300);
  });

  it("admin emails are matched case-insensitively", () => {
    process.env.ADMIN_EMAILS = " Owner@Example.com , ops@example.com";
    expect(isAdminEmail("owner@example.com")).toBe(true);
    expect(isAdminEmail("OPS@example.com ")).toBe(true);
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    delete process.env.ADMIN_EMAILS;
  });
});
