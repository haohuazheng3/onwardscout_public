import { stableStringify } from "@/lib/profile/merge";

/*
 * Which stored fact backs a value on the profile page (pure, client-safe). Item arrays are
 * matched by path (`/experience/<id>`), value arrays by value (indexes shift between
 * extractions), scalars by path. The person's confirmed word wins over a document quote.
 */

export interface FactView {
  id: string;
  path: string;
  claim: string;
  value: unknown;
  sourceDocId: string | null;
  quote: string | null;
  confidence: number;
  confirmedByUser: boolean;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function rank(a: FactView, b: FactView): number {
  return Number(b.confirmedByUser) - Number(a.confirmedByUser) || b.confidence - a.confidence;
}

/** The best fact for an exact path (or one of its descendants), or null. */
export function factForPath(facts: readonly FactView[], path: string): FactView | null {
  const hits = facts.filter((f) => f.path === path || f.path.startsWith(`${path}/`));
  return hits.sort(rank)[0] ?? null;
}

/** The best fact for an entry of a value array (`/skills`, `/identity/links`…), matched by value. */
export function factForValue(facts: readonly FactView[], arrayPath: string, value: unknown, key?: string): FactView | null {
  const prefix = `${arrayPath}/`;
  const want = key ? norm((value as Record<string, unknown> | null)?.[key]) : stableStringify(value);
  const hits = facts.filter((f) => {
    if (f.path !== arrayPath && !f.path.startsWith(prefix)) return false;
    if (f.path === arrayPath) return Array.isArray(f.value) && f.value.some((x) => (key ? norm((x as Record<string, unknown> | null)?.[key]) : stableStringify(x)) === want);
    return key ? norm((f.value as Record<string, unknown> | null)?.[key]) === want : stableStringify(f.value) === want;
  });
  return hits.sort(rank)[0] ?? null;
}

/** "2021-03" → "Mar 2021", "2021" → "2021"; null → "". */
export function formatPartialDate(d: string | null | undefined, locale: string): string {
  if (!d) return "";
  const [y, m] = d.split("-");
  if (!m) return y ?? "";
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
  } catch {
    return d;
  }
}

export function dateRange(start: string | null | undefined, end: string | null | undefined, current: boolean, locale: string, presentLabel: string): string {
  const a = formatPartialDate(start, locale);
  const b = current ? presentLabel : formatPartialDate(end, locale);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}
