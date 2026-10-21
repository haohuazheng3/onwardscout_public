/*
 * Greenhouse public Job Board API: GET boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
 * returns every open posting of a board with its description (HTML, entity-escaped once).
 * The hosted posting (absolute_url) carries the application form on the same page.
 */
import { z } from "zod";
import type { JobInput } from "../types";
import { fetchJson, parseEach, type FetchJsonOptions } from "./common";

export const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards";

export function greenhouseBoardUrl(token: string): string {
  return `${GREENHOUSE_API}/${encodeURIComponent(token)}/jobs`;
}

const named = z.looseObject({ name: z.string().nullish() });

export const greenhouseJobSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  absolute_url: z.string().min(1),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  location: named.nullish(),
  content: z.string().nullish(),
  departments: z.array(named).nullish(),
  offices: z.array(z.looseObject({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
  language: z.string().nullish(),
  application_deadline: z.string().nullish(),
  metadata: z.array(z.looseObject({ name: z.string().nullish(), value: z.unknown() })).nullish(),
});
export type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

const boardSchema = z.looseObject({ jobs: z.array(z.unknown()) });

function metaValue(job: GreenhouseJob, re: RegExp): string | null {
  for (const m of job.metadata ?? []) {
    if (!m.name || !re.test(m.name)) continue;
    const v = m.value;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === "string") return v.join(", ");
  }
  return null;
}

/** Greenhouse's own hosted page for a posting (used when the employer's URL does not name the posting). */
export function greenhouseHostedUrl(token: string, id: string): string {
  return `https://job-boards.greenhouse.io/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`;
}

/** One Greenhouse posting → provider-neutral input. */
export function greenhouseToInput(job: GreenhouseJob, token: string): JobInput {
  const id = String(job.id);
  const offices = (job.offices ?? []).flatMap((o) => [o.location, o.name]).filter((s): s is string => Boolean(s && s.trim()));
  return {
    provider: "greenhouse",
    postingId: id,
    title: job.title,
    url: job.absolute_url.includes(id) ? job.absolute_url : greenhouseHostedUrl(token, id),
    applyUrl: null,
    html: job.content ?? null,
    text: null,
    departments: (job.departments ?? []).map((d) => d.name ?? "").filter(Boolean),
    employmentType: metaValue(job, /employment type|job type|time type|commitment/i),
    locations: [job.location?.name ?? "", ...offices].filter(Boolean),
    countryHints: [],
    workplaceType: metaValue(job, /workplace|location type|remote/i),
    language: job.language ?? null,
    salary: null,
    deadline: job.application_deadline ?? null,
    publishedAt: job.first_published ?? job.updated_at ?? null,
    updatedAt: job.updated_at ?? null,
  };
}

export async function fetchGreenhouseBoard(token: string, opts: FetchJsonOptions = {}): Promise<{ inputs: JobInput[]; invalid: number; total: number }> {
  const json = await fetchJson(`${greenhouseBoardUrl(token)}?content=true`, { timeoutMs: 60_000, ...opts });
  const board = boardSchema.parse(json);
  const { postings, invalid } = parseEach(board.jobs, (v) => {
    const r = greenhouseJobSchema.safeParse(v);
    return r.success ? r.data : null;
  });
  return { inputs: postings.map((p) => greenhouseToInput(p, token)), invalid, total: board.jobs.length };
}
