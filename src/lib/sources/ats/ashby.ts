/*
 * Ashby public Job Posting API: GET api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 * lists the board's published postings with HTML descriptions, structured addresses, workplace
 * type and (when the employer publishes it) compensation.
 */
import { z } from "zod";
import type { JobInput } from "../types";
import { fetchJson, parseEach, type FetchJsonOptions } from "./common";

export const ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board";

export function ashbyBoardUrl(token: string): string {
  return `${ASHBY_API}/${encodeURIComponent(token)}`;
}

const addressSchema = z.looseObject({
  postalAddress: z.looseObject({ addressCountry: z.string().nullish(), addressLocality: z.string().nullish(), addressRegion: z.string().nullish() }).nullish(),
});

const componentSchema = z.looseObject({
  compensationType: z.string().nullish(),
  interval: z.string().nullish(),
  currencyCode: z.string().nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
});

export const ashbyJobSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  department: z.string().nullish(),
  team: z.string().nullish(),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.looseObject({ location: z.string().nullish(), address: addressSchema.nullish() })).nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  address: addressSchema.nullish(),
  jobUrl: z.string().min(1),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  compensation: z
    .looseObject({
      scrapeableCompensationSalarySummary: z.string().nullish(),
      compensationTierSummary: z.string().nullish(),
      summaryComponents: z.array(componentSchema).nullish(),
      compensationTiers: z.array(z.looseObject({ components: z.array(componentSchema).nullish() })).nullish(),
    })
    .nullish(),
});
export type AshbyJob = z.infer<typeof ashbyJobSchema>;

const boardSchema = z.looseObject({ jobs: z.array(z.unknown()) });

function period(interval: string | null | undefined): "year" | "month" | "week" | "day" | "hour" | null {
  const v = (interval ?? "").toUpperCase();
  if (/YEAR/.test(v)) return "year";
  if (/MONTH/.test(v)) return "month";
  if (/WEEK/.test(v)) return "week";
  if (/DAY/.test(v)) return "day";
  if (/HOUR/.test(v)) return "hour";
  return null;
}

/** The salary range across the posting's tiers (one currency and interval only; else null). */
export function ashbySalary(job: AshbyJob): JobInput["salary"] {
  const c = job.compensation;
  if (!c) return null;
  const comps = [...(c.summaryComponents ?? []), ...(c.compensationTiers ?? []).flatMap((t) => t.components ?? [])].filter(
    (x) => /salary/i.test(x.compensationType ?? "") && (typeof x.minValue === "number" || typeof x.maxValue === "number"),
  );
  if (!comps.length) return null;
  const currencies = new Set(comps.map((x) => x.currencyCode ?? ""));
  const intervals = new Set(comps.map((x) => period(x.interval)));
  if (currencies.size !== 1 || intervals.size !== 1) return null;
  const mins = comps.map((x) => x.minValue).filter((n): n is number => typeof n === "number");
  const maxes = comps.map((x) => x.maxValue).filter((n): n is number => typeof n === "number");
  return {
    min: mins.length ? Math.min(...mins) : null,
    max: maxes.length ? Math.max(...maxes) : null,
    currency: [...currencies][0] || null,
    period: [...intervals][0] ?? null,
    text: c.scrapeableCompensationSalarySummary?.trim() || null,
  };
}

function place(a: z.infer<typeof addressSchema> | null | undefined): { text: string | null; country: string | null } {
  const p = a?.postalAddress;
  if (!p) return { text: null, country: null };
  const parts = [p.addressLocality, p.addressRegion, p.addressCountry].map((s) => (s ?? "").trim()).filter(Boolean);
  return { text: parts.length ? parts.join(", ") : null, country: p.addressCountry?.trim() || null };
}

/** One Ashby posting → provider-neutral input. */
export function ashbyToInput(job: AshbyJob): JobInput {
  const primary = place(job.address);
  const secondary = (job.secondaryLocations ?? []).map((s) => ({ label: s.location ?? null, ...place(s.address) }));
  const workplace = job.workplaceType ?? (job.isRemote === true ? "Remote" : null);
  return {
    provider: "ashby",
    postingId: job.id,
    title: job.title,
    url: job.jobUrl,
    applyUrl: job.applyUrl ?? null,
    html: job.descriptionHtml ?? null,
    text: job.descriptionHtml ? null : (job.descriptionPlain ?? null),
    departments: [job.department, job.team].filter((d): d is string => Boolean(d && d.trim())),
    employmentType: job.employmentType ?? null,
    locations: [primary.text ?? job.location ?? "", ...secondary.map((s) => s.text ?? s.label ?? "")].filter(Boolean),
    countryHints: [primary.country, ...secondary.map((s) => s.country)].filter((c): c is string => Boolean(c)),
    workplaceType: workplace,
    language: null,
    salary: ashbySalary(job),
    deadline: null,
    publishedAt: job.publishedAt ?? null,
    updatedAt: job.publishedAt ?? null,
  };
}

export async function fetchAshbyBoard(token: string, opts: FetchJsonOptions = {}): Promise<{ inputs: JobInput[]; invalid: number; total: number }> {
  const json = await fetchJson(`${ashbyBoardUrl(token)}?includeCompensation=true`, opts);
  const board = boardSchema.parse(json);
  const { postings, invalid } = parseEach(board.jobs, (v) => {
    const r = ashbyJobSchema.safeParse(v);
    return r.success ? r.data : null;
  });
  const listed = postings.filter((j) => j.isListed !== false);
  return { inputs: listed.map(ashbyToInput), invalid, total: board.jobs.length };
}
