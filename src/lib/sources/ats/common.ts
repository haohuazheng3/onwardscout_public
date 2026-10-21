/*
 * Shared plumbing of the three public job-board clients (Greenhouse, Lever, Ashby):
 * a polite JSON fetch (timeout, retries with backoff, Retry-After), a small concurrency pool,
 * and `buildJob`, which turns a provider-neutral posting (`JobInput`) into an opportunity row.
 *
 * These are the employers' PUBLIC posting APIs (no key, no login). We only read them; the
 * application itself goes through the hosted form (CH1 → CH3/CH6), never an employer API.
 */
import { applyInfoSchema, eligibilitySchema, opportunityBenefitsSchema, type MaterialId, type OpportunitySnapshotRaw } from "@/lib/core/types";
import { countryFromName, mergeLocations, normalizeCountryCode, parseLocation, toGeo, workplaceMode, type ParsedLocation } from "../geo";
import {
  contentHash,
  describe,
  detectJobType,
  detectLanguage,
  htmlToParagraphs,
  isGeneralApplication,
  jobFunctions,
  jobQuality,
  jobSlug,
  jobTags,
  parseMinYears,
  plainToParagraphs,
  statesStudentsOnly,
  summarize,
  toDate,
} from "../normalize";
import type { BoardContext, JobInput, MappedOpportunity } from "../types";

export const ATS_USER_AGENT = "OnwardScout/1.0 (+https://onwardscout.com; public job board reader)";
/** Characters of a job description we keep (the full posting is re-read live when someone applies). */
export const JOB_DESCRIPTION_MAX = 1200;

/* ================================================================== HTTP */

export class AtsHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly retryable: boolean;
  constructor(status: number, url: string, message: string, retryable: boolean) {
    super(message);
    this.name = "AtsHttpError";
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

export interface FetchJsonOptions {
  /** Per attempt (default 30 s; big boards with descriptions can be tens of MB). */
  timeoutMs?: number;
  /** Extra attempts after the first (default 2). */
  retries?: number;
  signal?: AbortSignal;
  /** Injected in tests (no network). */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Backoff before retry `attempt` (1-based): 1 s, 3 s, 9 s… capped at 20 s. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(30_000, secs * 1000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, Math.min(30_000, at - Date.now()));
  }
  return Math.min(20_000, 1000 * 3 ** (attempt - 1));
}

/** GET a JSON document politely. 404/400/401/403 fail at once; 429/5xx/network/timeouts are retried. */
export async function fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleepImpl ?? sleep;
  const attempts = Math.max(1, (opts.retries ?? 2) + 1);
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) throw new AtsHttpError(0, url, "Stopped before the board was read (time budget).", false);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let retryAfter: string | null = null;
    try {
      const res = await doFetch(url, { headers: { Accept: "application/json", "User-Agent": ATS_USER_AGENT }, signal: ctrl.signal, redirect: "follow" });
      if (res.ok) {
        const body = await res.text();
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new AtsHttpError(res.status, url, "The board answered with something that is not JSON.", true);
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      retryAfter = res.headers.get("retry-after");
      await res.body?.cancel().catch(() => undefined);
      const err = new AtsHttpError(res.status, url, res.status === 404 ? "The board was not found (404)." : `The board answered HTTP ${res.status}.`, retryable);
      if (!retryable) throw err;
      lastError = err;
    } catch (err) {
      if (err instanceof AtsHttpError && !err.retryable) throw err;
      if (opts.signal?.aborted) throw new AtsHttpError(0, url, "Stopped while reading the board (time budget).", false);
      lastError =
        err instanceof AtsHttpError
          ? err
          : new AtsHttpError(0, url, ctrl.signal.aborted ? "The board took too long to answer." : `The board could not be reached (${err instanceof Error ? err.message : String(err)}).`, true);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (attempt < attempts) await wait(retryDelayMs(attempt, retryAfter), opts.signal);
  }
  throw lastError ?? new AtsHttpError(0, url, "The board could not be read.", true);
}

/**
 * Runs `fn` over `items` with at most `limit` in flight. `shouldStop()` is checked before each
 * new item starts (time budgets); items never started resolve to `undefined`.
 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, shouldStop?: () => boolean): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/* ================================================================== mapping */

const VISA_NO_RE =
  /\b(?:not|unable to|cannot|can(?:'|’)t|won(?:'|’)t|will not|do not|does not|don(?:'|’)t|no)\s+(?:be able to\s+)?(?:currently\s+)?(?:offer|provide|support|sponsor)?\s*(?:visa\s+|work authori[sz]ation\s+|employment\s+)?sponsor(?:ship)?\b|without (?:the need for )?(?:current or future )?(?:visa )?sponsorship|sponsorship is not (?:available|offered|provided)/i;
const VISA_YES_RE =
  /\bvisa sponsorship (?:is )?(?:available|provided|offered)\b|\bwe (?:will|can|do) sponsor\b|\b(?:offer|offers|provide|provides) visa sponsorship\b|\bsponsorship (?:is )?available\b|\brelocation and visa support\b/i;

/** What the posting says about visa sponsorship: true / false when stated, null otherwise. */
export function visaSponsorship(text: string): boolean | null {
  const no = VISA_NO_RE.test(text);
  const yes = VISA_YES_RE.test(text);
  if (no === yes) return null;
  return yes;
}

function languageCode(raw: string | null | undefined): string | null {
  const m = /^([a-z]{2,3})(?:[-_].*)?$/i.exec((raw ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

function placeLabel(loc: ParsedLocation): string | null {
  if (loc.cities.length) return loc.cities.slice(0, 2).join(" and ");
  if (loc.countries.length === 1) return null;
  return null;
}

function formatMoney(min: number | null, max: number | null, currency: string | null, period: string | null): string | null {
  if (min === null && max === null) return null;
  const fmt = (n: number) => `${currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency ? `${currency} ` : ""}${n.toLocaleString("en-US")}`;
  const range = min !== null && max !== null && min !== max ? `${fmt(min)} – ${fmt(max)}` : fmt((max ?? min) as number);
  return period ? `${range} per ${period}` : range;
}

/** One posting → an opportunity row (type, place, functions, tags, salary, quality…). */
export function buildJob(input: JobInput, board: BoardContext, now: Date, opts: { descriptionMax?: number } = {}): MappedOpportunity {
  const title = input.title.replace(/\s+/g, " ").trim();
  const paragraphs = input.html ? htmlToParagraphs(input.html) : plainToParagraphs(input.text);
  const fullText = paragraphs.join("\n");

  const hinted: Partial<ParsedLocation> = {
    countries: input.countryHints.map((c) => normalizeCountryCode(c) ?? countryFromName(c)).filter((c): c is string => Boolean(c)),
  };
  const explicitMode = workplaceMode(input.workplaceType);
  const loc = mergeLocations([...input.locations.map((l) => parseLocation(l)), hinted]);
  if (explicitMode) loc.remote = explicitMode;

  const type = detectJobType({ title, employmentType: input.employmentType, remote: loc.remote });
  const general = isGeneralApplication(title);
  const functions = jobFunctions(input.departments, title);
  const place = placeLabel(loc);
  const summary =
    summarize(paragraphs, { title, org: board.company }) ??
    (general
      ? `A general application to ${board.company} for roles not listed yet — not a specific opening.`
      : `${title} at ${board.company}${place ? ` in ${place}` : ""}${loc.remote === "remote" ? " (remote)" : loc.remote === "hybrid" ? " (hybrid)" : ""}.`);
  const description = describe(paragraphs, opts.descriptionMax ?? JOB_DESCRIPTION_MAX);
  const tags = jobTags({ title, text: fullText, employmentType: input.employmentType, remote: loc.remote, regions: loc.regions, general });
  const language = languageCode(input.language) ?? detectLanguage(`${title}\n${fullText}`);

  const salary = input.salary;
  const hasSalary = Boolean(salary && (salary.min !== null || salary.max !== null));
  const visa = visaSponsorship(fullText);
  const benefits =
    hasSalary || visa !== null
      ? opportunityBenefitsSchema.parse({
          summary: hasSalary ? (salary?.text ?? formatMoney(salary?.min ?? null, salary?.max ?? null, salary?.currency ?? null, salary?.period ?? null)) : null,
          money: hasSalary ? { kind: "salary", min: salary?.min ?? null, max: salary?.max ?? null, currency: salary?.currency ?? null, period: salary?.period ?? null } : null,
          visaSponsorship: visa,
        })
      : null;

  const minYears = parseMinYears(fullText);
  const studentsOnly = type === "internship" ? statesStudentsOnly(fullText) : null;
  const eligibility = minYears !== null || studentsOnly !== null ? eligibilitySchema.parse({ minYears, studentsOnly }) : null;

  const materials: MaterialId[] = ["resume"];
  if (/\bcover letter\b/i.test(fullText)) materials.push("cover_letter");
  if (/\bportfolio\b/i.test(fullText) && (functions.includes("design") || functions.includes("creative"))) materials.push("portfolio");

  const deadline = toDate(input.deadline);
  const publishedAt = toDate(input.publishedAt);
  const geo = toGeo(loc);
  const apply = applyInfoSchema.parse({
    channel: "CH1",
    url: input.applyUrl ?? input.url,
    platform: input.provider,
    ats: { provider: input.provider, board: board.token, postingId: input.postingId },
  });

  const stored = {
    type,
    name: title.slice(0, 300),
    orgName: board.company,
    orgSlug: board.orgSlug,
    url: input.url,
    summary,
    description,
    benefits,
    cost: null,
    geo,
    languages: language ? [language] : [],
    tags,
    industries: board.industries,
    functions,
    eligibility,
    deadline,
    rolling: deadline === null,
    cycle: null,
    apply,
    requiredMaterials: materials,
    estAcceptanceRate: null,
    estEffortMinutes: null,
    public: false,
  };
  // Kept small: the row holds the content; the snapshot only records which version of the posting we read.
  const raw: OpportunitySnapshotRaw = {
    url: input.url,
    httpStatus: 200,
    contentType: "application/json",
    title: null,
    text: null,
    data: { provider: input.provider, board: board.token, postingId: input.postingId, updatedAt: input.updatedAt, publishedAt: input.publishedAt },
  };
  return {
    sourceRef: input.postingId,
    hash: contentHash({ v: 1, ...stored }),
    raw,
    draft: {
      ...stored,
      slug: jobSlug(title, board.company, input.provider, board.token, input.postingId),
      qualityScore: jobQuality({
        descriptionLength: description?.length ?? 0,
        hasCountryOrRemote: geo.countries.length > 0 || geo.remote === "remote",
        hasSalary,
        functions: functions.length,
        publishedAt,
        general,
        now,
      }),
      sourceRef: input.postingId,
      verifiedAt: now,
      status: deadline && deadline.getTime() < now.getTime() ? "expired" : "active",
    },
  };
}

/** Postings first published most recently first (stable on id), so a per-board cap keeps the freshest. */
export function newestFirst<T extends { publishedAt: string | null; postingId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0) || a.postingId.localeCompare(b.postingId));
}

/** Helper for clients: parse each posting leniently, counting the ones whose shape we don't recognise. */
export function parseEach<T>(items: unknown[], parse: (v: unknown) => T | null): { postings: T[]; invalid: number } {
  const postings: T[] = [];
  let invalid = 0;
  for (const item of items) {
    const p = parse(item);
    if (p) postings.push(p);
    else invalid++;
  }
  return { postings, invalid };
}
