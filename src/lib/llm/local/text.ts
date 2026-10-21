/*
 * Text utilities for the local engine: language detection, line handling, bullets, dates,
 * contacts. Pure functions; every parser in ./resume, ./deck and ./research builds on them.
 */

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;

export function cjkCount(text: string): number {
  return text.match(CJK_RE)?.length ?? 0;
}

export function hasCjk(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text);
}

/** "zh" when Chinese characters make up a meaningful share of the letters, else "en". */
export function detectLanguage(text: string): "en" | "zh" {
  const sample = text.slice(0, 20_000);
  const cjk = cjkCount(sample);
  const latin = sample.match(/[A-Za-z]/g)?.length ?? 0;
  return cjk > 0 && cjk * 3 >= latin * 0.6 ? "zh" : "en";
}

/** Spoken/written word count: latin tokens plus Chinese characters at ~1.7 per word. */
export function countWords(text: string): number {
  const cjk = cjkCount(text);
  const rest = text.replace(CJK_RE, " ");
  const tokens = rest.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
  return tokens + Math.round(cjk / 1.7);
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function clip(s: string, max: number): string {
  const t = collapse(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

const BULLET_RE = /^\s*(?:[•●○◦▪▫■□◆◇►▶➢➤✓✔✗☐☑*·‣⁃–—-]|\d{1,2}[.)、]|[a-z][.)]|\([a-z0-9]{1,2}\)|[（(]?[一二三四五六七八九十]+[、.)）])\s+/u;
const BULLET_TIGHT_RE = /^\s*[•●○◦▪■◆►▶➢➤✓✔·‣⁃]\s*/u;

export function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line) || BULLET_TIGHT_RE.test(line);
}

export function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").replace(BULLET_TIGHT_RE, "").trim();
}

/**
 * Splits text into trimmed lines. Runs of 2+ spaces and tabs are kept as a double space:
 * résumé layouts use them as column separators ("2019.07 - 2021.06  Company  Title").
 */
export function lines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  ").replace(/ {3,}/g, "  ").trim());
}

/** Upper-cases the first letter of each word in an ALL-CAPS string ("JANE DOE" → "Jane Doe"). */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

export function uniq<T>(items: T[], key: (t: T) => string = (t) => String(t).toLowerCase()): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/* ------------------------------------------------------------------ dates */

export interface YearMonth {
  year: number;
  month: number | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12,
};

const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter";
const YEAR = "(?:19[5-9]\\d|20[0-4]\\d)";
const PRESENT = "present|current|currently|now|today|ongoing|to date|date|至今|现在|今|目前|迄今";

/** One date token in any of the common résumé formats. Capturing groups are not relied upon. */
export const DATE_TOKEN = `(?:(?:${MONTH_NAMES})\\.?,?\\s*'?(?:${YEAR}|\\d{2})|${YEAR}\\s*年\\s*\\d{1,2}\\s*月?|${YEAR}[./\\-]\\s*\\d{1,2}(?![\\d])|\\d{1,2}\\s*[./\\-]\\s*${YEAR}|${YEAR})`;
const RANGE_SEP = "\\s*(?:-|–|—|－|~|～|〜|to|until|till|至|到|—|→)\\s*";
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})${RANGE_SEP}(${DATE_TOKEN}|${PRESENT})`, "i");
const SINGLE_DATE_RE = new RegExp(`(?:(?:expected|anticipated|graduat(?:ed|ion|ing)|class of|since|from|预计|毕业(?:时间)?[:：]?)\\s*)?(${DATE_TOKEN})`, "i");

export function parseDateToken(raw: string): YearMonth | "present" | null {
  const s = raw.trim().toLowerCase().replace(/\.$/, "");
  if (new RegExp(`^(?:${PRESENT})$`, "i").test(s)) return "present";
  let m = /^(\d{4})\s*年\s*(\d{1,2})\s*月?$/.exec(s);
  if (m) return ym(Number(m[1]), Number(m[2]));
  m = /^(\d{4})\s*[./-]\s*(\d{1,2})$/.exec(s);
  if (m) return ym(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(s);
  if (m) return ym(Number(m[2]), Number(m[1]));
  m = new RegExp(`^(${MONTH_NAMES})\\.?,?\\s*'?(\\d{4}|\\d{2})$`, "i").exec(s);
  if (m) {
    const key = m[1].slice(0, m[1].startsWith("sept") ? 4 : 3);
    const month = MONTHS[m[1]] ?? MONTHS[key] ?? null;
    let year = Number(m[2]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return { year, month };
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return { year: Number(m[1]), month: null };
  return null;
}

function ym(year: number, month: number): YearMonth | null {
  if (year < 1950 || year > 2049) return null;
  return { year, month: month >= 1 && month <= 12 ? month : null };
}

export function formatYearMonth(d: YearMonth | null): string | null {
  if (!d) return null;
  return d.month ? `${d.year}-${String(d.month).padStart(2, "0")}` : String(d.year);
}

export interface DateRange {
  start: string | null;
  end: string | null;
  current: boolean;
  /** The matched text, so callers can strip it from the line. */
  matched: string;
}

/** Finds "Jan 2020 – Present", "2019.07-2021.03", "2018 - 2022", "2020年9月至今" in a line. */
export function findDateRange(line: string): DateRange | null {
  const m = DATE_RANGE_RE.exec(line);
  if (!m) return null;
  const start = parseDateToken(m[1]);
  const end = parseDateToken(m[2]);
  if (!start || start === "present") return null;
  return {
    start: formatYearMonth(start),
    end: end === "present" || !end ? null : formatYearMonth(end),
    current: end === "present",
    matched: m[0],
  };
}

/** A lone date such as "Expected May 2026" or "2019"; returns the date and whether it is a future/expected one. */
export function findSingleDate(line: string): { date: string; expected: boolean; matched: string } | null {
  const m = SINGLE_DATE_RE.exec(line);
  if (!m) return null;
  const d = parseDateToken(m[1]);
  if (!d || d === "present") return null;
  return { date: formatYearMonth(d)!, expected: /expected|anticipated|预计/i.test(m[0]), matched: m[0] };
}

/** Months between two "YYYY[-MM]" dates (end null = now). */
export function monthsBetween(start: string, end: string | null, now = new Date()): number {
  const [sy, sm] = start.split("-").map(Number);
  const e = end ? end.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const months = (e[0] - sy) * 12 + ((e[1] || 6) - (sm || 6));
  return Math.max(0, months);
}

/**
 * Total years covered by a set of date ranges, merging overlaps (two concurrent jobs
 * don't double-count). Ranges without a start are ignored.
 */
export function totalYears(ranges: Array<{ start: string | null; end: string | null; current?: boolean }>, now = new Date()): number {
  const toIndex = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    return y * 12 + ((m || 1) - 1);
  };
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = ranges
    .filter((r) => r.start)
    .map((r) => {
      const s = toIndex(r.start!);
      const endRaw = r.current || !r.end ? nowIndex : toIndex(r.end) + (r.end.includes("-") ? 0 : 11);
      return [s, Math.min(Math.max(endRaw, s), nowIndex)] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const sp of spans) {
    if (!cur) cur = [...sp];
    else if (sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
    else {
      total += cur[1] - cur[0];
      cur = [...sp];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 12) * 10) / 10;
}

/* ------------------------------------------------------------------ contacts */

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE_RES = [
  /(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/, // Chinese mobile
  /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/, // international
  /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, // North American
  /\b0\d{2,4}[\s-]\d{3,4}[\s-]?\d{3,4}\b/, // national with trunk prefix
];
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|me|ai|co|app|design|edu|cn|uk|de|fr|ca|au|in|xyz|so|page|site|art|studio|tech|info|blog|github\.io)(?:\/[^\s,;)|]*)?/gi;

export function findEmail(text: string): string | null {
  const m = EMAIL_RE.exec(text);
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

export function findPhone(text: string): string | null {
  for (const re of PHONE_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    // Year ranges ("2019 - 2021 - 2023") are not phone numbers.
    if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}/.test(m[0].trim())) continue;
    return m[0].trim();
  }
  return null;
}

export function findUrls(input: string): string[] {
  const out: string[] = [];
  // E-mail addresses contain domain-like pieces ("ines.calloway@…" → "ines.ca"); blank them first.
  const text = input.replace(new RegExp(EMAIL_RE.source, "g"), (m) => " ".repeat(m.length));
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:)]+$/, "");
    const at = m.index ?? 0;
    // The domain part of an e-mail address ("jane@acme.com") is not a link.
    if (at > 0 && /[@A-Za-z0-9._%+-]/.test(text[at - 1]) && text.slice(Math.max(0, at - 64), at).includes("@") && !/\s/.test(text.slice(text.lastIndexOf("@", at), at))) continue;
    out.push(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  }
  return uniq(out, (u) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
}

/* ------------------------------------------------------------------ numbers & money */

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, 万: 1e4, 千万: 1e7, 亿: 1e8, 百万: 1e6 };
const CURRENCY_SYMBOL: Record<string, string> = { $: "USD", "us$": "USD", usd: "USD", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP", "¥": "CNY", "￥": "CNY", rmb: "CNY", cny: "CNY", 元: "CNY", 人民币: "CNY", 美元: "USD", "s$": "SGD", sgd: "SGD", "hk$": "HKD", hkd: "HKD", "a$": "AUD", "c$": "CAD", inr: "INR", "₹": "INR", jpy: "JPY", "円": "JPY" };

export interface MoneyMatch {
  amount: number;
  currency: string | null;
  text: string;
}

/** Finds money amounts like "$1.5M", "USD 750K", "€2 million", "500万元", "人民币1000万". */
export function findMoney(text: string): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  const latin = /((?:us\$|s\$|hk\$|a\$|c\$|\$|€|£|¥|￥|₹)|\b(?:usd|eur|gbp|cny|rmb|sgd|hkd|inr|jpy)\s?)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mm|bn|b|thousand|million|billion)?\b/gi;
  for (const m of text.matchAll(latin)) {
    const cur = CURRENCY_SYMBOL[m[1].trim().toLowerCase()] ?? null;
    const base = Number(m[2].replace(/,/g, ""));
    const scale = m[3] ? SCALE[m[3].toLowerCase()] ?? 1 : 1;
    if (!Number.isFinite(base)) continue;
    out.push({ amount: base * scale, currency: cur, text: m[0].trim() });
  }
  const zh = /(人民币|美元)?\s?(\d+(?:\.\d+)?)\s?(千万|百万|万|亿)?\s?(元|美元|人民币|rmb)?/gi;
  for (const m of text.matchAll(zh)) {
    if (!m[3] && !m[4] && !m[1]) continue;
    if (!m[3] && !(m[1] || m[4])) continue;
    const base = Number(m[2]);
    if (!Number.isFinite(base) || base === 0) continue;
    const scale = m[3] ? SCALE[m[3]] : 1;
    const curWord = (m[1] ?? m[4] ?? "").toLowerCase();
    const currency = curWord ? (CURRENCY_SYMBOL[curWord] ?? "CNY") : "CNY";
    out.push({ amount: base * scale, currency, text: m[0].trim() });
  }
  return out;
}

/** Lines that state a quantified result: numbers with %, x, users, revenue words. */
export function isQuantified(line: string): boolean {
  return /\d/.test(line) && /(%|\b\d+(\.\d+)?x\b|\$|€|£|¥|users?|customers?|clients?|revenue|arr|mrr|gmv|downloads?|members?|students?|growth|increase|reduc|save|saving|grew|cut|boost|improv|million|billion|\bk\b|万|亿|用户|客户|营收|收入|增长|提升|降低|节省|下载|会员)/i.test(line);
}

/** Lower-cases the first character of a verb-first highlight so it reads inside a sentence. */
export function lowerFirst(s: string): string {
  if (!s) return s;
  // Keep acronyms and proper nouns: only lower-case a capitalised regular word.
  const first = s.split(/\s+/)[0];
  if (/^[A-Z][a-z]+(-[a-z]+)*[,:;]?$/.test(first) || /^(A|An|The)$/.test(first)) return s[0].toLowerCase() + s.slice(1);
  return s;
}

export function stripTrailingPunct(s: string): string {
  return s.replace(/[\s.;,。；，]+$/u, "");
}

/** Joins items as "a, b and c" (en) or "a、b和c" (zh). */
export function joinList(items: string[], lang: "en" | "zh"): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (lang === "zh") return `${xs.slice(0, -1).join("、")}和${xs[xs.length - 1]}`;
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
