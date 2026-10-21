/*
 * Lever public Postings API: GET api.lever.co/v0/postings/{site}?mode=json lists every
 * published posting (EU-hosted sites answer on api.eu.lever.co). `hostedUrl` is the posting,
 * `applyUrl` its hosted form.
 */
import { z } from "zod";
import type { JobInput } from "../types";
import { AtsHttpError, fetchJson, parseEach, type FetchJsonOptions } from "./common";

export const LEVER_API = "https://api.lever.co/v0/postings";
export const LEVER_EU_API = "https://api.eu.lever.co/v0/postings";

export function leverBoardUrl(token: string, eu = false): string {
  return `${eu ? LEVER_EU_API : LEVER_API}/${encodeURIComponent(token)}`;
}

export const leverPostingSchema = z.looseObject({
  id: z.string().min(1),
  text: z.string().min(1),
  hostedUrl: z.string().min(1),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  updatedAt: z.number().nullish(),
  categories: z
    .looseObject({
      commitment: z.string().nullish(),
      department: z.string().nullish(),
      team: z.string().nullish(),
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.looseObject({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additional: z.string().nullish(),
  salaryRange: z.looseObject({ min: z.number().nullish(), max: z.number().nullish(), currency: z.string().nullish(), interval: z.string().nullish() }).nullish(),
  salaryDescriptionPlain: z.string().nullish(),
});
export type LeverPosting = z.infer<typeof leverPostingSchema>;

function salaryPeriod(interval: string | null | undefined): "year" | "month" | "week" | "day" | "hour" | null {
  const v = (interval ?? "").toLowerCase();
  if (v.includes("year")) return "year";
  if (v.includes("month")) return "month";
  if (v.includes("week")) return "week";
  if (v.includes("day")) return "day";
  if (v.includes("hour")) return "hour";
  return null;
}

/** One Lever posting → provider-neutral input. */
export function leverToInput(p: LeverPosting): JobInput {
  const lists = (p.lists ?? []).map((l) => `<h3>${l.text ?? ""}</h3><ul>${l.content ?? ""}</ul>`).join("");
  const html = [p.description ?? "", lists, p.additional ?? ""].join("\n");
  const cat = p.categories ?? {};
  const s = p.salaryRange;
  const salary =
    s && (typeof s.min === "number" || typeof s.max === "number")
      ? { min: s.min ?? null, max: s.max ?? null, currency: s.currency ? s.currency.toUpperCase() : null, period: salaryPeriod(s.interval), text: p.salaryDescriptionPlain?.trim() || null }
      : null;
  const createdAt = typeof p.createdAt === "number" ? new Date(p.createdAt).toISOString() : null;
  return {
    provider: "lever",
    postingId: p.id,
    title: p.text,
    url: p.hostedUrl,
    applyUrl: p.applyUrl ?? null,
    html: html.trim() ? html : null,
    text: html.trim() ? null : (p.descriptionPlain ?? null),
    departments: [cat.department, cat.team].filter((d): d is string => Boolean(d && d.trim())),
    employmentType: cat.commitment ?? null,
    locations: [cat.location ?? "", ...(cat.allLocations ?? [])].filter(Boolean),
    countryHints: p.country ? [p.country] : [],
    workplaceType: p.workplaceType && p.workplaceType !== "unspecified" ? p.workplaceType : null,
    language: null,
    salary,
    deadline: null,
    publishedAt: createdAt,
    updatedAt: typeof p.updatedAt === "number" ? new Date(p.updatedAt).toISOString() : createdAt,
  };
}

export async function fetchLeverBoard(token: string, opts: FetchJsonOptions = {}): Promise<{ inputs: JobInput[]; invalid: number; total: number; eu: boolean }> {
  let eu = false;
  let json: unknown;
  try {
    json = await fetchJson(`${leverBoardUrl(token)}?mode=json`, opts);
  } catch (err) {
    // Sites hosted in Lever's EU region answer 404 on the global API.
    if (!(err instanceof AtsHttpError) || err.status !== 404) throw err;
    eu = true;
    json = await fetchJson(`${leverBoardUrl(token, true)}?mode=json`, opts);
  }
  const items = z.array(z.unknown()).parse(json);
  const { postings, invalid } = parseEach(items, (v) => {
    const r = leverPostingSchema.safeParse(v);
    return r.success ? r.data : null;
  });
  return { inputs: postings.map(leverToInput), invalid, total: items.length, eu };
}
