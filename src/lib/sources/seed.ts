import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parseBoards } from "./ats";
import { CURATED_DIR, curatedSourceOf, loadCurated, mapCuratedEntry, type CuratedFileEntry } from "./curated";
import { dedupe } from "./dedupe";
import { PRACTICE_SOURCE, practiceOpportunity } from "./practice";
import { recordSnapshots, upsertBySlug, upsertSources } from "./store";
import type { BoardRef, CuratedInvalid, CuratedWarning, MappedOpportunity } from "./types";

/*
 * Seed loading (idempotent): curated programs by slug, the practice opportunity, and one
 * `sources` row per ATS board. Used by scripts/sources/seed.mts and available to admin tools.
 */

export const BOARDS_FILE = path.join(process.cwd(), "content", "seed", "ats-boards.json");

/** Reads content/seed/ats-boards.json; invalid rows are reported, never fatal. */
export function loadBoards(file: string = BOARDS_FILE): { boards: BoardRef[]; invalid: Array<{ index: number; issues: string[] }>; error: string | null } {
  try {
    return { ...parseBoards(JSON.parse(fs.readFileSync(file, "utf8"))), error: null };
  } catch (err) {
    return { boards: [], invalid: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CuratedSeedReport {
  files: number;
  valid: number;
  invalid: CuratedInvalid[];
  unreadable: Array<{ file: string; error: string }>;
  duplicateSlugs: Array<{ slug: string; files: string[] }>;
  /** Same program listed twice under different slugs (second one skipped). */
  duplicates: Array<{ slug: string; of: string; reason: string }>;
  sharedUrl: Array<{ slug: string; with: string }>;
  warnings: CuratedWarning[];
  written: number;
  snapshots: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  public: number;
}

/** Validates, maps, dedupes and upserts every curated entry. `dryRun` maps without writing. */
export async function seedCurated(opts: { dir?: string; now?: Date; dryRun?: boolean } = {}): Promise<CuratedSeedReport> {
  const now = opts.now ?? new Date();
  const load = loadCurated(opts.dir ?? CURATED_DIR);
  const report: CuratedSeedReport = {
    files: new Set(load.entries.map((e) => e.file)).size,
    valid: load.entries.length,
    invalid: load.invalid,
    unreadable: load.unreadable,
    duplicateSlugs: load.duplicateSlugs,
    duplicates: [],
    sharedUrl: [],
    warnings: [],
    written: 0,
    snapshots: 0,
    byType: {},
    byStatus: {},
    public: 0,
  };
  const dd = dedupe(load.entries, (e) => ({ url: e.entry.url, org: e.entry.org, name: e.entry.name, type: e.entry.type }));
  report.duplicates = dd.duplicates.map((d) => ({ slug: d.item.entry.slug, of: d.of.entry.slug, reason: `${d.reason} (${d.similarity.toFixed(2)})` }));
  report.sharedUrl = dd.sharedUrl.map((s) => ({ slug: s.item.entry.slug, with: s.with.entry.slug }));

  const byFile = new Map<string, Array<{ item: CuratedFileEntry; mapped: MappedOpportunity }>>();
  for (const item of dd.keep) {
    const { mapped, warnings } = mapCuratedEntry(item, now);
    report.warnings.push(...warnings);
    report.byType[mapped.draft.type] = (report.byType[mapped.draft.type] ?? 0) + 1;
    const status = mapped.draft.status ?? "unverified";
    report.byStatus[status] = (report.byStatus[status] ?? 0) + 1;
    if (mapped.draft.public && status === "active") report.public++;
    byFile.set(item.file, [...(byFile.get(item.file) ?? []), { item, mapped }]);
  }
  if (opts.dryRun) return report;

  const sourceRows = await upsertSources(
    [...byFile.keys()].map((file) => ({ kind: "manual" as const, ...curatedSourceOf(file), config: { public: true, notes: `Hand-verified programs from content/seed/curated/${file}` }, schedule: "weekly" as const })),
  );
  for (const [file, items] of byFile) {
    const src = sourceRows.get(curatedSourceOf(file).url);
    if (!src) throw new Error(`Source row for ${file} was not created.`);
    const ids = await upsertBySlug(src.id, items.map((i) => i.mapped));
    report.written += ids.size;
    report.snapshots += await recordSnapshots(
      items.flatMap(({ mapped }) => {
        const id = ids.get(mapped.draft.slug);
        return id ? [{ opportunityId: id, hash: mapped.hash, raw: mapped.raw }] : [];
      }),
    );
  }
  return report;
}

/** Upserts the built-in practice opportunity. Returns its id. */
export async function seedPractice(now: Date = new Date()): Promise<string> {
  const rows = await upsertSources([{ kind: PRACTICE_SOURCE.kind, name: PRACTICE_SOURCE.name, url: PRACTICE_SOURCE.url, config: { public: false, notes: "Built-in sandbox practice application." }, schedule: "monthly" }]);
  const src = rows.get(PRACTICE_SOURCE.url);
  const mapped = practiceOpportunity(now);
  const ids = await upsertBySlug(src?.id ?? null, [mapped]);
  const id = ids.get(mapped.draft.slug);
  if (!id) throw new Error("The practice opportunity was not written.");
  await recordSnapshots([{ opportunityId: id, hash: mapped.hash, raw: mapped.raw }]);
  return id;
}
