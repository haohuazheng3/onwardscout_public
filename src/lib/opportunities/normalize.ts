/**
 * Turning what normalizeOpportunity read off a page into a valid `opportunities` row, and the
 * URL rules imports dedupe on. Unknown stays null (honesty rule 6): nothing here fills a gap
 * with a guess except the opportunity type, which the person's own goal suggests when the page
 * doesn't say (and `missing` keeps "type" so the UI can say so). Pure; tested.
 */
import { isFunctionId } from "@/lib/core/functions";
import { isIndustryCode } from "@/lib/core/industries";
import { isMaterialId } from "@/lib/core/materials";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core/opportunity-types";
import {
  CHANNEL_IDS,
  DEGREE_LEVELS,
  applyInfoSchema,
  eligibilitySchema,
  identityTargetSchema,
  opportunityBenefitsSchema,
  opportunityCostSchema,
  opportunityGeoSchema,
  type ApplyInfo,
  type ChannelId,
  type DegreeLevel,
  type Eligibility,
  type FunctionId,
  type IdentityTarget,
  type MaterialId,
  type OpportunityBenefits,
  type OpportunityCost,
  type OpportunityGeo,
  type OpportunityTypeId,
} from "@/lib/core/types";
import type { NormalizedOpportunity } from "@/lib/llm/types";

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|source|src|trk|trackingid|lipi|_hsenc|_hsmi|igshid|si)$/i;

/**
 * One URL per page: lower-case host, no hash, no tracking parameters, no trailing slash, and
 * (for dedupe keys) no "www.". `keepWww` keeps the host as served — the form we store and link to.
 */
export function canonicalOpportunityUrl(raw: string, opts: { keepWww?: boolean } = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = opts.keepWww ? u.hostname.toLowerCase() : u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  let s = u.toString();
  if (u.pathname !== "/" && s.endsWith("/") && !u.search) s = s.slice(0, -1);
  if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
  return s;
}

const clip = (s: string | null | undefined, n: number): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+\n/g, "\n").trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function slugify(s: string, max = 60): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const MONEY_KIND_BY_TYPE: Partial<Record<OpportunityTypeId, NonNullable<OpportunityBenefits["money"]>["kind"]>> = {
  job: "salary",
  internship: "salary",
  remote_job: "salary",
  part_time: "salary",
  graduate_program: "salary",
  returnship: "salary",
  ngo_job: "salary",
  postdoc: "salary",
  phd_position: "stipend",
  fellowship: "stipend",
  residency: "stipend",
  grant: "grant",
  government_program: "grant",
  scholarship: "scholarship",
  award: "prize",
  competition: "prize",
  hackathon: "prize",
  startup_competition: "prize",
  investor: "investment",
  accelerator: "investment",
};

const currency = (c: string | null | undefined): string | null => (c && /^[A-Za-z]{3}$/.test(c.trim()) ? c.trim().toUpperCase() : null);
const positive = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/** The deadline as a timestamp: a bare date means the end of that day (UTC). */
export function deadlineDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface NormalizedRow {
  type: OpportunityTypeId;
  name: string;
  orgName: string | null;
  orgSlug: string | null;
  url: string;
  summary: string | null;
  description: string | null;
  benefits: OpportunityBenefits;
  cost: OpportunityCost;
  geo: OpportunityGeo;
  languages: string[];
  tags: string[];
  industries: string[];
  functions: FunctionId[];
  eligibility: Eligibility;
  deadline: Date | null;
  rolling: boolean;
  cycle: string | null;
  apply: ApplyInfo;
  requiredMaterials: MaterialId[];
  estEffortMinutes: number | null;
  /** Fields the page didn't state (shown as "check the official page"). */
  missing: string[];
  /** True when the type came from the person's goal rather than the page. */
  typeGuessed: boolean;
}

/**
 * A valid row from normalizeOpportunity's output. `fallbackType` (from the person's goal) is
 * used only when the page names no recognisable type; `fallbackName` when it has no title.
 */
export function rowFromNormalized(n: NormalizedOpportunity, ctx: { url: string; fallbackType: OpportunityTypeId; fallbackName: string }): NormalizedRow {
  const pageType = n.type && isOpportunityTypeId(n.type) && n.type !== "practice" ? n.type : null;
  const type = pageType ?? (ctx.fallbackType === "practice" ? "job" : ctx.fallbackType);
  const def = getOpportunityType(type);
  const name = clip(n.name, 200) ?? ctx.fallbackName;
  const orgName = clip(n.orgName, 120);

  const money = n.benefits.money;
  const benefits = opportunityBenefitsSchema.parse({
    summary: clip(n.benefits.summary, 300),
    money:
      money && (positive(money.min) !== null || positive(money.max) !== null)
        ? { kind: MONEY_KIND_BY_TYPE[type] ?? "other", min: positive(money.min), max: positive(money.max), currency: currency(money.currency), period: null }
        : null,
    perks: n.benefits.perks.map((p) => clip(p, 80)).filter((p): p is string => Boolean(p)).slice(0, 8),
  });

  const fee = n.cost.applicationFee;
  const feeAmount = fee ? positive(fee.max ?? fee.min) : null;
  const cost = opportunityCostSchema.parse({
    free: n.cost.free,
    applicationFee: feeAmount !== null ? { amount: feeAmount, currency: currency(fee?.currency) } : null,
    equityPercent: typeof n.cost.equityPercent === "number" && n.cost.equityPercent >= 0 && n.cost.equityPercent <= 100 ? n.cost.equityPercent : null,
    notes: clip(n.cost.notes, 300),
  });

  const geo = opportunityGeoSchema.parse({
    countries: [...new Set(n.geo.countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 20),
    cities: n.geo.cities.map((c) => clip(c, 60)).filter((c): c is string => Boolean(c)).slice(0, 8),
    remote: n.geo.remote,
    worldwide: n.geo.worldwide,
  });

  const identities = n.eligibility.identities.map((t) => identityTargetSchema.safeParse(t.trim())).filter((r) => r.success).map((r) => r.data as IdentityTarget);
  const countries = (xs: string[]) => [...new Set(xs.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  const int = (v: number | null) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const eligibility = eligibilitySchema.parse({
    identities: [...new Set(identities)],
    stages: n.eligibility.stages.map((s) => s.trim()).filter(Boolean).slice(0, 10),
    degree: n.eligibility.degree && (DEGREE_LEVELS as readonly string[]).includes(n.eligibility.degree) ? (n.eligibility.degree as DegreeLevel) : null,
    minYears: positive(n.eligibility.minYears),
    maxYears: positive(n.eligibility.maxYears),
    nationality: countries(n.eligibility.nationality),
    residency: countries(n.eligibility.residency),
    ageMin: int(n.eligibility.ageMin),
    ageMax: int(n.eligibility.ageMax),
    studentsOnly: n.eligibility.studentsOnly,
    notes: clip(n.eligibility.notes, 600),
  });

  const channel: ChannelId = n.apply.channel && (CHANNEL_IDS as readonly string[]).includes(n.apply.channel) ? (n.apply.channel as ChannelId) : def.defaultChannel;
  const apply = applyInfoSchema.parse({
    channel,
    // The apply link comes from the imported page: only a public web address is kept (the
    // channels open it server-side; a private or odd address would be an SSRF vector).
    url: publicWebUrl(n.apply.url) ?? publicWebUrl(ctx.url),
    email: n.apply.email,
    platform: n.apply.platform,
    requiresAccount: n.apply.requiresAccount ?? false,
    requiresPayment: n.apply.requiresPayment ?? false,
  });

  const description = clip(n.description, 20_000);
  return {
    type,
    name,
    orgName,
    orgSlug: orgName ? slugify(orgName) || null : null,
    url: ctx.url,
    summary: clip(n.summary, 400) ?? (description ? clip(description.split("\n").find((l) => l.trim().length > 40) ?? description, 280) : null),
    description,
    benefits,
    cost,
    geo,
    languages: [...new Set(n.languages.map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(l)))].slice(0, 6),
    tags: [...new Set(n.tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2 && t.length <= 40))].slice(0, 12),
    industries: [...new Set(n.industries.filter((i) => isIndustryCode(i)))].slice(0, 8),
    functions: [...new Set(n.functions.filter(isFunctionId))].slice(0, 6) as FunctionId[],
    eligibility,
    deadline: deadlineDate(n.deadline),
    rolling: n.rolling,
    cycle: clip(n.cycle, 120),
    apply,
    requiredMaterials: [...new Set(n.requiredMaterials.filter(isMaterialId))] as MaterialId[],
    estEffortMinutes: typeof n.estEffortMinutes === "number" && n.estEffortMinutes > 0 ? Math.min(600, Math.round(n.estEffortMinutes)) : null,
    missing: [...new Set([...n.missing, ...(pageType ? [] : ["type"])])],
    typeGuessed: !pageType,
  };
}

/** "careers.example.com/jobs/123" → "Opportunity on careers.example.com" style fallback names. */
export function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 80);
  }
}

const LOCAL_HOST = /^(localhost|localhost\.localdomain|metadata|metadata\.google\.internal|instance-data)$|\.(localhost|local|internal|intranet|lan|home\.arpa|corp|private)$/;

/**
 * A plain public web address, or null: http(s) only, no credentials, standard ports, a dotted
 * host name that is not a local name or a bare IP address (real application pages never are).
 */
export function publicWebUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || (u.port && u.port !== "80" && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || LOCAL_HOST.test(host)) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  return u.toString();
}
