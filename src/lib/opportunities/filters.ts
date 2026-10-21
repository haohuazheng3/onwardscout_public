/**
 * Scout board filters ⇄ query parameters. One parser for the page's `searchParams`, the
 * `/api/opportunities` route and the client's URL state, so a shared link restores the exact
 * board. Invalid values are dropped (never an error page): a stale bookmark still opens.
 * Pure and client-safe.
 */
import { z } from "zod";
import { OPPORTUNITY_TYPE_IDS, type OpportunityTypeId } from "@/lib/core/types";
import { BOARD_GROUPS, boardGroupOfType, type BoardGroup } from "./groups";

export const BOARD_VIEWS = ["picks", "later", "all"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const REMOTE_FILTERS = ["remote", "hybrid", "onsite"] as const;
export type RemoteFilter = (typeof REMOTE_FILTERS)[number];

/** week = closes within 7 days, month = 30, quarter = 90, open = rolling or no deadline given. */
export const DEADLINE_WINDOWS = ["week", "month", "quarter", "open"] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number];

/** Minutes of the person's own time: quick ≤ 5, medium 6–15, long > 15. */
export const EFFORT_FILTERS = ["quick", "medium", "long"] as const;
export type EffortFilter = (typeof EFFORT_FILTERS)[number];

export const EFFORT_LIMITS: Record<EffortFilter, { min: number; max: number | null }> = {
  quick: { min: 0, max: 5 },
  medium: { min: 6, max: 15 },
  long: { min: 16, max: null },
};

export const DEADLINE_DAYS: Record<Exclude<DeadlineWindow, "open">, number> = { week: 7, month: 30, quarter: 90 };

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_QUERY_LENGTH = 120;

export interface BoardFilters {
  view: BoardView;
  group: BoardGroup | null;
  type: OpportunityTypeId | null;
  remote: RemoteFilter | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  deadline: DeadlineWindow | null;
  effort: EffortFilter | null;
  /** Free text (Postgres websearch syntax: quotes, OR, -word). */
  q: string | null;
  goal: string | null;
}

export const DEFAULT_FILTERS: BoardFilters = {
  view: "picks",
  group: null,
  type: null,
  remote: null,
  country: null,
  deadline: null,
  effort: null,
  q: null,
  goal: null,
};

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullable().catch(null);

const schema = z.object({
  view: z.enum(BOARD_VIEWS).catch("picks"),
  group: optionalEnum(BOARD_GROUPS),
  type: optionalEnum(OPPORTUNITY_TYPE_IDS),
  remote: optionalEnum(REMOTE_FILTERS),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .catch(null),
  deadline: optionalEnum(DEADLINE_WINDOWS),
  effort: optionalEnum(EFFORT_FILTERS),
  q: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH))
    .transform((s) => (s.length ? s : null))
    .nullable()
    .catch(null),
  goal: z
    .string()
    .trim()
    .regex(/^gol_[0-9a-z]{4,40}$/)
    .nullable()
    .catch(null),
});

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function read(src: ParamSource, key: string): string | null {
  if (!src) return null;
  if (src instanceof URLSearchParams) return src.get(key);
  const v = src[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Board filters from query parameters; anything invalid falls back to the default. */
export function parseBoardFilters(src: ParamSource): BoardFilters {
  const raw: Record<string, string | null> = {};
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    const v = read(src, key);
    raw[key] = v === null || v === "" ? null : v;
  }
  const parsed = schema.parse({ ...raw, view: raw.view ?? "picks" });
  const out: BoardFilters = { ...DEFAULT_FILTERS, ...parsed };
  // A type narrower than its chip: keep the chip consistent with the type.
  if (out.type) {
    const g = boardGroupOfType(out.type);
    if (out.group && g !== out.group) out.type = null;
    else if (!out.group && g) out.group = g;
  }
  // Goals and "later" only make sense for the person's own picks.
  if (out.view === "all") out.goal = null;
  return out;
}

/** Offset cursor (`?cursor=40`) and page size (`?limit=20`), clamped. */
export function parsePaging(src: ParamSource): { offset: number; limit: number } {
  const cursor = Number.parseInt(read(src, "cursor") ?? "", 10);
  const limit = Number.parseInt(read(src, "limit") ?? "", 10);
  return {
    offset: Number.isFinite(cursor) && cursor > 0 ? Math.min(cursor, 10_000) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_PAGE_SIZE) : PAGE_SIZE,
  };
}

const ORDER: (keyof BoardFilters)[] = ["view", "goal", "group", "type", "remote", "country", "deadline", "effort", "q"];

/** Query string for filters (only non-default values, stable order; no leading "?"). */
export function filtersToQuery(f: Partial<BoardFilters>, extra: Record<string, string | number | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const key of ORDER) {
    const v = f[key];
    if (v === null || v === undefined || v === "") continue;
    if (key === "view" && v === "picks") continue;
    p.set(key, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

/** How many filter-sheet filters are on (remote, region, deadline, effort) — the sheet button's badge. */
export function activeSheetFilters(f: BoardFilters): number {
  return [f.remote, f.country, f.deadline, f.effort].filter(Boolean).length;
}

/** Whether a filter state differs from the plain board (used for "Clear filters"). */
export function hasNarrowingFilters(f: BoardFilters): boolean {
  return Boolean(f.group || f.type || f.remote || f.country || f.deadline || f.effort || f.q);
}

export function sameFilters(a: BoardFilters, b: BoardFilters): boolean {
  return filtersToQuery(a) === filtersToQuery(b);
}

/** Words of a search used against `tags` (lower case, 2–40 chars, at most 8). */
export function tagWords(q: string | null): string[] {
  if (!q) return [];
  const words = q
    .toLowerCase()
    .replace(/["()]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, ""))
    .filter((w) => w.length >= 2 && w.length <= 40 && w !== "or" && w !== "and");
  const whole = q.toLowerCase().replace(/["()]/g, "").trim();
  const all = whole.length >= 2 && whole.length <= 60 && whole.includes(" ") ? [whole, ...words] : words;
  return [...new Set(all)].slice(0, 8);
}
