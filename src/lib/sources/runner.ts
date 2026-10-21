import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { ATS_PROVIDERS, type AtsProvider, type SourceConfig } from "@/lib/core/types";
import { db } from "@/lib/db";
import { sources, type SourceRow } from "@/lib/db/schema";
import { intEnv } from "@/lib/env";
import { ATS_CLIENTS, boardContext, isAtsProvider } from "./ats";
import { AtsHttpError, buildJob, mapPool, newestFirst } from "./ats/common";
import { reverifyPrograms, type VerifyReport } from "./crawl";
import { dedupeJobs } from "./dedupe";
import { expirePastDeadlines, expireUnlisted, keptRefs, purgeClosedJobs, pushRun, readSeenRuns, reopenListed } from "./expiry";
import { orgSlugOf } from "./normalize";
import { claimSource, databaseSizeMb, existingBySource, finishSource, recordSnapshots, touchSeen, upsertBySourceRef, upsertSources, type SourceSpec } from "./store";
import type { BoardContext, BoardRef, MappedOpportunity } from "./types";

/*
 * The ingestion runner. `runSources` walks the ATS boards round-robin (least recently run
 * first) within a time budget, then re-verifies a slice of curated program pages. Each board
 * run is complete or recorded as failed — never half-applied in a way that loses postings:
 *   fetch the board → map + dedupe → write new/changed postings (+ snapshots) → mark the
 *   unchanged ones seen → expire postings missing from the last two complete runs.
 * Bookkeeping lives on the `sources` row (last_run_at, last_status, last_count, last_error,
 * config.extra.seenRuns / errorStreak).
 */

/** Postings kept per board (newest first). Big employers list thousands; the cap keeps storage sane. */
export function maxJobsPerBoard(): number {
  return Math.max(1, intEnv("SOURCES_MAX_JOBS_PER_BOARD", 200));
}

/** Above this database size (MB) runs stop adding new postings (updates, expiry and purges go on). */
export function dbSizeLimitMb(): number {
  return Math.max(50, intEnv("SOURCES_DB_SIZE_LIMIT_MB", 420));
}

export type RunScope = AtsProvider | "verify";

export interface RunOptions {
  /** Total time for the run (default 240 s). New boards are not started after it. */
  budgetMs?: number;
  /** Providers and/or "verify" (curated page checks). Default: all. */
  only?: RunScope[];
  /** Only these source rows. */
  sourceIds?: string[];
  /** Boards in flight at once (default 4). */
  concurrency?: number;
  /** Postings kept per board (default SOURCES_MAX_JOBS_PER_BOARD or 200). */
  maxJobsPerBoard?: number;
  /** Ignore the claim lease (operator / seed runs). */
  force?: boolean;
  /** Only boards not run since this time (a "full cycle" that continues across invocations). */
  notRunSince?: Date;
  /** Curated pages checked in the verify phase (default 60). */
  verifyLimit?: number;
  /** Skip the deadline sweep (it also runs in /api/cron/expire) and the purge of long-closed postings. */
  skipDeadlineSweep?: boolean;
  /** Write updates only (set automatically when the database is near its size limit). */
  noInserts?: boolean;
  log?: (line: string) => void;
  /** Called for failures worth an operator's attention (persisting boards errors). */
  report?: (err: unknown, context: Record<string, unknown>) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface BoardOutcome {
  sourceId: string;
  provider: AtsProvider;
  board: string;
  status: "ok" | "partial" | "error" | "skipped";
  listed: number;
  kept: number;
  inserted: number;
  updated: number;
  unchanged: number;
  reopened: number;
  expired: number;
  invalid: number;
  duplicates: number;
  /** New postings not written because the database is near its size limit. */
  held: number;
  error?: string;
  ms: number;
}

export interface RunReport {
  startedAt: string;
  tookMs: number;
  expiredByDeadline: number;
  boards: { selected: number; ran: number; ok: number; partial: number; error: number; skipped: number; remaining: number };
  jobs: { listed: number; kept: number; inserted: number; updated: number; unchanged: number; reopened: number; expired: number; held: number; purged: number };
  /** Database size at the start of the run (MB) and whether new postings were held back. */
  database: { sizeMb: number | null; limitMb: number; insertsPaused: boolean };
  byType: Record<string, number>;
  verify: VerifyReport | null;
  /** Boards that failed (first 30). */
  errors: Array<{ provider: string; board: string; error: string }>;
}

/* ------------------------------------------------------------------ sources rows for boards */

/** `sources` rows of the ATS boards (kind = provider, url = the board's API URL). */
export function boardSourceSpec(b: BoardRef): SourceSpec {
  const ctx = boardContext(b);
  const config: SourceConfig = {
    board: b.token,
    orgName: b.company,
    orgSlug: ctx.orgSlug,
    industries: ctx.industries,
    public: false,
    extra: { hq: b.hq, seedJobCount: b.jobCount ?? null, seedIndustries: b.industries },
  };
  return { kind: b.provider, name: b.company, url: ATS_CLIENTS[b.provider].boardUrl(b.token), config, schedule: "daily" };
}

export async function syncBoardSources(boards: readonly BoardRef[]): Promise<Map<string, SourceRow>> {
  return upsertSources(boards.map(boardSourceSpec));
}

function contextOf(row: SourceRow): BoardContext | null {
  if (!isAtsProvider(row.kind)) return null;
  const cfg = (row.config ?? {}) as SourceConfig;
  const token = cfg.board;
  if (!token) return null;
  const company = cfg.orgName ?? row.name;
  return { provider: row.kind, token, company, orgSlug: cfg.orgSlug ?? orgSlugOf(company) ?? token, industries: cfg.industries ?? [] };
}

/* ------------------------------------------------------------------ one board */

const emptyOutcome = (row: SourceRow, provider: AtsProvider, board: string): BoardOutcome => ({
  sourceId: row.id,
  provider,
  board,
  status: "skipped",
  listed: 0,
  kept: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  reopened: 0,
  expired: 0,
  invalid: 0,
  duplicates: 0,
  held: 0,
  ms: 0,
});

function readStreak(config: unknown): number {
  const n = (config as { extra?: { errorStreak?: unknown } } | null)?.extra?.errorStreak;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Runs one board end to end (claim → fetch → write → expire → bookkeeping).
 * Fetch failures are recorded on the source row (and reported when they persist); a failed
 * write is recorded and reported at once. Only failures of the bookkeeping itself throw.
 */
export async function runBoard(source: SourceRow, opts: RunOptions & { byType?: Record<string, number> } = {}): Promise<BoardOutcome> {
  const started = Date.now();
  const ctx = contextOf(source);
  const provider = (isAtsProvider(source.kind) ? source.kind : "greenhouse") as AtsProvider;
  const out = emptyOutcome(source, provider, ctx?.token ?? "?");
  if (!ctx) {
    out.status = "error";
    out.error = "This source has no board token in its config.";
    await finishSource(source.id, { status: "error", error: out.error });
    return out;
  }
  const claimed = await claimSource(source.id, { force: opts.force });
  if (!claimed) return { ...out, ms: Date.now() - started };
  const runAt = new Date();
  const streak = readStreak(claimed.config);

  let fetched: Awaited<ReturnType<(typeof ATS_CLIENTS)[AtsProvider]["fetchBoard"]>>;
  try {
    fetched = await ATS_CLIENTS[provider].fetchBoard(ctx.token, { signal: opts.signal, fetchImpl: opts.fetchImpl });
  } catch (err) {
    const status = err instanceof AtsHttpError ? err.status : 0;
    const message = err instanceof Error ? err.message : String(err);
    const nextStreak = streak + 1;
    let expired = 0;
    // A board that answers 404 twice in a row is gone (moved ATS or closed): its postings close.
    if (status === 404 && nextStreak >= 2) expired = await expireUnlisted(source.id, []);
    const disable = status === 404 && nextStreak >= 5;
    await finishSource(source.id, {
      status: "error",
      error: `${message}${disable ? " Disabled after 5 failed runs in a row." : ""}`.slice(0, 500),
      extra: { errorStreak: nextStreak, lastErrorStatus: status || null },
      ...(disable ? { enabled: false } : {}),
    });
    if (nextStreak === 3 || disable) await opts.report?.(err, { provider, board: ctx.token, sourceId: source.id, streak: nextStreak });
    opts.log?.(`✗ ${provider}/${ctx.token}: ${message}`);
    return { ...out, status: "error", error: message, expired, ms: Date.now() - started };
  }

  const now = new Date();
  out.listed = fetched.total;
  out.invalid = fetched.invalid;
  const cap = opts.maxJobsPerBoard ?? maxJobsPerBoard();
  const inputs = newestFirst(fetched.inputs).slice(0, cap);
  const mapped: MappedOpportunity[] = [];
  let mappingErrors = 0;
  for (const input of inputs) {
    try {
      mapped.push(buildJob(input, ctx, now));
    } catch (err) {
      mappingErrors++;
      opts.log?.(`  ! ${provider}/${ctx.token}/${input.postingId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const { keep, duplicates } = dedupeJobs(mapped, (m) => ({
    title: m.draft.name,
    type: m.draft.type,
    places: [...(m.draft.geo?.cities ?? []), ...(m.draft.geo?.countries ?? []), m.draft.geo?.remote ?? ""],
  }));
  out.duplicates = duplicates.length;
  out.kept = keep.length;

  try {
    const existing = await existingBySource(source.id);
    const write: MappedOpportunity[] = [];
    const unchangedRefs: string[] = [];
    const expiredSame: string[] = [];
    for (const m of keep) {
      const prev = existing.get(m.sourceRef);
      if (!prev) {
        if (opts.noInserts) {
          out.held++;
          continue;
        }
        write.push(m);
        out.inserted++;
      } else if (prev.hash !== m.hash) {
        write.push(m);
        out.updated++;
      } else {
        unchangedRefs.push(m.sourceRef);
        out.unchanged++;
        if (prev.status === "expired") expiredSame.push(m.sourceRef);
      }
    }
    if (write.length) {
      const ids = await upsertBySourceRef(source.id, write);
      await recordSnapshots(write.flatMap((m) => (ids.get(m.sourceRef) ? [{ opportunityId: ids.get(m.sourceRef) as string, hash: m.hash, raw: m.raw }] : [])));
    }
    if (unchangedRefs.length) await touchSeen(source.id, unchangedRefs);
    if (expiredSame.length) out.reopened = await reopenListed(source.id, expiredSame);

    const history = pushRun(readSeenRuns(claimed.config), { at: runAt.toISOString(), refs: keep.map((m) => m.sourceRef) });
    // Nothing closes until two complete runs are on record (one missed listing can be a hiccup).
    if (history.length >= 2) out.expired = await expireUnlisted(source.id, keptRefs(history));

    const partial = fetched.invalid > 0 || mappingErrors > 0;
    out.status = partial ? "partial" : "ok";
    await finishSource(source.id, {
      status: out.status,
      count: keep.length,
      error: partial ? `${fetched.invalid + mappingErrors} posting(s) could not be read.` : null,
      extra: { seenRuns: history, errorStreak: 0, lastErrorStatus: null, listed: fetched.total },
    });
  } catch (err) {
    // A write failed for this board: record it, tell the operator, keep going with the others.
    const message = `Saving this board failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
    await opts.report?.(err, { provider, board: ctx.token, sourceId: source.id, phase: "write" });
    await finishSource(source.id, { status: "error", error: message, extra: { errorStreak: streak + 1 } });
    opts.log?.(`✗ ${provider}/${ctx.token}: ${message}`);
    return { ...out, status: "error", error: message, ms: Date.now() - started };
  }
  if (opts.byType) for (const m of keep) opts.byType[m.draft.type] = (opts.byType[m.draft.type] ?? 0) + 1;
  out.ms = Date.now() - started;
  opts.log?.(
    `✓ ${provider}/${ctx.token}: ${fetched.total} listed, ${keep.length} kept (+${out.inserted} new, ${out.updated} changed, ${out.unchanged} same, ${out.expired} closed) in ${out.ms} ms`,
  );
  return out;
}

/* ------------------------------------------------------------------ the run */

/** Board sources due for a run, least recently run first. */
export async function dueBoards(opts: { providers: AtsProvider[]; sourceIds?: string[]; notRunSince?: Date; limit?: number }): Promise<SourceRow[]> {
  if (!opts.providers.length) return [];
  const conds = [eq(sources.enabled, true), inArray(sources.kind, opts.providers)];
  if (opts.sourceIds?.length) conds.push(inArray(sources.id, opts.sourceIds));
  if (opts.notRunSince) {
    const c = or(isNull(sources.lastRunAt), lt(sources.lastRunAt, opts.notRunSince));
    if (c) conds.push(c);
  }
  return db
    .select()
    .from(sources)
    .where(and(...conds))
    .orderBy(sql`${sources.lastRunAt} asc nulls first`, asc(sources.id))
    .limit(opts.limit ?? 5000);
}

/**
 * One ingestion pass within `budgetMs`: deadline sweep, ATS boards round-robin, then curated
 * page re-verification with the remaining time (about a fifth of the budget).
 */
export async function runSources(opts: RunOptions = {}): Promise<RunReport> {
  const startedAt = new Date();
  const start = startedAt.getTime();
  const budget = Math.max(5_000, opts.budgetMs ?? 240_000);
  const scopes = new Set<RunScope>(opts.only?.length ? opts.only : [...ATS_PROVIDERS, "verify"]);
  const providers = ATS_PROVIDERS.filter((p) => scopes.has(p));
  const verify = scopes.has("verify") && !opts.sourceIds?.length;
  const atsEnd = start + (verify && providers.length ? budget * 0.8 : budget);
  const end = start + budget;

  // Fetches in flight are cut 40 s after the budget at the latest (a 300 s function stays inside).
  const hard = new AbortController();
  const hardTimer = setTimeout(() => hard.abort(), budget + 40_000);
  const onOuterAbort = () => hard.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  const report: RunReport = {
    startedAt: startedAt.toISOString(),
    tookMs: 0,
    expiredByDeadline: 0,
    boards: { selected: 0, ran: 0, ok: 0, partial: 0, error: 0, skipped: 0, remaining: 0 },
    jobs: { listed: 0, kept: 0, inserted: 0, updated: 0, unchanged: 0, reopened: 0, expired: 0, held: 0, purged: 0 },
    database: { sizeMb: null, limitMb: dbSizeLimitMb(), insertsPaused: false },
    byType: {},
    verify: null,
    errors: [],
  };
  try {
    if (!opts.skipDeadlineSweep) {
      report.expiredByDeadline = await expirePastDeadlines(startedAt);
      report.jobs.purged = await purgeClosedJobs();
    }
    report.database.sizeMb = await databaseSizeMb();
    let noInserts = Boolean(opts.noInserts);
    if (report.database.sizeMb !== null && report.database.sizeMb > report.database.limitMb) {
      noInserts = true;
      await opts.report?.(new Error(`Database is ${report.database.sizeMb} MB (limit ${report.database.limitMb} MB): new job postings are held back.`), { sizeMb: report.database.sizeMb });
    }
    report.database.insertsPaused = noInserts;

    const due = await dueBoards({ providers, sourceIds: opts.sourceIds, notRunSince: opts.notRunSince });
    report.boards.selected = due.length;
    const outcomes = await mapPool(
      due,
      Math.max(1, opts.concurrency ?? 4),
      (row) => runBoard(row, { ...opts, noInserts, signal: hard.signal, byType: report.byType }),
      () => Date.now() > atsEnd - 15_000 || hard.signal.aborted,
    );
    for (const o of outcomes) {
      if (!o) {
        report.boards.remaining++;
        continue;
      }
      if (o.status === "skipped") {
        report.boards.skipped++;
        continue;
      }
      report.boards.ran++;
      report.boards[o.status]++;
      report.jobs.listed += o.listed;
      report.jobs.kept += o.kept;
      report.jobs.inserted += o.inserted;
      report.jobs.updated += o.updated;
      report.jobs.unchanged += o.unchanged;
      report.jobs.reopened += o.reopened;
      report.jobs.expired += o.expired;
      report.jobs.held += o.held;
      if (o.status === "error" && report.errors.length < 30) report.errors.push({ provider: o.provider, board: o.board, error: o.error ?? "failed" });
    }

    if (verify && Date.now() < end - 10_000) {
      report.verify = await reverifyPrograms({ limit: opts.verifyLimit ?? 60, deadline: end - 5_000, signal: hard.signal });
    }
  } finally {
    clearTimeout(hardTimer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
    report.tookMs = Date.now() - start;
  }
  return report;
}
