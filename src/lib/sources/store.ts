import "server-only";
import { and, eq, getTableColumns, inArray, lt, or, isNull, sql, type SQL } from "drizzle-orm";
import type { SourceConfig, SourceKind } from "@/lib/core/types";
import { db } from "@/lib/db";
import { opportunities, opportunitySnapshots, sources, type SourceRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { MappedOpportunity } from "./types";

/*
 * Writes of the sources layer. Neon over HTTP has no interactive transactions, so every write
 * is idempotent: opportunities upsert by (source_id, source_ref) — or by slug for curated and
 * built-in entries — snapshots by (opportunity_id, hash), sources by (kind, url).
 * An opportunity an admin marked `rejected` stays rejected whatever a source says.
 */

const CHUNK = 100;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const OPP_COLUMNS = getTableColumns(opportunities);
type OppKey = keyof typeof OPP_COLUMNS;

/** `SET col = excluded.col` for the given columns. */
function excludedSet(keys: readonly OppKey[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const k of keys) set[k] = sql.raw(`excluded."${OPP_COLUMNS[k].name}"`);
  return set;
}

/** Columns a source refreshes on every change (never id, slug, created_at or the generated search vector). */
const REFRESHED: OppKey[] = [
  "type", "name", "orgName", "orgSlug", "url", "summary", "description", "benefits", "cost", "geo", "languages", "tags", "industries", "functions",
  "eligibility", "deadline", "rolling", "cycle", "apply", "requiredMaterials", "estAcceptanceRate", "estEffortMinutes", "qualityScore", "verifiedAt", "public",
];

const KEEP_REJECTED = sql`case when ${opportunities.status} = 'rejected' then 'rejected' else excluded."status" end`;

/** Content columns (REFRESHED minus the bookkeeping ones) whose change is a real update. */
const CONTENT_KEYS = REFRESHED.filter((k) => k !== "verifiedAt" && k !== "qualityScore" && k !== "estAcceptanceRate");

/** `now()` when any content column differs from what is stored, else the stored updated_at. */
const CONTENT_CHANGED_AT = sql.raw(
  `case when (${CONTENT_KEYS.map((k) => `"opportunities"."${OPP_COLUMNS[k].name}"`).join(", ")}) is distinct from (${CONTENT_KEYS.map((k) => `excluded."${OPP_COLUMNS[k].name}"`).join(", ")}) then now() else "opportunities"."updated_at" end`,
);

function rowsFor(sourceId: string | null, items: readonly MappedOpportunity[]) {
  return items.map((m) => ({ id: newId("opp"), ...m.draft, sourceId, sourceRef: m.sourceRef }));
}

/** True for a unique violation of the slug index (a posting re-filed under a re-created source row). */
export function isSlugConflict(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { code?: unknown; constraint?: unknown; message?: unknown };
    if (x.code === "23505" && (x.constraint === "opportunities_slug_uq" || String(x.message ?? "").includes("opportunities_slug_uq"))) return true;
  }
  return false;
}

/** Upserts postings of one source by (source_id, source_ref). Returns the ids by source_ref. */
export async function upsertBySourceRef(sourceId: string, items: readonly MappedOpportunity[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const part of chunks(items)) {
    try {
      const rows = await db
        .insert(opportunities)
        .values(rowsFor(sourceId, part))
        .onConflictDoUpdate({
          target: [opportunities.sourceId, opportunities.sourceRef],
          set: { ...excludedSet(REFRESHED), status: KEEP_REJECTED, updatedAt: sql`now()` },
        })
        .returning({ id: opportunities.id, sourceRef: opportunities.sourceRef });
      for (const r of rows) if (r.sourceRef) ids.set(r.sourceRef, r.id);
    } catch (err) {
      if (!isSlugConflict(err)) throw err;
      // The same posting exists under an older source row: adopt it into this source by slug.
      const bySlug = await upsertBySlug(sourceId, part);
      for (const m of part) {
        const id = bySlug.get(m.draft.slug);
        if (id) ids.set(m.sourceRef, id);
      }
    }
  }
  return ids;
}

/** Upserts curated / built-in entries by slug (they may move between source files). Returns ids by slug. */
export async function upsertBySlug(sourceId: string | null, items: readonly MappedOpportunity[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const part of chunks(items)) {
    const rows = await db
      .insert(opportunities)
      .values(rowsFor(sourceId, part))
      .onConflictDoUpdate({
        target: opportunities.slug,
        // updated_at moves only when the content changed: a re-seed of unchanged entries must not
        // make every curated listing look freshly modified (it is the sitemap's lastmod).
        set: { ...excludedSet([...REFRESHED, "sourceId", "sourceRef"]), status: KEEP_REJECTED, updatedAt: CONTENT_CHANGED_AT },
      })
      .returning({ id: opportunities.id, slug: opportunities.slug });
    for (const r of rows) ids.set(r.slug, r.id);
  }
  return ids;
}

/** Records snapshots (one per content hash; a hash seen again just moves its `fetched_at`). */
export async function recordSnapshots(rows: ReadonlyArray<{ opportunityId: string; hash: string; raw: MappedOpportunity["raw"] }>): Promise<number> {
  let n = 0;
  for (const part of chunks(rows)) {
    const res = await db
      .insert(opportunitySnapshots)
      .values(part.map((r) => ({ id: newId("snp"), opportunityId: r.opportunityId, hash: r.hash, raw: r.raw })))
      .onConflictDoUpdate({ target: [opportunitySnapshots.opportunityId, opportunitySnapshots.hash], set: { fetchedAt: sql`now()` } })
      .returning({ id: opportunitySnapshots.id });
    n += res.length;
  }
  return n;
}

export interface ExistingPosting {
  id: string;
  status: string;
  hash: string | null;
  verifiedAt: Date | null;
}

/** Every posting of a source with its latest snapshot hash. */
export async function existingBySource(sourceId: string): Promise<Map<string, ExistingPosting>> {
  const res = await db.execute(sql`
    select o.id, o.source_ref as "sourceRef", o.status, o.verified_at as "verifiedAt", s.hash
    from ${opportunities} o
    left join lateral (
      select hash from ${opportunitySnapshots} x where x.opportunity_id = o.id order by x.fetched_at desc limit 1
    ) s on true
    where o.source_id = ${sourceId}
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>);
  const out = new Map<string, ExistingPosting>();
  for (const r of rows) {
    if (typeof r.sourceRef !== "string") continue;
    out.set(r.sourceRef, {
      id: String(r.id),
      status: String(r.status),
      hash: typeof r.hash === "string" ? r.hash : null,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt as string) : null,
    });
  }
  return out;
}

/**
 * Marks unchanged postings as seen live again. `verified_at` moves at most once a week per row
 * (a nightly rewrite of every row would only churn storage); expiry uses the run history instead.
 */
export async function touchSeen(sourceId: string, refs: readonly string[], olderThanDays = 7): Promise<number> {
  let n = 0;
  for (const part of chunks(refs, 1000)) {
    const res = await db
      .update(opportunities)
      .set({ verifiedAt: sql`now()` })
      .where(
        and(
          eq(opportunities.sourceId, sourceId),
          inArray(opportunities.sourceRef, part),
          eq(opportunities.status, "active"),
          or(isNull(opportunities.verifiedAt), lt(opportunities.verifiedAt, sql`now() - make_interval(days => ${olderThanDays})`)),
        ),
      )
      .returning({ id: opportunities.id });
    n += res.length;
  }
  return n;
}

/* ------------------------------------------------------------------ sources */

export interface SourceSpec {
  kind: SourceKind;
  name: string;
  url: string;
  config: SourceConfig;
  schedule?: SourceRow["schedule"];
}

/**
 * Upserts source rows by (kind, url). The stored `config.extra` is merged, so run history kept
 * there (seen postings, error streaks) survives a re-seed. Returns the rows by url.
 */
export async function upsertSources(specs: readonly SourceSpec[]): Promise<Map<string, SourceRow>> {
  const out = new Map<string, SourceRow>();
  for (const part of chunks(specs, 200)) {
    const rows = await db
      .insert(sources)
      .values(part.map((s) => ({ id: newId("src"), kind: s.kind, name: s.name, url: s.url, config: s.config, schedule: s.schedule ?? "daily", enabled: true })))
      .onConflictDoUpdate({
        target: [sources.kind, sources.url],
        set: {
          name: sql`excluded."name"`,
          schedule: sql`excluded."schedule"`,
          config: sql`excluded."config" || jsonb_build_object('extra', coalesce(${sources.config} -> 'extra', '{}'::jsonb) || coalesce(excluded."config" -> 'extra', '{}'::jsonb))`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    for (const r of rows) out.set(r.url, r);
  }
  return out;
}

/**
 * Claims a source for a run: sets `last_run_at` when the source is enabled and was not started
 * within the lease (so two runners never read the same board at once). Null when not claimable.
 */
export async function claimSource(id: string, opts: { leaseMinutes?: number; force?: boolean } = {}): Promise<SourceRow | null> {
  const lease = opts.leaseMinutes ?? 15;
  const rows = await db
    .update(sources)
    .set({ lastRunAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      opts.force
        ? and(eq(sources.id, id), eq(sources.enabled, true))
        : and(eq(sources.id, id), eq(sources.enabled, true), or(isNull(sources.lastRunAt), lt(sources.lastRunAt, sql`now() - make_interval(mins => ${lease})`))),
    )
    .returning();
  return rows[0] ?? null;
}

/** Records the outcome of a run and merges `extra` into `config.extra`. */
export async function finishSource(
  id: string,
  outcome: { status: "ok" | "partial" | "error"; count?: number | null; error?: string | null; extra?: Record<string, unknown>; enabled?: boolean },
): Promise<void> {
  const extra = JSON.stringify(outcome.extra ?? {});
  await db
    .update(sources)
    .set({
      lastStatus: outcome.status,
      ...(outcome.count !== undefined ? { lastCount: outcome.count } : {}),
      lastError: outcome.error ?? null,
      ...(outcome.enabled !== undefined ? { enabled: outcome.enabled } : {}),
      config: sql`jsonb_set(coalesce(${sources.config}, '{}'::jsonb), '{extra}', coalesce(${sources.config} -> 'extra', '{}'::jsonb) || ${extra}::jsonb, true)`,
      updatedAt: sql`now()`,
    })
    .where(eq(sources.id, id));
}

/** Current database size in MB (null when it cannot be read). */
export async function databaseSizeMb(): Promise<number | null> {
  const res = await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`);
  const row = ((res as unknown as { rows?: Array<{ bytes: string | number }> }).rows ?? [])[0];
  const bytes = row ? Number(row.bytes) : NaN;
  return Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024) : null;
}
