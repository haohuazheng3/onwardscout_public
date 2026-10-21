import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as domain from "@/lib/db/schema/domain";

const tables: PgTable[] = (Object.values(domain) as unknown[]).filter((v): v is PgTable => {
  try {
    return Boolean(getTableConfig(v as PgTable).name);
  } catch {
    return false;
  }
});

function config(table: PgTable) {
  return getTableConfig(table);
}

function indexes(table: PgTable) {
  return config(table).indexes.map((i) => ({
    name: i.config.name,
    unique: Boolean(i.config.unique),
    method: i.config.method ?? "btree",
    columns: i.config.columns.map((c) => ("name" in c ? (c as { name: string }).name : "expr")),
    where: i.config.where ? "partial" : null,
  }));
}

describe("domain schema contract (build contract \"Domain model\")", () => {
  it("defines every domain table", () => {
    expect(tables.map((t) => config(t).name).sort()).toEqual(
      [
        "application_steps", "applications", "authorizations", "contacts", "credit_events", "credit_lots", "documents", "events", "facts",
        "generated_documents", "goals", "integrations", "jobs", "llm_calls", "matches", "messages", "milestones", "notifications",
        "opportunities", "opportunity_snapshots", "orders", "profile_versions", "profiles", "sources", "subscriptions",
      ].sort(),
    );
  });

  it("uses text primary keys, snake_case columns and timestamptz everywhere", () => {
    for (const t of tables) {
      const c = config(t);
      const pk = c.columns.find((col) => col.primary);
      expect(pk?.name, c.name).toBe("id");
      expect(pk?.getSQLType(), c.name).toBe("text");
      for (const col of c.columns) {
        expect(col.name, `${c.name}.${col.name}`).toMatch(/^[a-z][a-z0-9_]*$/);
        if (col.getSQLType().startsWith("timestamp")) expect(col.getSQLType(), `${c.name}.${col.name}`).toBe("timestamp with time zone");
      }
    }
  });

  it("scopes user-owned tables by user_id", () => {
    const userScoped = [
      domain.profiles, domain.documents, domain.facts, domain.goals, domain.milestones, domain.matches, domain.applications,
      domain.generatedDocuments, domain.contacts, domain.messages, domain.events, domain.notifications, domain.authorizations,
      domain.integrations, domain.creditLots, domain.creditEvents, domain.orders, domain.subscriptions,
    ];
    for (const t of userScoped) {
      const col = config(t).columns.find((c) => c.name === "user_id");
      expect(col?.notNull, config(t).name).toBe(true);
    }
  });

  it("has the unique keys that make writes idempotent", () => {
    const uq = (t: PgTable) => indexes(t).filter((i) => i.unique);
    expect(uq(domain.profiles).map((i) => i.columns)).toContainEqual(["user_id"]);
    expect(uq(domain.opportunities).map((i) => i.columns)).toEqual([["slug"], ["source_id", "source_ref"]]);
    expect(uq(domain.matches).map((i) => i.columns)).toEqual([["user_id", "opportunity_id"]]);
    expect(uq(domain.jobs).map((i) => i.columns)).toEqual([["dedupe_key"]]);
    expect(uq(domain.integrations).map((i) => i.columns)).toEqual([["user_id", "provider"]]);
    expect(uq(domain.creditLots).map((i) => i.columns)).toEqual([["source_key"]]);
    expect(uq(domain.orders).map((i) => i.columns)).toEqual([["stripe_session_id"]]);
    expect(uq(domain.applicationSteps).map((i) => i.columns)).toEqual([["application_id", "n"]]);

    const appUq = uq(domain.applications);
    expect(appUq).toHaveLength(1);
    expect(appUq[0]).toMatchObject({ columns: ["user_id", "opportunity_id"], where: "partial" });
    const cevUq = uq(domain.creditEvents);
    expect(cevUq[0]).toMatchObject({ columns: ["application_id", "lot_id", "kind"], where: "partial" });
    expect(uq(domain.authorizations)[0]).toMatchObject({ columns: ["user_id", "scope"], where: "partial" });
  });

  it("indexes the hot queries", () => {
    const names = (t: PgTable) => indexes(t).map((i) => `${i.method}:${i.columns.join(",")}`);
    expect(names(domain.opportunities)).toEqual(
      expect.arrayContaining(["btree:status,type,deadline", "btree:status,public,updated_at", "btree:org_slug", "gin:tags", "gin:search"]),
    );
    expect(names(domain.jobs)).toEqual(expect.arrayContaining(["btree:status,run_after"]));
    expect(names(domain.matches)).toEqual(expect.arrayContaining(["btree:user_id,rank"]));
    expect(names(domain.messages)).toEqual(expect.arrayContaining(["btree:user_id,application_id,created_at"]));
    expect(names(domain.notifications)).toEqual(expect.arrayContaining(["btree:user_id,read_at,created_at"]));
    expect(names(domain.llmCalls)).toEqual(expect.arrayContaining(["btree:user_id,created_at"]));
    expect(names(domain.goals)).toEqual(expect.arrayContaining(["btree:user_id,status,updated_at"]));
  });

  it("renames the reference's job_id to application_id in the credit ledger", () => {
    const cols = config(domain.creditEvents).columns.map((c) => c.name);
    expect(cols).toContain("application_id");
    expect(cols).not.toContain("job_id");
  });

  it("generates the opportunity search vector in the database", () => {
    const search = config(domain.opportunities).columns.find((c) => c.name === "search");
    expect(search?.getSQLType()).toBe("tsvector");
    expect(search?.generated?.type).toBe("always");
  });

  it("defaults honestly: unknown jsonb is null, lists are empty, statuses start at the beginning", () => {
    const col = (t: PgTable, name: string) => config(t).columns.find((c) => c.name === name)!;
    expect(col(domain.opportunities, "benefits").notNull).toBe(false);
    expect(col(domain.opportunities, "eligibility").notNull).toBe(false);
    expect(col(domain.opportunities, "status").default).toBe("unverified");
    expect(col(domain.opportunities, "public").default).toBe(false);
    expect(col(domain.applications, "status").default).toBe("draft");
    expect(col(domain.applications, "practice").default).toBe(false);
    expect(col(domain.facts, "confidence").default).toBe(0);
    expect(col(domain.facts, "confirmed_by_user").default).toBe(false);
    expect(col(domain.profiles, "status").default).toBe("empty");
    expect(col(domain.jobs, "max_attempts").default).toBe(5);
  });
});
