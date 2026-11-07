import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /api/health semantics: 200 while the site can serve (database reachable, required config
 * present); open errors in the inbox are reported but never make it 503. Database, env and the
 * error inbox replaced by fakes.
 */
const state = vi.hoisted(() => ({ unresolved: 0, dbDown: false, missing: [] as string[] }));

vi.mock("@/lib/db/schema", () => ({ errorGroups: {} }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (state.dbDown) throw new Error("connect ETIMEDOUT");
          return [{ n: state.unresolved }];
        },
      }),
    }),
  },
}));
vi.mock("@/lib/admin", () => ({ bearerMatches: () => false }));
vi.mock("@/lib/errors", () => ({ captureError: async () => undefined, HEALTH_SOURCES: ["server", "edge", "worker", "cron"] }));
vi.mock("@/lib/env", () => ({
  env: () => undefined,
  envProblems: () => ({ missing: state.missing, invalid: [] }),
  features: () => ({ llmProvider: "mock", gmail: false, mailer: false, browserAgent: false }),
  REQUIRED_ENV: ["DATABASE_URL", "CRON_SECRET"],
  stripeKeyMode: () => "test",
  VERCEL_ENV: "test",
}));

import { GET } from "@/app/api/health/route";

const get = async (qs = "") => {
  const res = await GET(new Request(`https://onwardscout.com/api/health${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  state.unresolved = 0;
  state.dbDown = false;
  state.missing = [];
});

describe("/api/health", () => {
  it("answers 200 and still reports the count when severe errors are open", async () => {
    state.unresolved = 3;
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual({ unresolvedSevere: 3 });
    expect(body.db).toMatchObject({ ok: true });
    expect(body.config).toMatchObject({ required: 2, missingCount: 0, invalidCount: 0 });
  });

  it("answers 503 when the database is unreachable", async () => {
    state.dbDown = true;
    const { status, body } = await get();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.db).toMatchObject({ ok: false });
    expect(body.errors).toEqual({ unresolvedSevere: -1 });
  });

  it("answers 503 when a required variable is missing, full or shallow, without naming it publicly", async () => {
    state.missing = ["CRON_SECRET"];
    const full = await get();
    expect(full.status).toBe(503);
    expect(JSON.stringify(full.body)).not.toContain("CRON_SECRET");
    const shallow = await get("?shallow=1");
    expect(shallow.status).toBe(503);
    expect(shallow.body).toMatchObject({ ok: false, shallow: true });
  });

  it("shallow probe answers 200 without touching the database", async () => {
    state.dbDown = true;
    const { status, body } = await get("?shallow=1");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, shallow: true });
  });
});
