/*
 * Curated programs: content/seed/curated/*.json, researched and verified by hand against each
 * official page (accelerators, fellowships, grants, CFPs, residencies…). This module validates
 * every entry (an invalid entry is reported, never crashes the load), and maps entries to
 * opportunity rows: public SEO pages for the program types that have them, status from the
 * verification record and the deadline, nothing added that the entry does not say.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import {
  applyInfoSchema,
  channelIdSchema,
  eligibilitySchema,
  identityTargetSchema,
  opportunityBenefitsSchema,
  opportunityCostSchema,
  opportunityTypeIdSchema,
  type IdentityTarget,
  type OpportunitySnapshotRaw,
} from "@/lib/core/types";
import { countryFromName, normalizeCountryCode } from "./geo";
import { curatedStatus } from "./expiry";
import { contentHash, curatedQuality, deadlineFromDate, humanize, industryCodes, mapMaterials, moneyKindFor, orgSlugOf, parseApplicationFee, parseEquityPercent, parseMoney } from "./normalize";
import type { CuratedInvalid, CuratedWarning, MappedOpportunity } from "./types";

export const CURATED_DIR = path.join(process.cwd(), "content", "seed", "curated");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const httpUrl = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");
const text = z.string().trim();
const optText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));
const strList = z
  .array(z.string())
  .nullish()
  .transform((v) => (v ?? []).map((s) => s.trim()).filter(Boolean));

/** The research team's entry format (see the P2b brief). Lenient where unknown is allowed (null). */
export const curatedEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lower-case kebab-case").max(120),
  type: opportunityTypeIdSchema,
  name: text.min(2).max(300),
  org: optText,
  url: httpUrl,
  summary: text.min(20, "Summary is too short").max(1200),
  benefits: z.object({ funding: optText, other: strList }).nullish(),
  cost: z.object({ fee: optText, equity: optText }).nullish(),
  geo: z
    .object({ countries: strList, cities: strList, remote: z.boolean().nullish(), global: z.boolean().nullish() })
    .nullish(),
  languages: strList,
  industries: strList,
  tags: strList,
  eligibility: z.object({ identities: strList, stages: strList, notes: optText }).nullish(),
  deadline: isoDate.nullish(),
  rolling: z.boolean().nullish(),
  cycle: optText,
  apply: z.object({
    channel: channelIdSchema,
    url: optText,
    email: optText,
    platform: optText,
    requiresAccount: z.boolean().nullish(),
    requiresPayment: z.boolean().nullish(),
  }),
  requiredMaterials: strList,
  verified: z
    .object({ checkedAt: isoDate, httpStatus: z.number().int().nullish(), evidence: optText })
    .nullish(),
});
export type CuratedEntry = z.infer<typeof curatedEntrySchema>;

export interface CuratedFileEntry {
  file: string;
  entry: CuratedEntry;
}

export interface CuratedLoad {
  entries: CuratedFileEntry[];
  invalid: CuratedInvalid[];
  /** Files that are not valid JSON arrays at all. */
  unreadable: Array<{ file: string; error: string }>;
  /** Same slug in two places: the first wins. */
  duplicateSlugs: Array<{ slug: string; files: string[] }>;
}

/** Validates the entries of one parsed file (pure). */
export function validateCurated(file: string, json: unknown): { entries: CuratedFileEntry[]; invalid: CuratedInvalid[] } {
  const entries: CuratedFileEntry[] = [];
  const invalid: CuratedInvalid[] = [];
  if (!Array.isArray(json)) {
    invalid.push({ file, index: -1, slug: null, issues: ["The file must contain a JSON array of entries."] });
    return { entries, invalid };
  }
  json.forEach((item, index) => {
    const r = curatedEntrySchema.safeParse(item);
    if (r.success) {
      entries.push({ file, entry: r.data });
      return;
    }
    const slug = item && typeof item === "object" && typeof (item as { slug?: unknown }).slug === "string" ? (item as { slug: string }).slug : null;
    invalid.push({ file, index, slug, issues: r.error.issues.map((i) => `${i.path.join(".") || "(entry)"}: ${i.message}`) });
  });
  return { entries, invalid };
}

/** Reads and validates every `*.json` in the curated directory (files in name order). */
export function loadCurated(dir: string = CURATED_DIR): CuratedLoad {
  const out: CuratedLoad = { entries: [], invalid: [], unreadable: [], duplicateSlugs: [] };
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch (err) {
    out.unreadable.push({ file: dir, error: err instanceof Error ? err.message : String(err) });
    return out;
  }
  const seen = new Map<string, string>();
  for (const file of files) {
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      out.unreadable.push({ file, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const { entries, invalid } = validateCurated(file, json);
    out.invalid.push(...invalid);
    for (const e of entries) {
      const prev = seen.get(e.entry.slug);
      if (prev) {
        const dup = out.duplicateSlugs.find((d) => d.slug === e.entry.slug);
        if (dup) dup.files.push(file);
        else out.duplicateSlugs.push({ slug: e.entry.slug, files: [prev, file] });
        continue;
      }
      seen.set(e.entry.slug, file);
      out.entries.push(e);
    }
  }
  return out;
}

/** The source row name/url of a curated file ("startups.json" → seed://curated/startups). */
export function curatedSourceOf(file: string): { name: string; url: string } {
  const base = file.replace(/\.json$/, "");
  return { name: `Curated programs · ${base}`, url: `seed://curated/${base}` };
}

const PLATFORM_LABELS: Record<string, string> = {
  own_portal: "the organiser's own application portal",
  devpost: "Devpost",
  openreview: "OpenReview",
  sessionize: "Sessionize",
  slideroom: "SlideRoom",
  filmfreeway: "FilmFreeway",
  pretalx: "pretalx",
  hotcrp: "HotCRP",
  easychair: "EasyChair",
  airtable: "an Airtable form",
  fillout: "a Fillout form",
  google_forms: "a Google Form",
  typeform: "a Typeform",
  interfolio: "Interfolio",
  mathjobs: "MathJobs",
  academicjobsonline: "AcademicJobsOnline",
  embassy: "the embassy",
  university_nomination: "a nomination by your university",
};

function platformLabel(platform: string | null, email: string | null): string {
  if (platform && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
  if (platform) return humanize(platform);
  if (email) return `email to ${email}`;
  return "the official page";
}

function geoOf(e: CuratedEntry): { countries: string[]; cities: string[]; remote: "remote" | "onsite" | null; worldwide: boolean; unknown: string[] } {
  const countries: string[] = [];
  const unknown: string[] = [];
  for (const c of e.geo?.countries ?? []) {
    const code = normalizeCountryCode(c) ?? countryFromName(c);
    if (code) {
      if (!countries.includes(code)) countries.push(code);
    } else unknown.push(c);
  }
  const cities = [...new Set(e.geo?.cities ?? [])].slice(0, 12);
  // `remote: false` with a city means the program happens there; without a place it says nothing.
  const remote = e.geo?.remote === true ? "remote" : e.geo?.remote === false && cities.length ? "onsite" : null;
  return { countries, cities, remote, worldwide: e.geo?.global === true, unknown };
}

/** The stored description: the entry's own facts in plain sentences (nothing added). */
export function curatedDescription(e: CuratedEntry): string {
  const parts: string[] = [e.summary];
  if (e.benefits?.funding) parts.push(`What it offers: ${e.benefits.funding}.`.replace(/\.\.$/, "."));
  if (e.benefits?.other.length) parts.push(`Also: ${e.benefits.other.join("; ")}.`);
  if (e.eligibility?.notes) parts.push(`Who can apply: ${e.eligibility.notes}`);
  const cost = [e.cost?.fee ? (e.cost.fee.toLowerCase() === "free" ? "Free to apply." : `Cost: ${e.cost.fee}.`) : null, e.cost?.equity ? `Equity: ${e.cost.equity}.` : null].filter(Boolean);
  if (cost.length) parts.push(cost.join(" ").replace(/\.\./g, "."));
  const when = [e.cycle ? `${e.cycle}`.replace(/\.?$/, ".") : null, e.deadline ? `Next deadline: ${e.deadline}.` : null, e.rolling ? "Applications are reviewed on a rolling basis." : null].filter(Boolean);
  if (when.length) parts.push(when.join(" "));
  const how = `How to apply: through ${platformLabel(e.apply.platform, e.apply.email)}${e.apply.requiresAccount ? " (you need an account there)" : ""}${e.apply.requiresPayment ? "; a payment is part of applying" : ""}.`;
  parts.push(how);
  if (e.requiredMaterials.length) parts.push(`What to prepare: ${e.requiredMaterials.map(humanize).join(", ")}.`);
  if (e.verified?.evidence) parts.push(`From the official page (checked ${e.verified.checkedAt}): “${e.verified.evidence.replace(/^["“]|["”]$/g, "")}”`);
  return parts.join("\n\n");
}

/** Maps one validated entry to an opportunity row. Warnings name anything that could not be carried over. */
export function mapCuratedEntry(item: CuratedFileEntry, now: Date): { mapped: MappedOpportunity; warnings: CuratedWarning[] } {
  const { entry: e, file } = item;
  const warnings: CuratedWarning[] = [];
  const warn = (message: string) => warnings.push({ file, slug: e.slug, message });
  const typeDef = getOpportunityType(e.type);

  const geo = geoOf(e);
  if (geo.unknown.length) warn(`Unrecognised country values ignored: ${geo.unknown.join(", ")}`);

  const identities: IdentityTarget[] = [];
  for (const id of e.eligibility?.identities ?? []) {
    const r = identityTargetSchema.safeParse(id.toUpperCase() === "ALL" ? "ALL" : id.toUpperCase());
    if (r.success) {
      if (!identities.includes(r.data)) identities.push(r.data);
    } else warn(`Unknown identity "${id}" ignored`);
  }

  const materials = mapMaterials(e.requiredMaterials, e.type);
  if (materials.unknown.length) warn(`Materials kept in the description only: ${materials.unknown.join(", ")}`);

  const deadline = deadlineFromDate(e.deadline);
  if (e.deadline && !deadline) warn(`Invalid deadline "${e.deadline}" ignored`);
  const verified = Boolean(e.verified?.checkedAt) && (e.verified?.httpStatus == null || (e.verified.httpStatus >= 200 && e.verified.httpStatus < 400));
  const status = curatedStatus({ verified, deadline, rolling: e.rolling === true, now });

  const funding = e.benefits?.funding ?? null;
  const money = parseMoney(funding, moneyKindFor(e.type), { countries: geo.countries });
  const fee = e.cost?.fee ?? null;
  const feeLower = (fee ?? "").toLowerCase().trim();
  // Free only when the entry says so without conditions ("free", "free (no submission fee…)", "free to apply").
  const free = /^free(?:\s*\((?:no|zero)\b[^)]*\))?$|^free to apply\b/.test(feeLower) ? true : null;
  const equityPercent = parseEquityPercent(e.cost?.equity);
  const equityText = e.cost?.equity ?? null;
  const costNotes = [fee && !/^free$/i.test(fee) ? fee : null, equityText && !/^\s*(?:\d+(?:\.\d+)?\s*%|none)\s*$/i.test(equityText) ? `Equity: ${equityText}` : null]
    .filter(Boolean)
    .join(" · ");
  const cost =
    fee || e.cost?.equity
      ? opportunityCostSchema.parse({ free, applicationFee: parseApplicationFee(fee), equityPercent, notes: costNotes || null })
      : null;

  const benefits =
    funding || e.benefits?.other.length
      ? opportunityBenefitsSchema.parse({ summary: funding, money, perks: (e.benefits?.other ?? []).slice(0, 20) })
      : null;

  const eligibility =
    identities.length || e.eligibility?.stages.length || e.eligibility?.notes
      ? eligibilitySchema.parse({ identities, stages: e.eligibility?.stages ?? [], notes: e.eligibility?.notes ?? null })
      : null;

  const applyUrl = e.apply.url && httpUrl.safeParse(e.apply.url).success ? e.apply.url : null;
  if (e.apply.url && !applyUrl) warn(`apply.url "${e.apply.url}" is not an http(s) URL; the official page is used instead`);
  const apply = applyInfoSchema.parse({
    channel: e.apply.channel,
    url: applyUrl ?? e.url,
    email: e.apply.email,
    platform: e.apply.platform,
    requiresAccount: e.apply.requiresAccount === true,
    requiresPayment: e.apply.requiresPayment === true,
  });

  const stored = {
    type: e.type,
    name: e.name,
    orgName: e.org,
    orgSlug: orgSlugOf(e.org),
    url: e.url,
    summary: e.summary.length > 320 ? `${e.summary.slice(0, 319).replace(/\s+\S*$/, "")}…` : e.summary,
    description: curatedDescription(e),
    benefits,
    cost,
    geo: { countries: geo.countries, cities: geo.cities, remote: geo.remote, worldwide: geo.worldwide },
    languages: [...new Set(e.languages.map((l) => l.toLowerCase()).filter((l) => /^[a-z]{2,3}$/.test(l)))],
    tags: [...new Set(e.tags.map((t) => t.toLowerCase()))].slice(0, 15),
    industries: industryCodes(e.industries),
    functions: [],
    eligibility,
    deadline,
    rolling: e.rolling === true,
    cycle: e.cycle,
    apply,
    requiredMaterials: materials.ids,
    estAcceptanceRate: null,
    estEffortMinutes: null,
    public: typeDef.publicSeo,
  };
  const raw: OpportunitySnapshotRaw = {
    url: e.url,
    httpStatus: e.verified?.httpStatus ?? null,
    contentType: null,
    title: e.name,
    text: e.verified?.evidence ?? null,
    data: JSON.parse(JSON.stringify({ file, entry: e })),
  };
  const mapped: MappedOpportunity = {
    sourceRef: e.slug,
    hash: contentHash({ v: 1, entry: e }),
    raw,
    draft: {
      ...stored,
      slug: e.slug,
      sourceRef: e.slug,
      qualityScore: curatedQuality({
        verified,
        hasEvidence: Boolean(e.verified?.evidence),
        hasDeadlineOrRolling: Boolean(deadline) || e.rolling === true,
        hasBenefits: Boolean(funding || e.benefits?.other.length),
        summaryLength: e.summary.length,
        hasApplyUrl: Boolean(applyUrl),
      }),
      // The day it was checked (its start, never later than now: the time of day is not recorded).
      verifiedAt: verified && e.verified ? new Date(Math.min(Date.parse(`${e.verified.checkedAt}T00:00:00Z`), now.getTime())) : null,
      status,
    },
  };
  return { mapped, warnings };
}
