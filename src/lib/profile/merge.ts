import type { Profile } from "@/lib/core/types";
import { readProfile } from "@/lib/llm/types";

/*
 * Merging a freshly extracted profile into the stored one — pure, isomorphic, tested
 * (tests/profile-merge.test.ts).
 *
 * The extraction always runs over ALL of a person's sources, so `incoming` is the complete
 * document-derived truth. `base` is the stored profile, which also carries the person's own
 * choices. The rule is simple and strict:
 *
 *   - a path the person confirmed or edited (a `facts` row with confirmed_by_user) is theirs:
 *     the stored value stays, whatever the documents say now;
 *   - everything else follows the documents (a value no document supports any more goes).
 *
 * Paths are JSON pointers into the Profile. Item arrays are addressed by item id
 * (`/experience/exp_3fa9c1d2e0/title`); value arrays by index (`/skills/3`), and because
 * indexes shift between extractions, a confirmed value-array entry is kept by its VALUE.
 * Confirming a path also owns everything below it; a few answers write a group of fields at
 * once (`PATH_GROUPS`).
 */

export interface ConfirmedFact {
  path: string;
  /** The confirmed value (used for value arrays, whose indexes shift). */
  value?: unknown;
}

export interface MergeOptions {
  confirmed?: readonly ConfirmedFact[];
}

/** One answer can own several sibling fields. */
export const PATH_GROUPS: Readonly<Record<string, readonly string[]>> = {
  "/packs/jobSeeker/salary": ["/packs/jobSeeker/salaryMin", "/packs/jobSeeker/salaryMax", "/packs/jobSeeker/currency", "/packs/jobSeeker/salaryPeriod"],
  "/identity/location": ["/identity/location", "/identity/city", "/identity/countryCode"],
};

/** Item arrays (objects with a stable `id`). */
const ID_ARRAYS = new Set(["/education", "/experience", "/projects", "/achievements", "/publications", "/certifications", "/packs/founder/ventures"]);

export function expandPaths(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    out.add(p);
    for (const g of PATH_GROUPS[p] ?? []) out.add(g);
  }
  return [...out];
}

/** True when `path` itself or one of its ancestors is owned. */
export function isPathOwned(path: string, owned: readonly string[]): boolean {
  return owned.some((c) => c === path || path.startsWith(`${c}/`));
}

/** True when something strictly below `path` is owned. */
export function hasOwnedBelow(path: string, owned: readonly string[]): boolean {
  const prefix = `${path}/`;
  return owned.some((c) => c.startsWith(prefix));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON with sorted keys: equal values always serialise the same way. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normUrl = (v: unknown) =>
  norm(v)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

/** The array a path addresses, with item ids replaced so nested arrays share one rule. */
function arrayRule(path: string): string {
  return path.replace(/^\/packs\/founder\/ventures\/[^/]+\//, "/packs/founder/ventures/*/");
}

/** Identity of an entry for de-duplication, by the array it lives in. */
export function naturalKey(arrayPath: string, item: unknown): string {
  if (!isPlainObject(item)) return `v:${norm(item)}`;
  const o = item;
  switch (arrayRule(arrayPath)) {
    case "/experience":
      return `${norm(o.organization)}|${norm(o.title)}`;
    case "/education":
      return `${norm(o.institution)}|${norm(o.degree ?? o.level)}`;
    case "/projects":
      return norm(o.name);
    case "/achievements":
    case "/publications":
    case "/packs/researcher/grants":
      return norm(o.title);
    case "/certifications":
      return norm(o.name);
    case "/packs/founder/ventures":
      return norm(o.company);
    case "/skills":
      return norm(o.name);
    case "/identity/links":
      return normUrl(o.url);
    case "/identity/languages":
      return norm(o.code);
    case "/identity/workAuthorization":
      return `${norm(o.countryCode)}:${norm(o.status)}`;
    case "/roles":
      return norm(o.code);
    case "/packs/creator/audienceMetrics":
      return `${norm(o.platform)}|${norm(o.handle)}`;
    case "/packs/professional/licenses":
      return norm(o.type);
    case "/packs/student/testScores":
      return norm(o.test);
    case "/packs/founder/ventures/*/fundingHistory":
      return norm(o.round);
    default:
      return stableStringify(o);
  }
}

interface Ctx {
  owned: string[];
  confirmed: readonly ConfirmedFact[];
}

/**
 * The value the person confirmed for a path: a confirmed fact at the path itself, inside a
 * confirmed ancestor's value (`/experience/<id>` → `/experience/<id>/title`), or inside a
 * group answer (`/identity/location` → `/identity/city`). Undefined when none says.
 */
export function confirmedValueAt(path: string, confirmed: readonly ConfirmedFact[]): unknown {
  // Group answers first: "/identity/location" is both a group and one of its own fields.
  for (const c of confirmed) {
    if (!isPlainObject(c.value) || !(PATH_GROUPS[c.path] ?? []).includes(path)) continue;
    const key = path.split("/").pop()!;
    if (key in c.value) return c.value[key];
  }
  for (const c of confirmed) {
    if (c.value === undefined || PATH_GROUPS[c.path]) continue;
    if (c.path === path) return c.value;
  }
  for (const c of confirmed) {
    if (c.value === undefined || PATH_GROUPS[c.path] || !path.startsWith(`${c.path}/`)) continue;
    const v = valueAt(c.value, path.slice(c.path.length));
    if (v !== undefined) return v;
  }
  return undefined;
}

function mergeIdArray(path: string, base: unknown[], incoming: unknown[], ctx: Ctx): unknown[] {
  const baseItems = base.filter(isPlainObject).filter((b) => typeof b.id === "string") as Array<Record<string, unknown> & { id: string }>;
  const ownedItem = (b: { id: string }) => {
    const p = `${path}/${b.id}`;
    return isPathOwned(p, ctx.owned) || hasOwnedBelow(p, ctx.owned);
  };
  const out: unknown[] = [];
  const usedBase = new Set<string>();
  const seen = new Set<string>();
  const push = (item: unknown) => {
    const k = naturalKey(path, item);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(item);
  };
  for (const inc of incoming) {
    if (!isPlainObject(inc)) continue;
    const key = naturalKey(path, inc);
    const match = baseItems.find((b) => b.id === inc.id) ?? baseItems.find((b) => naturalKey(path, b) === key);
    if (match) usedBase.add(match.id);
    if (match && ownedItem(match)) {
      // The person's version (or the parts of it they own) wins; the base id stays because
      // their confirmed facts point at it.
      push(mergeValue(`${path}/${match.id}`, match, { ...inc, id: match.id }, ctx));
    } else {
      push(inc);
    }
  }
  // Items no document mentions any more survive only when the person owns them.
  for (const b of baseItems) {
    if (usedBase.has(b.id) || !ownedItem(b)) continue;
    push(b);
  }
  return out;
}

function mergeIndexArray(path: string, incoming: unknown[], ctx: Ctx): unknown[] {
  if (!hasOwnedBelow(path, ctx.owned)) return incoming;
  const indexPath = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d+$`);
  const keepers = ctx.confirmed.filter((c) => indexPath.test(c.path) && c.value !== undefined && c.value !== null).map((c) => c.value);
  const out = [...incoming];
  const keys = new Set(out.map((x) => naturalKey(path, x)));
  for (const v of keepers) {
    const k = naturalKey(path, v);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(v);
  }
  return out;
}

/** The next path segment of every owned path below `path` ("/packs" → ["jobSeeker"]). */
function ownedChildKeys(path: string, owned: readonly string[]): string[] {
  const prefix = `${path}/`;
  return [...new Set(owned.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length).split("/")[0]!))];
}

function mergeValue(path: string, base: unknown, incoming: unknown, ctx: Ctx): unknown {
  if (path && isPathOwned(path, ctx.owned)) {
    // The person's word: the stored value, or — when the stored profile lacks it (a draft
    // merged into an account, a write that lost a race) — the value their confirmed fact holds.
    if (base !== undefined && base !== null) return base;
    const said = confirmedValueAt(path, ctx.confirmed);
    if (said !== undefined) return said;
    return base === undefined ? incoming : base;
  }
  // Owned children under a branch neither side has (an answer whose pack the stored profile lacks).
  const kids = hasOwnedBelow(path, ctx.owned) ? ownedChildKeys(path, ctx.owned) : [];
  if (base == null && incoming == null && kids.length) {
    if (kids.every((k) => /^\d+$/.test(k))) {
      const arr = mergeIndexArray(path, [], ctx);
      return arr.length ? arr : incoming;
    }
    base = {};
  }
  if (Array.isArray(base) || Array.isArray(incoming)) {
    const b = Array.isArray(base) ? base : [];
    const i = Array.isArray(incoming) ? incoming : [];
    if (ID_ARRAYS.has(path)) return mergeIdArray(path, b, i, ctx);
    return mergeIndexArray(path, i, ctx);
  }
  if (isPlainObject(base) || isPlainObject(incoming)) {
    if (!kids.length) return incoming;
    const b = isPlainObject(base) ? base : {};
    const i = isPlainObject(incoming) ? incoming : {};
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(i), ...Object.keys(b), ...kids])) {
      const v = mergeValue(`${path}/${key}`, b[key], i[key], ctx);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return incoming;
}

/**
 * The stored profile updated with a fresh extraction. Values under confirmed paths keep
 * the person's version; everything else follows `incoming`. Always returns a valid Profile
 * (invalid leftovers are dropped by the lenient reader).
 */
export function mergeProfile(base: Profile, incoming: Profile, opts: MergeOptions = {}): Profile {
  const confirmed = opts.confirmed ?? [];
  const ctx: Ctx = { owned: expandPaths(confirmed.map((c) => c.path)), confirmed };
  return readProfile(mergeValue("", base, incoming, ctx));
}

/* ------------------------------------------------------------------ facts */

export interface StoredFact {
  id: string;
  path: string;
  claim: string;
  value: unknown;
  sourceDocId: string | null;
  quote: string | null;
  confidence: number;
  confirmedByUser: boolean;
}

export interface NewFact {
  path: string;
  claim: string;
  value: unknown;
  sourceDocId: string | null;
  quote: string | null;
  confidence: number;
}

export interface FactSyncPlan {
  insert: NewFact[];
  update: { id: string; claim: string; quote: string | null; confidence: number; sourceDocId: string | null }[];
  remove: string[];
}

/** Facts are de-duplicated by path + value. */
export function factKey(path: string, value: unknown): string {
  return `${path}\u0000${stableStringify(value ?? null)}`;
}

/**
 * Brings the stored facts in line with a fresh extraction:
 *  - a new (path, value) is inserted — unless the person already decided that path;
 *  - an existing unconfirmed fact the extraction no longer produces is removed;
 *  - an existing unconfirmed fact that is produced again is refreshed (quote, confidence);
 *  - confirmed facts are never touched.
 */
export function planFactSync(existing: readonly StoredFact[], incoming: readonly NewFact[]): FactSyncPlan {
  const owned = expandPaths(existing.filter((f) => f.confirmedByUser).map((f) => f.path));
  const fresh = new Map<string, NewFact>();
  for (const f of incoming) {
    const k = factKey(f.path, f.value);
    const prev = fresh.get(k);
    if (!prev || f.confidence > prev.confidence) fresh.set(k, f);
  }
  const plan: FactSyncPlan = { insert: [], update: [], remove: [] };
  const kept = new Set<string>();
  // Confirmed rows first, so a duplicate unconfirmed row with the same key is the one removed.
  const ordered = [...existing].sort((a, b) => Number(b.confirmedByUser) - Number(a.confirmedByUser));
  for (const f of ordered) {
    const k = factKey(f.path, f.value);
    if (f.confirmedByUser) {
      kept.add(k);
      continue;
    }
    const next = fresh.get(k);
    if (!next || kept.has(k) || isPathOwned(f.path, owned)) {
      plan.remove.push(f.id);
      continue;
    }
    kept.add(k);
    if (next.claim !== f.claim || next.quote !== f.quote || Math.abs(next.confidence - f.confidence) > 1e-6 || next.sourceDocId !== f.sourceDocId) {
      plan.update.push({ id: f.id, claim: next.claim, quote: next.quote, confidence: next.confidence, sourceDocId: next.sourceDocId });
    }
  }
  for (const [k, f] of fresh) {
    if (kept.has(k) || isPathOwned(f.path, owned)) continue;
    plan.insert.push(f);
  }
  return plan;
}

/* ------------------------------------------------------------------ pointer helpers */

/** Splits a JSON pointer ("/a/b/0") into segments, decoding ~1 and ~0. */
export function pointerSegments(path: string): string[] {
  if (!path || path === "/") return [];
  return path
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Reads the value a fact path points at. Item arrays are addressed by id, value arrays by
 * index. Returns undefined when the path does not resolve.
 */
export function valueAt(profile: unknown, path: string): unknown {
  let cur: unknown = profile;
  for (const seg of pointerSegments(path)) {
    if (Array.isArray(cur)) {
      const byId = cur.find((x) => isPlainObject(x) && x.id === seg);
      if (byId !== undefined) cur = byId;
      else if (/^\d+$/.test(seg)) cur = cur[Number(seg)];
      else {
        const byCode = cur.find((x) => isPlainObject(x) && x.code === seg);
        if (byCode === undefined) return undefined;
        cur = byCode;
      }
    } else if (isPlainObject(cur)) {
      cur = cur[seg];
    } else {
      return undefined;
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Value-array fact paths (`/skills/3`) point at an index that may have shifted since the
 * fact was written: find the entry by its value instead. Other paths come back unchanged.
 */
export function resolveIndexPath(profile: unknown, path: string, value: unknown): string {
  const segs = pointerSegments(path);
  const last = segs[segs.length - 1];
  if (!last || !/^\d+$/.test(last)) return path;
  const parentPath = `/${segs.slice(0, -1).join("/")}`;
  const arr = valueAt(profile, parentPath);
  if (!Array.isArray(arr)) return path;
  const want = naturalKey(parentPath, value);
  const at = arr.findIndex((x) => naturalKey(parentPath, x) === want);
  return at >= 0 ? `${parentPath}/${at}` : path;
}

/**
 * Writes a value at a fact path (immutably). Missing objects on the way are created; an
 * item array segment must name an existing item id or a valid index (append with "-").
 * Throws when the path cannot be written.
 */
export function setAt<T>(root: T, path: string, value: unknown): T {
  const segs = pointerSegments(path);
  if (!segs.length) return value as T;
  const write = (cur: unknown, i: number): unknown => {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    if (Array.isArray(cur)) {
      const arr = [...cur];
      let idx = arr.findIndex((x) => isPlainObject(x) && (x.id === seg || (x.code === seg && !("id" in x))));
      if (idx < 0 && /^\d+$/.test(seg)) idx = Number(seg);
      if (seg === "-") idx = arr.length;
      if (idx < 0 || idx > arr.length) throw new Error(`Cannot write ${path}: no item ${seg}`);
      arr[idx] = last ? value : write(arr[idx], i + 1);
      return arr;
    }
    const obj = isPlainObject(cur) ? { ...cur } : {};
    obj[seg] = last ? value : write(obj[seg], i + 1);
    return obj;
  };
  return write(root, 0) as T;
}
