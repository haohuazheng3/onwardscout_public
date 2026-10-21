import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { htmlToReadable } from "@/lib/ingest/html";
import { SafeFetchError, decodeBody, safeFetch, type SafeFetchOptions } from "@/lib/ingest/url";
import { mapPool } from "./ats/common";
import { contentHash } from "./normalize";
import { recordSnapshots } from "./store";

/*
 * Program page re-verification (curated opportunities). We fetch the official URL through the
 * SSRF-safe fetcher and only ever conclude one of three things:
 *   ok      → the page answers: `verified_at` moves to now (and a page we had flagged reopens);
 *   gone    → 404/410 (or a page that says it is not found): the opportunity is flagged
 *             `unverified` and disappears from public lists until a human or a later check says otherwise;
 *   blocked / error → bot walls, rate limits, timeouts: nothing changes.
 * We never rewrite a program's facts from the page — deadlines and amounts change only when
 * the research data changes. A snapshot of the readable text is kept for change review.
 */

export const CRAWL_USER_AGENT = "OnwardScout/1.0 (+https://onwardscout.com; program page checker)";

export type PageState = "ok" | "gone" | "blocked" | "error";

export interface PageCheck {
  url: string;
  state: PageState;
  httpStatus: number | null;
  finalUrl: string | null;
  title: string | null;
  /** Readable text (first 4,000 characters), for change review. */
  text: string | null;
  /** The page now redirects to the site's home page (moved or retired); reported, not acted on. */
  movedToHome: boolean;
  error: string | null;
}

/** Decides what an HTTP outcome means for a program page. Fetch failures (DNS, timeouts, guards) never count as "gone". */
export function classifyStatus(status: number | null): PageState {
  if (status === null) return "error";
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 401 || status === 403 || status === 429 || status === 451 || status === 999) return "blocked";
  return "error";
}

/** A "200" page that is really a not-found page (short page whose title says so). */
export function looksLikeSoft404(title: string | null, text: string | null): boolean {
  const t = `${title ?? ""}`.toLowerCase();
  const short = (text ?? "").length < 1500;
  return short && /\b(404|page not found|not found|no longer available|page (?:does not|doesn't) exist|seite nicht gefunden|page introuvable|页面不存在|找不到页面)\b/.test(t);
}

/** True when a deep link now lands on the site's root ("/", "/en", "/index.html"). */
export function movedToHome(original: string, final: string | null): boolean {
  if (!final) return false;
  try {
    const a = new URL(original);
    const b = new URL(final);
    const isRoot = (p: string) => /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?(?:index\.html?)?$/i.test(p);
    return !isRoot(a.pathname) && isRoot(b.pathname);
  } catch {
    return false;
  }
}

/** Fetches one program page and classifies it. Never throws. */
export async function checkPage(url: string, opts: Pick<SafeFetchOptions, "signal" | "timeoutMs" | "resolver"> = {}): Promise<PageCheck> {
  const base: PageCheck = { url, state: "error", httpStatus: null, finalUrl: null, title: null, text: null, movedToHome: false, error: null };
  try {
    const res = await safeFetch(url, {
      timeoutMs: opts.timeoutMs ?? 15_000,
      maxBytes: 3 * 1024 * 1024,
      maxRedirects: 5,
      headers: { "User-Agent": CRAWL_USER_AGENT },
      signal: opts.signal,
      resolver: opts.resolver,
    });
    const finalUrl = res.redirects.at(-1) ?? res.url;
    let title: string | null = null;
    let text: string | null = null;
    if (res.status >= 200 && res.status < 300 && /html|xml|text/i.test(res.contentType || "text/html")) {
      const page = htmlToReadable(decodeBody(res), finalUrl);
      title = page.title;
      text = page.text.slice(0, 4000);
    }
    let state = classifyStatus(res.status);
    if (state === "ok" && looksLikeSoft404(title, text)) state = "gone";
    return { ...base, state, httpStatus: res.status, finalUrl, title, text, movedToHome: movedToHome(url, finalUrl) };
  } catch (err) {
    const code = err instanceof SafeFetchError ? ` (${err.code})` : "";
    return { ...base, state: classifyStatus(null), error: `${err instanceof Error ? err.message : String(err)}${code}` };
  }
}

export interface VerifyReport {
  checked: number;
  ok: number;
  gone: number;
  blocked: number;
  error: number;
  reopened: number;
  flagged: number;
  movedToHome: number;
  goneIds: string[];
}

/**
 * Re-checks curated program pages, oldest verification first, until `limit` pages or the
 * deadline. Only opportunities from curated sources (`seed://curated/*`) are touched.
 */
export async function reverifyPrograms(opts: { limit?: number; olderThanDays?: number; deadline?: number; concurrency?: number; signal?: AbortSignal } = {}): Promise<VerifyReport> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 60));
  const olderThanDays = opts.olderThanDays ?? 7;
  const res = await db.execute(sql`
    select o.id, o.url, o.status
    from opportunities o
    join sources s on s.id = o.source_id
    where s.kind = 'manual' and s.url like 'seed://curated/%'
      and o.url is not null
      and o.status in ('active', 'unverified')
      and (o.verified_at is null or o.verified_at < now() - make_interval(days => ${olderThanDays}))
    order by o.verified_at asc nulls first
    limit ${limit}
  `);
  const rows = ((res as unknown as { rows?: Array<{ id: string; url: string; status: string }> }).rows ?? (res as unknown as Array<{ id: string; url: string; status: string }>)).filter((r) => r.url);
  const report: VerifyReport = { checked: 0, ok: 0, gone: 0, blocked: 0, error: 0, reopened: 0, flagged: 0, movedToHome: 0, goneIds: [] };
  const deadline = opts.deadline ?? Date.now() + 60_000;
  await mapPool(
    rows,
    opts.concurrency ?? 4,
    async (row) => {
      const check = await checkPage(row.url, { signal: opts.signal });
      report.checked++;
      report[check.state]++;
      if (check.movedToHome) report.movedToHome++;
      if (check.state === "ok") {
        const updated = await db.execute(sql`
          update opportunities set
            verified_at = now(),
            status = case when status = 'unverified' and (rolling or deadline is null or deadline > now()) then 'active' else status end,
            updated_at = case when status = 'unverified' then now() else updated_at end
          where id = ${row.id}
          returning (case when ${row.status} = 'unverified' and status = 'active' then 1 else 0 end) as reopened
        `);
        const r = ((updated as unknown as { rows?: Array<{ reopened: number }> }).rows ?? [])[0];
        if (r && Number(r.reopened) === 1) report.reopened++;
      } else if (check.state === "gone") {
        report.goneIds.push(row.id);
        const flagged = await db.execute(sql`update opportunities set status = 'unverified', updated_at = now() where id = ${row.id} and status = 'active' returning id`);
        if (((flagged as unknown as { rows?: unknown[] }).rows ?? []).length) report.flagged++;
      }
      if (check.state === "ok" || check.state === "gone") {
        await recordSnapshots([
          {
            opportunityId: row.id,
            hash: contentHash({ v: 1, state: check.state, title: check.title, text: check.text }),
            raw: { url: check.finalUrl ?? row.url, httpStatus: check.httpStatus, contentType: null, title: check.title, text: check.text, data: { check: check.state, movedToHome: check.movedToHome } },
          },
        ]);
      }
    },
    () => Date.now() > deadline || Boolean(opts.signal?.aborted),
  );
  return report;
}
