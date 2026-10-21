/**
 * Programmatic SEO: the rules and the words behind /opportunities, /careers, /organizations
 * and /guides (English-only pages; their /zh variants redirect to English).
 *
 * Three layers, top to bottom:
 *   1. Pure rules — paths and canonicals, regions, normalisers that turn P2a's opportunity
 *      shapes into page view-models, timing, quality gates (what is indexable), guide
 *      completeness, career derivation. Unit-tested in tests/programmatic.test.ts.
 *   2. Copy — per opportunity type: an intro, "how to win these", the questions applicants
 *      meet and how to answer them honestly; timelines per family of types; what Onward Scout
 *      does per channel. Written by hand; no invented numbers, programs or outcomes.
 *   3. Data access (server only) — thin cached wrappers over the opportunity engine
 *      (`@/lib/opportunities`, contracts §7), loaded lazily so the pure layer stays importable
 *      from tests. Without DATABASE_URL (a build with no env) they return empty data and the
 *      pages render their honest empty states.
 */
import { cache } from "react";
import { getGoalFamily, getSubGoal, subGoalAppliesTo, subGoalsOf } from "./core/goals";
import { isIdentityCode } from "./core/identities";
import { getIndustry, industryLabel, isIndustryCode, mapIndustry, topLevelIndustry } from "./core/industries";
import { functionLabel, isFunctionId, mapFunction } from "./core/functions";
import { getMaterial, isMaterialId, type MaterialProducer } from "./core/materials";
import { GOAL_MATRIX } from "./core/matrix";
import { OCCUPATIONS, getOccupation, isOccupationCode, mapOccupation, type OccupationDef } from "./core/occupations";
import { getOpportunityType, isOpportunityTypeId, opportunityTypeBySlug, publicOpportunityTypes, type OpportunityTypeDef } from "./core/opportunity-types";
import {
  GOAL_FAMILIES,
  groupOfIdentity,
  type ChannelId,
  type GoalFamily,
  type IdentityCode,
  type IdentityGroup,
  type OpportunityGroup,
  type OpportunityTypeId,
  type SubGoalId,
} from "./core/types";

/* ================================================================== 1. rules */

/** A hub, region page or playbook needs at least this many live listings to be indexed. */
export const MIN_INDEX_ITEMS = 3;
/** An organization page exists for organizations with at least this many public listings. */
export const ORG_MIN_ITEMS = 2;
/** Listings per page on /opportunities/<type> (later pages at /opportunities/<type>/page/<n>). */
export const LIST_PAGE_SIZE = 24;
/** Static segments that sit beside /opportunities/<type>/<slug>: they can never be listing slugs. */
export const RESERVED_LISTING_SLUGS = ["page", "in"] as const;
/** A deadline counts as passed one day after its timestamp (organisers often mean "end of day, anywhere on Earth"). */
export const DEADLINE_GRACE_MS = 24 * 60 * 60 * 1000;
/** Deadlines this close are flagged "closing soon". */
export const SOON_MS = 14 * 24 * 60 * 60 * 1000;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && slug.length <= 160 && SLUG_RE.test(slug);
}

/* ---------------------------------------------------------------- paths */

export const OPPORTUNITIES_PATH = "/opportunities";
export const CAREERS_PATH = "/careers";
export const ORGANIZATIONS_PATH = "/organizations";
export const GUIDES_PATH = "/guides";

export function typePath(typeSlug: string, page = 1): string {
  return page > 1 ? `/opportunities/${typeSlug}/page/${page}` : `/opportunities/${typeSlug}`;
}

export function regionPath(typeSlug: string, region: RegionId): string {
  return `/opportunities/${typeSlug}/in/${region}`;
}

/** Slug of a type id's public hub ("accelerator" → "accelerators"). */
export function typeSlugOf(type: string): string | null {
  return isOpportunityTypeId(type) ? getOpportunityType(type).slug : null;
}

/** The one canonical URL of a listing: always under its real type, whatever URL reached it. */
export function opportunityPath(type: string, slug: string): string {
  return `/opportunities/${typeSlugOf(type) ?? "unknown"}/${slug}`;
}

/**
 * Where a request for /opportunities/<requestedTypeSlug>/<slug> belongs: null when it is
 * already canonical, else the canonical path to redirect to (a listing filed under the wrong
 * type, or a type that changed after review).
 */
export function canonicalRedirect(requestedTypeSlug: string, listing: { type: string; slug: string }): string | null {
  const canonical = opportunityPath(listing.type, listing.slug);
  return canonical === `/opportunities/${requestedTypeSlug}/${listing.slug}` ? null : canonical;
}

export function careerPath(code: string): string {
  return `/careers/${code}`;
}

export function orgPath(slug: string): string {
  return `/organizations/${slug}`;
}

const GUIDE_TO = "how-to-apply-to-";
const GUIDE_FOR = "how-to-apply-for-";

/** Program guide: /guides/how-to-apply-to-<listing slug>. */
export function programGuidePath(listingSlug: string): string {
  return `/guides/${GUIDE_TO}${listingSlug}`;
}

/** Type playbook: /guides/how-to-apply-for-<type slug>. */
export function playbookPath(typeSlug: string): string {
  return `/guides/${GUIDE_FOR}${typeSlug}`;
}

export type GuideRef = { kind: "program"; slug: string } | { kind: "playbook"; typeSlug: string; type: OpportunityTypeId };

/** Parses a /guides/<slug> segment; null for anything that is not a guide URL. */
export function parseGuideSlug(segment: string): GuideRef | null {
  if (!isValidSlug(segment)) return null;
  if (segment.startsWith(GUIDE_FOR)) {
    const typeSlug = segment.slice(GUIDE_FOR.length);
    const def = opportunityTypeBySlug(typeSlug);
    return def ? { kind: "playbook", typeSlug, type: def.id } : null;
  }
  if (segment.startsWith(GUIDE_TO)) {
    const slug = segment.slice(GUIDE_TO.length);
    return isValidSlug(slug) ? { kind: "program", slug } : null;
  }
  return null;
}

/** The prefixes of the English-only page families this module owns. */
export const ENGLISH_ONLY_SEO_PREFIXES = ["/opportunities", "/careers", "/organizations", "/guides", "/blog"] as const;

/**
 * The English URL a request on a /zh path must permanently redirect to, or null when the path
 * is not an English-only page (a normal bilingual page keeps its Chinese version).
 *   /zh/opportunities/grants → /opportunities/grants;  /zh/pricing → null
 */
export function zhRedirectTarget(pathname: string): string | null {
  const m = /^\/zh(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const rest = (m[1] ?? "/").replace(/\/+$/, "") || "/";
  const englishOnly = ENGLISH_ONLY_SEO_PREFIXES.some((p) => rest === p || rest.startsWith(`${p}/`));
  return englishOnly ? rest : null;
}

/* ---------------------------------------------------------------- regions */

export const REGION_IDS = ["worldwide", "north-america", "latin-america", "europe", "middle-east", "africa", "asia-pacific"] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const REGION_LABELS: Record<RegionId, string> = {
  worldwide: "Open worldwide or remote",
  "north-america": "North America",
  "latin-america": "Latin America & Caribbean",
  europe: "Europe",
  "middle-east": "Middle East",
  africa: "Africa",
  "asia-pacific": "Asia-Pacific",
};

/** Short label used in titles: "Accelerators in Europe", "Grants open worldwide". */
export function regionPhrase(region: RegionId): string {
  return region === "worldwide" ? "open worldwide or remote" : `in ${REGION_LABELS[region]}`;
}

const REGION_COUNTRIES: Record<Exclude<RegionId, "worldwide">, string> = {
  "north-america": "US CA PR BM GL",
  "latin-america":
    "MX GT BZ SV HN NI CR PA CU DO HT JM TT BS BB AG DM GD KN LC VC CO VE EC PE BO BR PY UY AR CL GY SR GF AW CW KY TC VG VI",
  europe:
    "GB IE FR DE NL BE LU CH AT IT ES PT DK SE NO FI IS PL CZ SK HU SI HR RO BG GR CY MT EE LV LT UA RS BA ME MK AL MD BY LI MC AD SM VA XK RU TR GE AM AZ FO GI IM JE GG",
  "middle-east": "AE SA QA KW BH OM IL JO LB IQ IR SY YE PS",
  africa:
    "EG MA DZ TN LY SD SS ET ER DJ SO KE UG TZ RW BI CD CG CF CM GA GQ ST NG GH CI SN ML BF NE TD GN GW SL LR TG BJ GM CV MR AO ZM ZW MW MZ MG MU SC KM NA BW ZA LS SZ RE YT",
  "asia-pacific":
    "CN HK MO TW JP KR KP MN SG MY ID TH VN PH KH LA MM BN TL IN PK BD LK NP BT MV AF KZ UZ KG TJ TM AU NZ PG FJ SB VU WS TO KI FM MH PW NR TV NC PF GU",
};

const COUNTRY_REGION = new Map<string, RegionId>();
for (const [region, codes] of Object.entries(REGION_COUNTRIES)) {
  for (const c of codes.split(/\s+/)) COUNTRY_REGION.set(c, region as RegionId);
}

export function isRegionId(v: unknown): v is RegionId {
  return typeof v === "string" && (REGION_IDS as readonly string[]).includes(v);
}

export function regionOfCountry(code: string): RegionId | null {
  return COUNTRY_REGION.get(code.trim().toUpperCase()) ?? null;
}

/** Every region a listing belongs to: where it takes place, plus "worldwide" when it is open to anyone or remote. */
export function regionsOf(geo: ListingGeo): RegionId[] {
  const out = new Set<RegionId>();
  if (geo.worldwide || geo.remote === "remote") out.add("worldwide");
  for (const c of geo.countries) {
    const r = regionOfCountry(c);
    if (r) out.add(r);
  }
  return REGION_IDS.filter((r) => out.has(r));
}

let regionNames: Intl.DisplayNames | null = null;

/** "US" → "United States"; unknown codes come back as given. */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Seattle, United States" / "Remote" / "Open worldwide" / null when unknown. */
export function placeLine(geo: ListingGeo): string | null {
  const parts: string[] = [];
  const where = [...geo.cities.slice(0, 2), ...geo.countries.slice(0, 3).map(countryName)];
  if (where.length) parts.push(where.join(", "));
  if (geo.remote === "remote") parts.push("remote");
  else if (geo.remote === "hybrid") parts.push("hybrid");
  if (geo.worldwide) parts.push(where.length ? "open to applicants worldwide" : "open worldwide");
  if (!parts.length) return null;
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------------------------------------------------------- view-models */

export interface ListingGeo {
  countries: string[];
  cities: string[];
  remote: "remote" | "hybrid" | "onsite" | null;
  worldwide: boolean;
}

export interface MoneyInfo {
  kind: string;
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
}

export interface ListingBenefits {
  summary: string | null;
  money: MoneyInfo | null;
  perks: string[];
  visaSponsorship: boolean | null;
  travelSupport: boolean | null;
  housing: boolean | null;
}

export interface ListingCost {
  free: boolean | null;
  applicationFee: { amount: number | null; currency: string | null } | null;
  participationFee: { amount: number | null; currency: string | null } | null;
  equityPercent: number | null;
  timeCommitment: string | null;
  relocationRequired: boolean | null;
  notes: string | null;
}

/** One public listing as the SEO pages use it (built from P2a's OpportunityCard or a full row). */
export interface PublicListing {
  id: string;
  slug: string;
  type: OpportunityTypeId;
  typeSlug: string;
  name: string;
  orgName: string | null;
  orgSlug: string | null;
  /** The official page. */
  url: string | null;
  summary: string | null;
  /** ISO timestamp. */
  deadline: string | null;
  rolling: boolean;
  cycle: string | null;
  geo: ListingGeo;
  benefits: ListingBenefits | null;
  cost: ListingCost | null;
  requiredMaterials: string[];
  tags: string[];
  channel: ChannelId | null;
  requiresAccount: boolean;
  requiresPayment: boolean;
  qualityScore: number | null;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  status: string;
  isPublic: boolean;
}

export interface ListingEligibility {
  identities: string[];
  stages: string[];
  degree: string | null;
  minYears: number | null;
  maxYears: number | null;
  nationality: string[];
  residency: string[];
  ageMin: number | null;
  ageMax: number | null;
  studentsOnly: boolean | null;
  companyMaxAgeYears: number | null;
  notes: string | null;
}

/** A full listing for the detail page and guides (built from the `opportunities` row or P2a's detail shape). */
export interface ListingDetail extends PublicListing {
  description: string | null;
  eligibility: ListingEligibility | null;
  languages: string[];
  industries: string[];
  functions: string[];
  apply: { url: string | null; email: string | null; platform: string | null; instructions: string | null };
  estEffortMinutes: number | null;
}

type Loose = Record<string, unknown>;

function rec(v: unknown): Loose | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}
/** Date | ISO string → ISO string. */
function iso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

function toGeo(v: unknown): ListingGeo {
  const g = rec(v) ?? {};
  const remote = g.remote === "remote" || g.remote === "hybrid" || g.remote === "onsite" ? g.remote : null;
  return {
    countries: strs(g.countries).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
    cities: strs(g.cities),
    remote,
    worldwide: g.worldwide === true,
  };
}

function toMoneyAmount(v: unknown): { amount: number | null; currency: string | null } | null {
  const m = rec(v);
  if (!m) return null;
  return { amount: num(m.amount), currency: str(m.currency)?.toUpperCase() ?? null };
}

function toBenefits(v: unknown): ListingBenefits | null {
  const b = rec(v);
  if (!b) return null;
  const m = rec(b.money);
  return {
    summary: str(b.summary),
    money: m ? { kind: str(m.kind) ?? "other", min: num(m.min), max: num(m.max), currency: str(m.currency)?.toUpperCase() ?? null, period: str(m.period) } : null,
    perks: strs(b.perks),
    visaSponsorship: bool(b.visaSponsorship),
    travelSupport: bool(b.travelSupport),
    housing: bool(b.housing),
  };
}

function toCost(v: unknown): ListingCost | null {
  const c = rec(v);
  if (!c) return null;
  return {
    free: bool(c.free),
    applicationFee: toMoneyAmount(c.applicationFee),
    participationFee: toMoneyAmount(c.participationFee),
    equityPercent: num(c.equityPercent),
    timeCommitment: str(c.timeCommitment),
    relocationRequired: bool(c.relocationRequired),
    notes: str(c.notes),
  };
}

const CHANNELS = new Set(["CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"]);

/**
 * P2a's OpportunityCard (or a full row) → PublicListing. Tolerant by design: it reads the
 * fields the SEO pages need and ignores the rest; null when the essentials (slug, name, a
 * known type) are missing.
 */
export function toListing(raw: unknown): PublicListing | null {
  const r = rec(raw);
  if (!r) return null;
  const slug = str(r.slug);
  const name = str(r.name);
  const type = str(r.type);
  if (!slug || !name || !type || !isOpportunityTypeId(type)) return null;
  const apply = rec(r.apply);
  const channel = str(r.channel) ?? str(apply?.channel);
  return {
    id: str(r.id) ?? slug,
    slug,
    type,
    typeSlug: getOpportunityType(type).slug,
    name,
    orgName: str(r.orgName),
    orgSlug: str(r.orgSlug),
    url: str(r.url),
    summary: str(r.summary),
    deadline: iso(r.deadline),
    rolling: r.rolling === true,
    cycle: str(r.cycle),
    geo: toGeo(r.geo),
    benefits: toBenefits(r.benefits),
    cost: toCost(r.cost),
    requiredMaterials: strs(r.requiredMaterials),
    tags: strs(r.tags),
    channel: channel && CHANNELS.has(channel) ? (channel as ChannelId) : null,
    requiresAccount: r.requiresAccount === true || apply?.requiresAccount === true,
    requiresPayment: r.requiresPayment === true || apply?.requiresPayment === true,
    qualityScore: num(r.qualityScore),
    verifiedAt: iso(r.verifiedAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    status: str(r.status) ?? "active",
    isPublic: r.public !== false,
  };
}

function toEligibility(v: unknown): ListingEligibility | null {
  const e = rec(v);
  if (!e) return null;
  return {
    identities: strs(e.identities),
    stages: strs(e.stages),
    degree: str(e.degree),
    minYears: num(e.minYears),
    maxYears: num(e.maxYears),
    nationality: strs(e.nationality).map((c) => c.toUpperCase()),
    residency: strs(e.residency).map((c) => c.toUpperCase()),
    ageMin: num(e.ageMin),
    ageMax: num(e.ageMax),
    studentsOnly: bool(e.studentsOnly),
    companyMaxAgeYears: num(e.companyMaxAgeYears),
    notes: str(e.notes),
  };
}

/** A full row (`opportunities` table) or P2a's OpportunityDetail → ListingDetail. */
export function toDetail(raw: unknown): ListingDetail | null {
  const base = toListing(raw);
  const r = rec(raw);
  if (!base || !r) return null;
  const apply = rec(r.apply);
  return {
    ...base,
    description: str(r.description),
    eligibility: toEligibility(r.eligibility),
    languages: strs(r.languages),
    industries: strs(r.industries),
    functions: strs(r.functions),
    apply: {
      url: str(apply?.url) ?? str(r.applyUrl),
      email: str(apply?.email) ?? str(r.applyEmail),
      platform: str(apply?.platform) ?? str(r.platform),
      instructions: str(apply?.instructions) ?? str(r.instructions),
    },
    estEffortMinutes: num(r.estEffortMinutes),
  };
}

/** The real last change of a listing for the sitemap: updated, else verified, else created. */
export function lastmodOf(l: Pick<PublicListing, "updatedAt" | "verifiedAt" | "createdAt">): string | null {
  const dates = [l.updatedAt, l.verifiedAt, l.createdAt].filter((d): d is string => Boolean(d));
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

/* ---------------------------------------------------------------- timing */

/**
 * The moment a page is rendered. ISR pages render once per regeneration (hourly), and their
 * timing labels ("closing soon", "closed") are computed against this instant.
 */
export function renderTime(): number {
  return Date.now();
}

export function isClosed(l: Pick<PublicListing, "status" | "rolling" | "deadline">, now: number = Date.now()): boolean {
  if (l.status === "expired" || l.status === "rejected") return true;
  if (l.rolling || !l.deadline) return false;
  const t = Date.parse(l.deadline);
  return Number.isFinite(t) && t + DEADLINE_GRACE_MS < now;
}

/** Shown in lists and hubs: public, active, a public SEO type, and not past its deadline. */
export function isListable(l: PublicListing, now: number = Date.now()): boolean {
  return l.isPublic && l.status === "active" && Boolean(opportunityTypeBySlug(l.typeSlug)) && !isClosed(l, now);
}

/** "10 November 2026" (UTC calendar date). */
export function formatDay(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export type TimingTone = "soon" | "open" | "rolling" | "cycle" | "unknown" | "closed";

export interface Timing {
  tone: TimingTone;
  label: string;
  /** ISO deadline when one is known. */
  date: string | null;
}

/** One honest line about when to apply. Unknown dates say so instead of guessing. */
export function timingOf(l: Pick<PublicListing, "status" | "rolling" | "deadline" | "cycle">, now: number = Date.now()): Timing {
  if (isClosed(l, now)) return { tone: "closed", label: l.deadline ? `Closed ${formatDay(l.deadline)}` : "This round has closed", date: l.deadline };
  if (l.deadline) {
    const t = Date.parse(l.deadline);
    const soon = t - now <= SOON_MS;
    return { tone: soon ? "soon" : "open", label: `${soon ? "Closing soon: " : "Apply by "}${formatDay(l.deadline)}`, date: l.deadline };
  }
  if (l.rolling) return { tone: "rolling", label: "Rolling: applications are read as they arrive", date: null };
  if (l.cycle) return { tone: "cycle", label: `Cycle: ${shorten(l.cycle, 90)}`, date: null };
  return { tone: "unknown", label: "Dates not published yet: check the official page", date: null };
}

/** Upcoming deadlines first (soonest first), then rolling, then the rest; better-documented listings first within each. */
export function sortListings<T extends PublicListing>(items: T[], now: number = Date.now()): T[] {
  const rank = (l: T) => (l.deadline && !isClosed(l, now) ? 0 : l.rolling ? 1 : 2);
  return [...items].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const d = Date.parse(a.deadline as string) - Date.parse(b.deadline as string);
      if (d !== 0) return d;
    }
    const q = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    return q !== 0 ? q : a.name.localeCompare(b.name);
  });
}

/* ---------------------------------------------------------------- money and cost lines */

/** Cuts at a word boundary and marks the cut, so text never ends mid-word. */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max * 0.6 ? head.slice(0, cut) : head).replace(/[,;:.\-–]+$/, "")}…`;
}

function money(amount: number, currency: string | null): string {
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
      /* unknown currency code: plain number below */
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
}

const MONEY_KIND: Record<string, string> = {
  salary: "salary",
  stipend: "stipend",
  grant: "grant",
  prize: "in prizes",
  investment: "investment",
  scholarship: "scholarship",
  fee: "fee paid to you",
  other: "",
};
const PERIOD: Record<string, string> = { year: " a year", month: " a month", week: " a week", day: " a day", hour: " an hour", project: " per project", once: "" };

/** "Up to $500,000 investment", "$2,000 a month stipend"; null when the organiser publishes no figure. */
export function moneyLine(m: MoneyInfo | null): string | null {
  if (!m || (m.min === null && m.max === null)) return null;
  const kind = MONEY_KIND[m.kind] ?? "";
  const period = m.period ? (PERIOD[m.period] ?? "") : "";
  let amount: string;
  if (m.min !== null && m.max !== null && m.min !== m.max) amount = `${money(m.min, m.currency)}–${money(m.max, m.currency)}`;
  else if (m.max !== null && m.min === null) amount = `Up to ${money(m.max, m.currency)}`;
  else amount = money((m.max ?? m.min) as number, m.currency);
  return `${amount}${period}${kind ? ` ${kind}` : ""}`.trim();
}

/** The most useful single benefit line for a card. */
export function benefitLine(b: ListingBenefits | null): string | null {
  if (!b) return null;
  return moneyLine(b.money) ?? (b.summary ? shorten(b.summary, 110) : null) ?? (b.perks.length ? b.perks.slice(0, 2).join(" · ") : null);
}

/** What it costs the applicant, from the organiser's own terms. */
export function costLines(c: ListingCost | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.free === true) out.push("Free to apply and take part");
  if (c.applicationFee?.amount) out.push(`Application fee: ${money(c.applicationFee.amount, c.applicationFee.currency)}`);
  else if (c.applicationFee?.amount === 0 && c.free !== true) out.push("No application fee");
  if (c.participationFee?.amount) out.push(`Participation fee: ${money(c.participationFee.amount, c.participationFee.currency)}`);
  if (c.equityPercent !== null) out.push(c.equityPercent === 0 ? "Takes no equity" : `Takes ${c.equityPercent}% equity`);
  if (c.timeCommitment) out.push(`Time: ${c.timeCommitment}`);
  if (c.relocationRequired === true) out.push("Relocation required");
  if (c.notes) out.push(c.notes);
  return out;
}

const DEGREE_LABEL: Record<string, string> = {
  none: "No degree required",
  high_school: "High-school diploma",
  vocational: "Vocational qualification",
  associate: "Associate degree",
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  professional: "Professional degree",
  doctorate: "Doctorate",
};

const GROUP_WORDS: Record<string, string> = {
  S: "students",
  E: "working professionals",
  F: "founders",
  R: "researchers",
  C: "creators and freelancers",
  P: "licensed professionals",
  T: "people in a career transition",
};

/** Plain-language eligibility rules from the structured fields; empty when none are published. */
export function eligibilityLines(e: ListingEligibility | null): string[] {
  if (!e) return [];
  const out: string[] = [];
  const who = e.identities.map((i) => GROUP_WORDS[i] ?? GROUP_WORDS[i.charAt(0)]).filter(Boolean);
  if (who.length) out.push(`Open to ${[...new Set(who)].join(", ")}`);
  if (e.studentsOnly) out.push("Students only");
  if (e.degree && DEGREE_LABEL[e.degree]) out.push(e.degree === "none" ? DEGREE_LABEL.none : `Minimum degree: ${DEGREE_LABEL[e.degree]}`);
  if (e.minYears !== null && e.maxYears !== null) out.push(`${e.minYears}–${e.maxYears} years of experience`);
  else if (e.minYears !== null) out.push(`At least ${e.minYears} year${e.minYears === 1 ? "" : "s"} of experience`);
  else if (e.maxYears !== null) out.push(`At most ${e.maxYears} year${e.maxYears === 1 ? "" : "s"} of experience`);
  if (e.nationality.length) out.push(`Nationality: ${e.nationality.map(countryName).join(", ")}`);
  if (e.residency.length) out.push(`Residence: ${e.residency.map(countryName).join(", ")}`);
  if (e.ageMin !== null && e.ageMax !== null) out.push(`Age ${e.ageMin}–${e.ageMax}`);
  else if (e.ageMax !== null) out.push(`Age ${e.ageMax} or under`);
  else if (e.ageMin !== null) out.push(`Age ${e.ageMin} or over`);
  if (e.companyMaxAgeYears !== null) out.push(`Company founded within the last ${e.companyMaxAgeYears} year${e.companyMaxAgeYears === 1 ? "" : "s"}`);
  if (e.notes) out.push(e.notes);
  return out;
}

/* ---------------------------------------------------------------- tags and event dates */

const EVENT_TAG = /^event:(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/;

/**
 * Real event dates, when the source recorded them as a tag `event:YYYY-MM-DD` or
 * `event:YYYY-MM-DD..YYYY-MM-DD`. A deadline is never used as an event date: without these,
 * a page gets WebPage data instead of Event data.
 */
export function eventDatesOf(tags: string[]): { startDate: string; endDate?: string } | null {
  for (const t of tags) {
    const m = EVENT_TAG.exec(t.trim());
    if (m) {
      if (Number.isNaN(Date.parse(m[1]))) continue;
      if (m[2] && (Number.isNaN(Date.parse(m[2])) || m[2] < m[1])) return { startDate: m[1] };
      return m[2] ? { startDate: m[1], endDate: m[2] } : { startDate: m[1] };
    }
  }
  return null;
}

/** Tags fit to show readers (machine tags like `event:…` and very long ones are hidden). */
export function displayTags(tags: string[], max = 6): string[] {
  return [...new Set(tags.filter((t) => !t.includes(":") && t.length <= 40).map((t) => t.toLowerCase()))].slice(0, max);
}

/* ---------------------------------------------------------------- quality gates */

/** A hub (type or region) is indexed only with enough live listings to be worth a visit. */
export function hubIndexable(liveCount: number): boolean {
  return liveCount >= MIN_INDEX_ITEMS;
}

/** A listing page is indexed while it is public, open and has a summary of its own. */
export function listingIndexable(l: PublicListing, now: number = Date.now()): boolean {
  return l.isPublic && l.status === "active" && !isClosed(l, now) && Boolean(l.summary && l.summary.length >= 40) && Boolean(opportunityTypeBySlug(l.typeSlug));
}

export function orgIndexable(liveCount: number): boolean {
  return liveCount >= ORG_MIN_ITEMS;
}

export interface GuideReadiness {
  ready: boolean;
  missing: string[];
}

/**
 * A program guide exists only for listings with complete data: everything a step-by-step guide
 * states must come from the listing itself (no guessing). Missing pieces are named.
 */
export function guideReadiness(l: ListingDetail, now: number = Date.now()): GuideReadiness {
  const missing: string[] = [];
  if (!l.isPublic || l.status !== "active") missing.push("public and active");
  if (isClosed(l, now)) missing.push("an open round");
  if (!opportunityTypeBySlug(l.typeSlug)) missing.push("a public opportunity type");
  if (!l.summary || l.summary.length < 60) missing.push("a summary");
  if (!l.orgName) missing.push("the organizer");
  if (!(l.apply.url ?? l.url)) missing.push("the official application link");
  if (!l.deadline && !l.rolling && !l.cycle) missing.push("dates or cycle");
  if (!l.requiredMaterials.length) missing.push("required materials");
  if (!eligibilityLines(l.eligibility).length) missing.push("eligibility rules");
  return { ready: missing.length === 0, missing };
}

/** A program guide candidate judged from list data alone (the guide page re-checks the full listing). */
export function cardGuideCandidate(l: PublicListing, now: number = Date.now()): boolean {
  return isListable(l, now) && Boolean(l.summary && l.summary.length >= 60) && Boolean(l.orgName) && Boolean(l.url) && Boolean(l.deadline || l.rolling || l.cycle) && l.requiredMaterials.length > 0;
}

export interface CareerQualityInput {
  /** Opportunity types the role pursues that have at least MIN_INDEX_ITEMS live listings. */
  liveTypeCount: number;
  /** Live listings relevant to this role specifically (industry, function or title match). */
  matchedListings: number;
  /** Related occupations the page links to. */
  relatedCount: number;
}

/**
 * Careers quality rule. Every career page shares the taxonomy-derived sections with others of
 * its identity group, so a page is indexed only when it carries content specific to the role:
 * ≥ 3 live listings matched to the role, ≥ 3 pursued types with live listings, and ≥ 2
 * related roles. Otherwise it still renders for visitors, as noindex.
 */
export function careerQuality(input: CareerQualityInput): { indexable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.matchedListings < MIN_INDEX_ITEMS) reasons.push(`only ${input.matchedListings} live listing(s) match this role`);
  if (input.liveTypeCount < MIN_INDEX_ITEMS) reasons.push(`only ${input.liveTypeCount} opportunity type(s) with live listings`);
  if (input.relatedCount < 2) reasons.push("fewer than 2 related roles");
  return { indexable: reasons.length === 0, reasons };
}

/* ---------------------------------------------------------------- careers */

export interface CareerProfile {
  occupation: OccupationDef;
  /** Identity groups the role belongs to (first = primary). */
  groups: IdentityGroup[];
  /** Representative identity codes used to check goal audiences. */
  codes: IdentityCode[];
  /** Goal families and sub-goals this role typically pursues, with the opportunity types behind them. */
  goals: { family: GoalFamily; label: string; subGoals: { id: SubGoalId; label: string; types: OpportunityTypeId[] }[] }[];
  /** Public SEO types the role pursues, in goal order. */
  publicTypes: OpportunityTypeId[];
  /** Private types (jobs, investors, referrals…) matched inside the app. */
  privateTypes: OpportunityTypeId[];
  /** Materials across those sub-goals, most common first. */
  materials: string[];
  related: OccupationDef[];
}

const DEFAULT_CODE: Partial<Record<IdentityGroup, IdentityCode>> = { E: "E2", R: "R4", C: "C1", P: "P1", F: "F2", S: "S5", T: "T2" };

/** The identity groups a role falls into: its identity hint, else professionals; research and creative work add their group. */
export function careerGroups(occ: OccupationDef): { groups: IdentityGroup[]; codes: IdentityCode[] } {
  const groups: IdentityGroup[] = [];
  const codes: IdentityCode[] = [];
  if (occ.identity && isIdentityCode(occ.identity)) {
    groups.push(groupOfIdentity(occ.identity));
    codes.push(occ.identity);
  } else {
    groups.push("E");
    codes.push("E2");
  }
  const extra: IdentityGroup | null = occ.function === "research" ? "R" : occ.function === "creative" || occ.function === "design" ? "C" : null;
  if (extra && !groups.includes(extra)) {
    groups.push(extra);
    const code = DEFAULT_CODE[extra];
    if (code) codes.push(code);
  }
  return { groups, codes };
}

/** Related roles: same function and industry first, then same function, then same industry. */
export function relatedOccupations(occ: OccupationDef, max = 8): OccupationDef[] {
  const top = topLevelIndustry(occ.industry);
  const score = (o: OccupationDef) => {
    if (o.code === occ.code) return -1;
    const sameFn = o.function === occ.function;
    const sameInd = topLevelIndustry(o.industry) === top;
    const sameSub = o.industry === occ.industry;
    return (sameFn ? 4 : 0) + (sameInd ? 2 : 0) + (sameSub ? 1 : 0);
  };
  return OCCUPATIONS.map((o) => ({ o, s: score(o) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || a.o.label.en.localeCompare(b.o.label.en))
    .slice(0, max)
    .map((x) => x.o);
}

/** Everything a career page derives from the taxonomies (no database). */
export function careerProfile(code: string): CareerProfile | null {
  if (!isOccupationCode(code)) return null;
  const occupation = getOccupation(code);
  const { groups, codes } = careerGroups(occupation);
  const goals: CareerProfile["goals"] = [];
  const publicTypes: OpportunityTypeId[] = [];
  const privateTypes: OpportunityTypeId[] = [];
  const materialCounts = new Map<string, number>();
  for (const family of GOAL_FAMILIES) {
    if (family === "G12") continue;
    if (!groups.some((g) => GOAL_MATRIX[g][family] === "primary")) continue;
    const subs = subGoalsOf(family)
      .filter((s) => s.opportunityTypes.length > 0 && subGoalAppliesTo(s.id, codes))
      .map((s) => ({ id: s.id, label: s.label.en, types: s.opportunityTypes.filter((t) => t !== "practice") }));
    if (!subs.length) continue;
    goals.push({ family, label: getGoalFamily(family).label.en, subGoals: subs });
    for (const s of subs) {
      for (const t of s.types) {
        const def = getOpportunityType(t);
        const bucket = def.publicSeo ? publicTypes : privateTypes;
        if (!bucket.includes(t)) bucket.push(t);
      }
      for (const m of getSubGoal(s.id).materials) materialCounts.set(m, (materialCounts.get(m) ?? 0) + 1);
    }
  }
  const materials = [...materialCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  return { occupation, groups, codes, goals, publicTypes, privateTypes, materials, related: relatedOccupations(occupation) };
}

/** Whole-phrase patterns (English, ≥ 5 characters) that identify a role in an opportunity's text. */
function roleKeywords(occ: OccupationDef): RegExp[] {
  const words = [occ.label.en, ...occ.aliases].map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 5 && /^[\x20-\x7e]+$/.test(w));
  return [...new Set(words)].map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?($|[^a-z0-9])`));
}

interface ListingSignals {
  lower: string;
  occupations: Set<string>;
  /** Industry codes as matched (top level or "top.sub"). */
  industryCodes: Set<string>;
  /** Their top levels. */
  industries: Set<string>;
  functions: Set<string>;
}

const SIGNALS = new Map<string, ListingSignals>();

/** What a listing's text says about roles, industries and functions (computed once per listing text). */
export function listingSignals(l: Pick<PublicListing, "slug" | "name" | "summary" | "tags">): ListingSignals {
  // Name and tags first: the matchers read the start of the text.
  const text = [l.name, ...l.tags, l.summary ?? ""].join(" · ");
  const key = `${l.slug}\u0000${text}`;
  const hit = SIGNALS.get(key);
  if (hit) return hit;
  const industryCodes = new Set(mapIndustry(text, { limit: 4, minScore: 0.6 }).map((m) => m.code));
  const signals: ListingSignals = {
    lower: text.toLowerCase(),
    occupations: new Set(mapOccupation(text, { limit: 3, minScore: 0.7 }).map((m) => m.code)),
    industryCodes,
    industries: new Set([...industryCodes].map((c) => topLevelIndustry(c))),
    functions: new Set(mapFunction(text, { limit: 2, minScore: 0.75 }).map((m) => m.code)),
  };
  if (SIGNALS.size > 5000) SIGNALS.clear();
  SIGNALS.set(key, signals);
  return signals;
}

const KEYWORDS = new Map<string, RegExp[]>();

/**
 * Whether a live listing is relevant to a role, within the types the role pursues. Strong
 * evidence: the listing names the role (title or alias). Otherwise it must name the role's
 * specific field (its second-level industry), or both its industry and its function: a shared
 * broad industry alone ("software", "government") is not enough.
 */
export function listingMatchesRole(l: PublicListing, occ: OccupationDef, pursued: ReadonlySet<string>): boolean {
  if (!pursued.has(l.type)) return false;
  const sig = listingSignals(l);
  let keywords = KEYWORDS.get(occ.code);
  if (!keywords) {
    keywords = roleKeywords(occ);
    KEYWORDS.set(occ.code, keywords);
  }
  if (keywords.some((k) => k.test(sig.lower))) return true;
  if (sig.occupations.has(occ.code)) return true;
  if (occ.industry.includes(".") && sig.industryCodes.has(occ.industry)) return true;
  return sig.industries.has(topLevelIndustry(occ.industry)) && sig.functions.has(occ.function);
}

export function industryName(code: string): string {
  return isIndustryCode(code) ? industryLabel(code, "en") : code;
}

export function functionName(id: string): string {
  return isFunctionId(id) ? functionLabel(id, "en") : id;
}

/** Top-level industry → its occupations (A–Z), for the careers hub. */
export function occupationsByIndustry(): { industry: string; label: string; occupations: OccupationDef[] }[] {
  const map = new Map<string, OccupationDef[]>();
  for (const o of OCCUPATIONS) {
    const top = topLevelIndustry(o.industry);
    map.set(top, [...(map.get(top) ?? []), o]);
  }
  return [...map.entries()]
    .map(([industry, occupations]) => ({
      industry,
      label: getIndustry(industry).label.en,
      occupations: [...occupations].sort((a, b) => a.label.en.localeCompare(b.label.en)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Function → its occupations (A–Z), for the careers hub's second view. */
export function occupationsByFunction(): { fn: string; label: string; occupations: OccupationDef[] }[] {
  const map = new Map<string, OccupationDef[]>();
  for (const o of OCCUPATIONS) map.set(o.function, [...(map.get(o.function) ?? []), o]);
  return [...map.entries()]
    .map(([fn, occupations]) => ({ fn, label: functionName(fn), occupations: [...occupations].sort((a, b) => a.label.en.localeCompare(b.label.en)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ---------------------------------------------------------------- materials */

export interface ChecklistItem {
  id: string;
  label: string;
  producedBy: MaterialProducer | "unknown";
  /** What Onward Scout does about it. */
  note: string;
}

const PRODUCER_NOTE: Record<MaterialProducer | "unknown", string> = {
  platform: "Onward Scout drafts it from your sourced profile; you approve every line.",
  either: "Upload yours, or let Onward Scout draft one from your profile for you to edit.",
  user: "Only you can supply it: upload it once and it is attached wherever it is asked for.",
  unknown: "Check the official page for the exact format.",
};

function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Material ids (from a listing or a type) → a checklist that says who produces each item. */
export function materialChecklist(ids: string[]): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const id of [...new Set(ids)]) {
    if (isMaterialId(id)) {
      const m = getMaterial(id);
      out.push({ id, label: m.label.en, producedBy: m.producedBy, note: PRODUCER_NOTE[m.producedBy] });
    } else {
      out.push({ id, label: humanize(id), producedBy: "unknown", note: PRODUCER_NOTE.unknown });
    }
  }
  return out;
}

/* ================================================================== 2. copy */

export interface QA {
  q: string;
  a: string;
}

export interface TypeCopy {
  /** What these are and who they suit (two sentences). */
  intro: string;
  /** How to win these: three concrete, true tips. */
  win: [string, string, string];
  /** Questions applicants meet, with how to answer them honestly. */
  questions: [QA, QA];
}

/** Hand-written guidance for every public opportunity type. */
export const TYPE_COPY: Record<string, TypeCopy> = {
  graduate_program: {
    intro:
      "Graduate programs hire a whole class of new graduates at once, usually months before the start date, and train them through rotations. They suit final-year students and recent graduates who want structure and a cohort.",
    win: [
      "Apply soon after the program opens: some employers review applications as they arrive and close early once places fill.",
      "Tailor the top of your résumé to the program's stream (finance, engineering, operations) instead of sending one version everywhere.",
      "Prepare for online tests and video interviews before you apply; invitations often arrive within days.",
    ],
    questions: [
      {
        q: "Why this program and this company?",
        a: "Name two things specific to the program, such as a rotation or a training track, and link each to something you have actually done. Praise that fits any employer reads as filler.",
      },
      {
        q: "Describe a time you worked in a team.",
        a: "Pick one real example: the situation in a sentence, what you personally did, and what changed. If the result was modest, say so; interviewers test stories with follow-up questions.",
      },
    ],
  },
  public_sector_exam: {
    intro:
      "Civil service, public institution and state-owned enterprise recruitment runs on published announcements with fixed registration windows, written exams, interviews and background checks. Eligibility rules on degree, major, age and residence are strict and checked against documents.",
    win: [
      "Read the eligibility table for each post line by line before registering: ineligible candidates are often removed only after the exam.",
      "Register early in the window; some systems show how many people have applied for each post, which helps you avoid the most crowded ones.",
      "Keep scans of your ID, degree certificate and transcripts ready, because document review can come at short notice.",
    ],
    questions: [
      {
        q: "Why do you want to work in the public sector?",
        a: "Tie it to the duties of this post and a real experience, such as an internship or community project. Answers about stability alone are heard every day.",
      },
      {
        q: "Does my major match the post's requirement?",
        a: "Check the official major catalogue the announcement cites. If your degree title differs, ask the recruiting unit before registering and keep their reply.",
      },
    ],
  },
  returnship: {
    intro:
      "Returnships are paid, fixed-term programs for people coming back after a career break for caregiving, health or relocation. They usually include training and a mentor, and many lead to a permanent offer.",
    win: [
      "Explain the break in one honest line and move on; returnship reviewers expect gaps and don't need them justified.",
      "Show how you kept current, such as a course, volunteering, freelance work or a certification, with dates.",
      "Name the role you want to return to and the skills from before the break that carry over directly.",
    ],
    questions: [
      {
        q: "Tell us about your career break.",
        a: "One or two sentences on what it was. You don't have to share health or family details; “I was caring for a family member” is enough.",
      },
      {
        q: "Which skills do you need to refresh?",
        a: "Be specific and say how you are refreshing them already. Naming one real gap is more credible than claiming none.",
      },
    ],
  },
  volunteer: {
    intro:
      "Volunteer programs place people with nonprofits, events and humanitarian organisations, from a few hours a week to a year abroad. Coordinators select on reliability, relevant skills and availability more than on credentials.",
    win: [
      "State your availability precisely (days, hours, start date, duration); it is usually the first thing coordinators filter on.",
      "Connect one past experience to the cause or the task, even an informal one.",
      "Check costs before applying: some international placements charge a program fee, and the official page should say what it covers.",
    ],
    questions: [
      { q: "Why this cause?", a: "A real reason in two or three sentences. A personal connection is fine; you don't need a dramatic story." },
      { q: "What can you offer?", a: "Concrete skills (languages, first aid, teaching, logistics, design) and the hours you can genuinely commit." },
    ],
  },
  accelerator: {
    intro:
      "Accelerators run fixed-length cohorts that offer funding, mentorship and a demo day, usually in exchange for equity. Reviewers read many applications per batch, so clarity about the problem, the team and progress so far decides most of them.",
    win: [
      "Say what the company does in one plain sentence at the top; if a reviewer can't repeat it, the rest is read less closely.",
      "Show progress with numbers you can verify (users, revenue, pilots, retention) and when they changed.",
      "Check the terms first: the equity taken, the amount invested and any relocation requirement are on the program's own page.",
    ],
    questions: [
      {
        q: "Describe what your company does in one sentence.",
        a: "Who it is for and what it does for them, without adjectives. “Payroll software for restaurants with under 50 staff” beats “a revolutionary platform”.",
      },
      {
        q: "Why now, and why your team?",
        a: "Point to something that changed (a regulation, a technology, a cost) and to what each founder has done that fits the problem. Don't claim expertise you can't show.",
      },
    ],
  },
  incubator: {
    intro:
      "Incubators support early-stage companies with workspace, services and advice, often without taking equity; many are run by universities or public agencies. They look for a credible team and a clear plan more than for traction.",
    win: [
      "Check who the incubator serves (a university's students, a city's residents, a sector) and confirm you fit before writing anything.",
      "Describe the next six months concretely: what you will build, test or sell, and what you need from the incubator to do it.",
      "Have a short business plan or one-pager ready; many incubators ask for one and use it in the interview.",
    ],
    questions: [
      { q: "What support do you need from us?", a: "Two or three specific things, such as lab space, legal help or introductions in a sector, rather than “everything”." },
      { q: "What is your business model?", a: "Who pays, how much and how often, as you understand it today. It is fine to say what you are still testing." },
    ],
  },
  startup_competition: {
    intro:
      "Startup competitions award prizes, investment and exposure through rounds of written applications and live pitches. Judges score against published criteria, so the scoring rubric is the best guide to what to write.",
    win: [
      "Find the judging criteria on the official page and answer each one explicitly, in the order listed.",
      "Make a deck that works without you speaking: early rounds are often judged from the deck alone.",
      "Check eligibility early; limits on company age, revenue, nationality or university affiliation are common and strictly applied.",
    ],
    questions: [
      { q: "What problem are you solving, and for whom?", a: "One specific customer and what the problem costs them, ideally from conversations you have had. Say how you know." },
      { q: "How will you use the prize?", a: "A short plan with amounts that fit the prize. Judges notice when the plan isn't tied to the money on offer." },
    ],
  },
  pitch_event: {
    intro:
      "Pitch events and demo days put founders in front of investors for a few minutes each. Selection is usually by a short application, and the real value is in the conversations afterwards.",
    win: [
      "Apply with a deck and a crisp one-pager; organisers choose companies that fit their investor audience.",
      "Rehearse a pitch that fits the exact slot length and ends with one specific ask.",
      "Plan the follow-up before the event: who you want to meet and what you will send them the next day.",
    ],
    questions: [
      { q: "What stage are you at, and what are you raising?", a: "Stage, amount and what it funds, in one line. If you are not raising yet, say what you want from the event instead." },
      { q: "Why should this audience hear you?", a: "Match your sector and stage to the investors the organiser lists, without stretching the fit." },
    ],
  },
  exhibition: {
    intro:
      "Trade shows and expos let companies exhibit, pitch, speak or meet buyers in one place. Startup zones, pitch stages and subsidised country pavilions often have an application of their own, separate from regular stand sales.",
    win: [
      "Look for startup pavilions, sponsored country stands and pitch stages: they usually cost less than a standard stand.",
      "Book meetings with buyers before the show; their calendars fill weeks ahead.",
      "Prepare your company profile and product images in the organiser's format; they go into the catalogue and the event app.",
    ],
    questions: [
      { q: "What will you show, and to whom?", a: "Name the product and the buyer types you want to meet; organisers use this to place you." },
      { q: "Are you ready to sell into this market?", a: "Say honestly which markets you can ship to today and which certifications you hold." },
    ],
  },
  cofounder_match: {
    intro:
      "Co-founder matching programs and platforms introduce founders to potential partners, sometimes through structured trial projects. What you write in your profile decides who reaches out.",
    win: [
      "Lead with what you have built or done, not only what you are looking for.",
      "Be specific about the role you need filled and what you will own yourself.",
      "State your commitment level and location honestly; mismatches there end most conversations.",
    ],
    questions: [
      { q: "What are you looking for in a co-founder?", a: "Skills, commitment and working style, in that order. A list of personality traits alone says little." },
      { q: "What are you working on?", a: "Share the idea plainly; if you are open to other ideas, say so." },
    ],
  },
  loan: {
    intro:
      "Small-business loans and guaranteed credit programs fund working capital and equipment, often backed by a public guarantee. Lenders decide on documents: financial statements, tax filings and a clear use of funds.",
    win: [
      "Gather every document the lender lists before you start; incomplete files are a common cause of delay.",
      "Write a one-page use-of-funds summary that ties the amount to specific costs.",
      "Compare the guarantee program's published terms with the lender's own offer.",
    ],
    questions: [
      { q: "How will you repay the loan?", a: "Point to current cash flow or signed contracts. Projections are fine if they are labelled as projections." },
      { q: "What is the loan for?", a: "Items and amounts. Round, unexplained numbers invite more questions." },
    ],
  },
  government_program: {
    intro:
      "Government programs fund, certify or subsidise companies and individuals: innovation grants, talent schemes, tax-credit certifications and local startup support. Applications follow official templates and are checked against strict eligibility and document rules.",
    win: [
      "Use the official template and guidelines exactly; reviewers check format and attachments before reading the content.",
      "Confirm eligibility by registered location, company age, sector and size before preparing anything.",
      "Start early on documents that take time, such as tax certificates, audited accounts and registration extracts.",
    ],
    questions: [
      { q: "What will the support achieve?", a: "Concrete outputs with dates (a prototype, hires, a certification) that match the program's stated goals." },
      { q: "Do you meet every condition?", a: "Answer each condition with the document that proves it. If one is borderline, ask the program office before applying." },
    ],
  },
  grant: {
    intro:
      "Grants fund research, creative and community projects without taking ownership. Funders score proposals against published criteria such as significance, approach, feasibility and fit with their mission, and they read the budget as closely as the narrative.",
    win: [
      "Read the funder's priorities and scoring criteria first, and use their terms in your section headings.",
      "Make the budget match the work plan line by line; unexplained costs lower feasibility scores.",
      "When the call invites it, contact the program officer; a short question about fit can save a full application.",
    ],
    questions: [
      { q: "What is the need or problem?", a: "Evidence first: sourced data or what you have observed directly. Leave out claims you cannot support." },
      { q: "How will you measure success?", a: "Two or three measurable outputs and how you will collect the evidence. Don't promise outcomes the project can't control." },
    ],
  },
  fellowship: {
    intro:
      "Fellowships fund people rather than projects: time, money and a network for someone with a track record and a clear plan. Selection leans heavily on the personal statement and the references.",
    win: [
      "Build the statement around one plan for the fellowship period and the evidence that you will carry it out.",
      "Ask referees early and send them your statement and the selection criteria, so their letters address the same points.",
      "Check the eligibility window (years since degree, nationality, field) before investing time.",
    ],
    questions: [
      { q: "What will you do during the fellowship?", a: "A specific plan with milestones, tied to what the fellowship provides." },
      { q: "What is your long-term goal?", a: "Honest and specific. It's fine if it is still forming, as long as the next step is clear." },
    ],
  },
  scholarship: {
    intro:
      "Scholarships pay for study, from a single tuition payment to a fully funded degree. They are awarded on merit, need, field or background, and each publishes its own eligibility rules and documents.",
    win: [
      "Shortlist only scholarships you clearly qualify for; mismatched applications are often rejected unread.",
      "Reuse a strong core statement, but rewrite the opening and closing for each funder's stated purpose.",
      "Order transcripts and request references early; they are the slowest documents to arrive.",
    ],
    questions: [
      { q: "Why should you receive this scholarship?", a: "Show what you have done with what you had, and what the funding makes possible next. Facts and dates, not adjectives." },
      { q: "Describe your financial need.", a: "Accurate and brief. Exaggerated need can be checked and can disqualify you." },
    ],
  },
  award: {
    intro:
      "Industry awards and lists, including “30 under 30” style lists, recognise people and companies through nominations judged by a panel. A strong nomination proves impact with specifics.",
    win: [
      "Quantify impact where you can verify it (users, revenue, publications, people served) and say how you know.",
      "Line up a nominator or endorser early if the award requires one.",
      "Choose the category carefully; strong entries lose when they are filed under the wrong one.",
    ],
    questions: [
      { q: "What has the nominee achieved recently?", a: "Three concrete achievements with dates and evidence links. Leave out anything you cannot document." },
      { q: "Why does it matter for the field?", a: "One or two sentences on who benefited and how, in plain words." },
    ],
  },
  competition: {
    intro:
      "Prize competitions in coding, design, writing, science and more judge entries against published rules. The rules page, covering format, length, originality and rights, is the most important document.",
    win: [
      "Read the rights clause before you start; some competitions take a licence to submitted work.",
      "Follow the format exactly (word count, file type, naming); entries outside it are often disqualified.",
      "Submit a day early, because upload systems slow down near the deadline.",
    ],
    questions: [
      { q: "Describe your entry.", a: "What it is, what it does and what is original about it, in the competition's own terms." },
      { q: "Is the work original and your own?", a: "Answer truthfully and declare any tools, collaborators or prior publication the rules ask about." },
    ],
  },
  hackathon: {
    intro:
      "Hackathons are short build events, online or in person, with prizes from organisers and sponsors. In-person places are often allocated by a short application, and judging rewards a working demo with a clear explanation.",
    win: [
      "Apply with links to things you have built; organisers want people who will ship something.",
      "Read the tracks and sponsor prizes in advance and pick one problem to aim for.",
      "Plan the demo: a short video and a clear readme often matter as much as the code.",
    ],
    questions: [
      { q: "What have you built before?", a: "Two or three links with a sentence each on your part in them." },
      { q: "Do you have a team?", a: "Say so either way; many events help solo participants find a team." },
    ],
  },
  conference_cfp: {
    intro:
      "Conference calls for papers set a format, a page limit and fixed dates, often with abstract registration shortly before the full-paper deadline. Submissions go through systems such as OpenReview, EasyChair or CMT, and many venues review double-blind.",
    win: [
      "Read the call for scope, page limit, template and anonymity rules before writing; format violations lead to desk rejection.",
      "Create your submission-system account and co-author profiles early; some systems take days to approve new accounts.",
      "Put every date in your calendar: abstract registration, full paper, supplementary material and rebuttal.",
    ],
    questions: [
      { q: "What is the paper's contribution?", a: "State it in one or two sentences in the abstract and introduction, and make sure the experiments support exactly that claim." },
      { q: "Is the submission properly anonymous?", a: "For double-blind venues, remove names, acknowledgements and identifying links, and cite your own work in the third person." },
    ],
  },
  journal: {
    intro:
      "Journals and special issues accept submissions year-round or until a call closes. Editors screen for scope and quality before peer review, so the cover letter and abstract decide whether a paper is sent out.",
    win: [
      "Check the aims and scope and recent issues; out-of-scope papers are returned without review.",
      "Follow the author guidelines for structure, references and data availability.",
      "Write a cover letter that states the contribution and why it fits this journal in a few sentences.",
    ],
    questions: [
      { q: "Why is this paper right for the journal?", a: "Connect the contribution to the journal's scope and to work it has published, without overstating novelty." },
      { q: "Has this work been submitted elsewhere?", a: "Answer accurately. Simultaneous submission is usually prohibited; whether preprints are allowed is in the guidelines." },
    ],
  },
  visiting_scholar: {
    intro:
      "Visiting scholar programs host researchers at a university or institute for a term or a year, sometimes with funding. Applications usually need a research proposal, a CV and a host who agrees to sponsor the visit.",
    win: [
      "Write to a potential host early with a short, specific note on shared research interests; many programs require their agreement.",
      "Propose a realistic plan for the visit's length and what you will produce.",
      "Check visa and funding rules; some programs ask for proof of funding for the whole stay.",
    ],
    questions: [
      { q: "What will you work on during the visit?", a: "A focused project that uses something specific about the host institution." },
      { q: "How is the visit funded?", a: "List your funding sources accurately; if you need the program's funding, say so." },
    ],
  },
  degree_program: {
    intro:
      "Degree programs at bachelor's, master's and doctoral level admit students through online portals with statements, transcripts, test scores and references. Each program weighs these differently, and deadlines often come in rounds.",
    win: [
      "Build your list around curriculum and faculty that match what you want to study, and note each program's round deadlines.",
      "Write a statement of purpose for each program that names specific courses, labs or faculty.",
      "Request transcripts, score reports and references well ahead; they depend on other people's timelines.",
    ],
    questions: [
      { q: "Why this program?", a: "Two or three specifics (a course, a lab, a professor's work) linked to your experience and plans." },
      { q: "Describe your academic background.", a: "Highlight relevant courses, projects and results. A weak semester needs one honest line of context at most." },
    ],
  },
  exchange_program: {
    intro:
      "Exchange semesters, summer schools and summer camps offer a short period of study at another institution, at home or abroad. Many run through your home university; others accept direct applications.",
    win: [
      "Check whether you must apply through your university's international office; many exchanges need a nomination.",
      "Confirm credit transfer with your department before you go.",
      "Look for funding attached to the program; some summer schools waive fees for selected participants.",
    ],
    questions: [
      { q: "Why do you want to take part?", a: "Name the courses or experience you can't get at home and how they fit your studies." },
      { q: "How will you fund your stay?", a: "List real sources. If you are applying for the program's own funding, say so." },
    ],
  },
  standardized_test: {
    intro:
      "Language and admissions tests such as IELTS, TOEFL, GRE and GMAT have fixed test dates, registration deadlines and limited seats per centre. Planning back from your application deadlines avoids late fees and missed score reports.",
    win: [
      "Work back from your earliest application deadline, leaving time for results and one retake.",
      "Register early for popular centres and dates; seats can run out.",
      "Check how each program wants scores reported and how long official reports take to arrive.",
    ],
    questions: [
      { q: "Which test do my programs accept?", a: "Check each program's admissions page; accepted tests and minimum scores vary." },
      { q: "When should I take it?", a: "Early enough to retake once before your first deadline." },
    ],
  },
  course: {
    intro:
      "Courses and bootcamps teach specific skills over weeks or months; some offer scholarships, funded seats or employer sponsorship. Admission may include a short test or interview.",
    win: [
      "Look for funded seats and sponsorship, and read their conditions carefully.",
      "Prepare for any entry assessment; some bootcamps test basic aptitude before admitting you.",
      "Ask how outcomes are measured; a reputable program explains its method.",
    ],
    questions: [
      { q: "Why do you want to learn this now?", a: "A concrete goal (a role, a project, a promotion) and how the course gets you there." },
      { q: "How much time can you commit?", a: "Real hours per week. Programs ask because people who underestimate it tend to drop out." },
    ],
  },
  certification: {
    intro:
      "Professional certifications such as PMP, CFA, AWS and CPA are exams with eligibility rules, registration windows and fees. Some require documented experience or education hours before you can sit the exam.",
    win: [
      "Check prerequisites (experience hours, education, membership) on the certifying body's own site before registering.",
      "Book the exam date first, then plan your study back from it.",
      "Keep records of your experience in the body's format; applications can be audited.",
    ],
    questions: [
      { q: "Do I meet the experience requirement?", a: "Count only experience that matches the body's definition, and keep evidence of role, dates and duties." },
      { q: "How should I describe my experience?", a: "In the body's own terms with real projects; audited applications are checked with your references." },
    ],
  },
  mentorship: {
    intro:
      "Mentorship programs pair people with mentors, or mentees, for a set period, often within a sector, a university or a professional body. Clear goals lead to better matches.",
    win: [
      "State two or three goals for the mentorship; matching is based on them.",
      "Describe the kind of mentor who would help (industry, stage, skill).",
      "Commit to the schedule; programs value participants who show up.",
    ],
    questions: [
      { q: "What do you want from a mentor?", a: "Specific outcomes, such as feedback on a career move, a skill, or an introduction to a field." },
      { q: "What can you offer as a mentor?", a: "Experience you can actually share, and the time you can realistically give." },
    ],
  },
  residency: {
    intro:
      "Residencies give artists, writers and makers time and space to work, sometimes with a stipend, housing or materials. Panels select on the work sample and a clear project proposal.",
    win: [
      "Choose work samples that relate to the project you propose; panels look for continuity.",
      "Explain what you will do during the residency and why it needs this place.",
      "Check costs and what is provided: some residencies charge fees, others pay stipends.",
    ],
    questions: [
      { q: "What will you work on?", a: "A concrete project with a plan that fits the residency's length." },
      { q: "Why this residency?", a: "Something specific about the place, its facilities or its community that your work needs." },
    ],
  },
  open_call: {
    intro:
      "Open calls invite submissions for exhibitions, anthologies, festivals and showcases. Each call sets its own theme, format, rights terms and sometimes an entry fee.",
    win: [
      "Submit only work that fits the theme; panels sort quickly.",
      "Check the entry fee, the rights you grant and the selection process before submitting.",
      "Follow the file and image specifications exactly; files outside them may be excluded.",
    ],
    questions: [
      { q: "Describe the work.", a: "Title, medium, dimensions or length, and a short statement about what it does." },
      { q: "How does it relate to the theme?", a: "One or two sentences that connect the work to the call without stretching." },
    ],
  },
  brand_partnership: {
    intro:
      "Brand partnerships pay creators for content, ambassadorships or product collaborations. Brands look at audience fit, engagement and how well you present their category.",
    win: [
      "Pitch brands whose products you use or would; it shows in the content.",
      "Keep a current media kit with audience numbers from your platforms' own analytics, dated.",
      "Propose one specific idea rather than general availability.",
    ],
    questions: [
      { q: "Who is your audience?", a: "Platform-reported numbers with dates, and the demographics that matter to this brand." },
      { q: "What would you create for us?", a: "One concrete concept, its format and a timeline." },
    ],
  },
  platform_signing: {
    intro:
      "Creator platforms, agencies, MCNs and publishers sign talent for representation, distribution or publishing deals. Terms vary widely, so the contract matters as much as being accepted.",
    win: [
      "Read the terms (exclusivity, revenue share, length) before applying, and ask for them if they aren't public.",
      "Show consistent output and growth, with dates.",
      "Present a clear niche; generalist profiles are harder to place.",
    ],
    questions: [
      { q: "What do you make, and how often?", a: "Format, frequency and links to your strongest pieces." },
      { q: "What do you want from representation?", a: "Specific help, such as brand deals, distribution or editing, rather than general growth." },
    ],
  },
  licensing: {
    intro:
      "Stock libraries and licensing marketplaces accept contributors' photos, footage, music, illustrations and fonts and pay per licence. Acceptance depends on technical quality, releases and their content standards.",
    win: [
      "Read the technical and content guidelines; first submissions are often reviewed strictly.",
      "Have model and property releases ready wherever people or private property appear.",
      "Start with a small, strong batch and learn from any rejections.",
    ],
    questions: [
      { q: "Do you hold all rights to this work?", a: "Submit only work you created and can license, and disclose AI tools where the marketplace requires it." },
      { q: "What subjects do you cover?", a: "Your niche and the kind of buyer it serves." },
    ],
  },
  speaking: {
    intro:
      "Speaking slots at conferences, TEDx events, meetups and panels are filled through calls for speakers or proposals. Organisers choose talks that teach their audience something specific.",
    win: [
      "Pitch one idea with a clear takeaway for that event's audience.",
      "Write a title and abstract that say what attendees will learn; vague titles get passed over.",
      "Add a short bio and a link to a past talk or a writing sample if you have one.",
    ],
    questions: [
      { q: "What will attendees learn?", a: "Two or three concrete takeaways, phrased as what they will be able to do." },
      { q: "Have you spoken before?", a: "List real talks with links. If this would be your first, say so and link writing that shows how you explain things." },
    ],
  },
  media: {
    intro:
      "Publications accept op-eds, columns and guest articles through pitches to editors. Editors look for a timely, specific argument from someone with standing to make it.",
    win: [
      "Read the outlet's submission guidelines and recent pieces, and pitch something it hasn't run.",
      "Lead with your argument in one sentence and why it matters now.",
      "Keep the pitch short and say why you are the person to write it.",
    ],
    questions: [
      { q: "What is your argument?", a: "One clear claim and the evidence you will use." },
      { q: "Why are you the right author?", a: "Your direct experience or expertise, stated plainly." },
    ],
  },
  community: {
    intro:
      "Professional associations, alumni networks and chambers of commerce offer membership, events and directories, and sometimes their own awards and grants. Some membership levels require credentials or a sponsor.",
    win: [
      "Compare membership categories and their requirements; student and early-career rates often exist.",
      "Join a committee or volunteer role; that is where the network is built.",
      "Use member directories for considered introductions, never bulk messages.",
    ],
    questions: [
      { q: "Which membership level fits?", a: "The one whose requirements you meet today; most bodies let you move up later." },
      { q: "What will you contribute?", a: "A skill or time you can actually give." },
    ],
  },
  event: {
    intro:
      "Industry events and summits offer talks, networking and exhibitions, and many have free passes, sponsored tickets or volunteer places for students, founders and early-career professionals.",
    win: [
      "Look for scholarship, diversity and volunteer tickets; they often close well before general sales.",
      "Decide in advance which sessions and people matter to you.",
      "Follow up within a few days with the people you met.",
    ],
    questions: [
      { q: "Why do you want to attend?", a: "Name sessions or people relevant to your work and what you will do with what you learn." },
      { q: "Do you need financial support?", a: "Answer accurately; sponsored tickets are meant for people who could not otherwise attend." },
    ],
  },
  visa_pathway: {
    intro:
      "Work and talent visa routes, such as the US O-1 and H-1B or the UK Global Talent visa, each set their own evidence standards. Assembling evidence of your achievements takes far longer than filling in the form.",
    win: [
      "Read the criteria on the government's own website and map each one to evidence you hold today.",
      "Start collecting evidence early: letters, press coverage, awards, salary records and publications take time to gather.",
      "Work with a qualified immigration lawyer or adviser where the route requires or recommends it; Onward Scout organises evidence but does not give legal advice.",
    ],
    questions: [
      { q: "Which criteria do I meet?", a: "Claim only the criteria you can document; weak claims can undermine strong ones." },
      { q: "Who should write support letters?", a: "People who know your work directly and can describe it specifically. Generic praise carries little weight." },
    ],
  },
};

/** The type's copy, with a neutral fallback built from the taxonomy for any type without one. */
export function typeCopy(type: OpportunityTypeId): TypeCopy {
  const own = TYPE_COPY[type];
  if (own) return own;
  const def = getOpportunityType(type);
  return {
    intro: def.description.en,
    win: [
      "Read the official page in full and confirm you meet every eligibility rule before you start.",
      "Answer each question in the organiser's own terms, with facts you can show.",
      "Submit before the last day and keep the confirmation.",
    ],
    questions: [
      { q: "Why are you applying?", a: "A specific reason tied to what the opportunity offers and what you have done so far." },
      { q: "What have you done that is relevant?", a: "Two or three concrete examples with dates and links." },
    ],
  };
}

/* ---------------------------------------------------------------- timelines */

export interface TimelineStep {
  /** Days before the deadline this step should be done by (0 = deadline day). */
  daysBefore: number;
  title: string;
  text: string;
}

const TIMELINE_DEFAULT: TimelineStep[] = [
  { daysBefore: 28, title: "Check fit and list the materials", text: "Read the official page, confirm every eligibility rule and list what the application asks for." },
  { daysBefore: 21, title: "Draft the answers and documents", text: "Draft each written answer and document from what you already have, citing real facts only." },
  { daysBefore: 7, title: "Review against the criteria", text: "Reread every answer against the published criteria, fill the gaps and check every upload." },
  { daysBefore: 2, title: "Submit and keep the confirmation", text: "Submit before the last day; portals slow down near deadlines. Save the confirmation." },
];

const TIMELINE_REFERENCES: TimelineStep[] = [
  { daysBefore: 42, title: "Ask referees and order documents", text: "Ask your referees, and order transcripts or score reports; these depend on other people's timelines." },
  { daysBefore: 28, title: "Draft the statement", text: "Draft the statement around one clear plan, with evidence from your record." },
  { daysBefore: 10, title: "Review and remind", text: "Review against the selection criteria; gently remind referees of the date." },
  { daysBefore: 2, title: "Submit and keep the confirmation", text: "Submit early and check that every reference shows as received." },
];

const TIMELINE_ACADEMIC: TimelineStep[] = [
  { daysBefore: 56, title: "Read the call and set up accounts", text: "Check scope, page limit, template and anonymity rules; create submission-system profiles for every author." },
  { daysBefore: 14, title: "Register the abstract", text: "Where the call has an abstract deadline, register title, abstract and authors before it." },
  { daysBefore: 5, title: "Final checks", text: "Check format, anonymity, references and supplementary material against the call." },
  { daysBefore: 1, title: "Submit", text: "Upload the final version a day early and keep the submission number." },
];

const TIMELINE_VENTURE: TimelineStep[] = [
  { daysBefore: 21, title: "Update deck and numbers", text: "Refresh the deck, key metrics and the one-sentence description of the company." },
  { daysBefore: 14, title: "Draft the answers", text: "Answer every question plainly, with numbers you can verify." },
  { daysBefore: 7, title: "Record and review", text: "Record the video if one is asked for, and have someone outside the team read the answers." },
  { daysBefore: 2, title: "Submit", text: "Submit early; some programs review applications as they arrive." },
];

const TIMELINE_CREATIVE: TimelineStep[] = [
  { daysBefore: 28, title: "Choose the work", text: "Select samples that fit the call's theme and the project you will propose." },
  { daysBefore: 21, title: "Write the statement", text: "Write the artist statement or project proposal for this call specifically." },
  { daysBefore: 7, title: "Prepare the files", text: "Export files to the exact specifications and check rights and releases." },
  { daysBefore: 2, title: "Submit", text: "Submit early and keep the confirmation and any receipt for the fee." },
];

const TIMELINE_MOBILITY: TimelineStep[] = [
  { daysBefore: 90, title: "Map criteria to evidence", text: "List each official criterion and the evidence you hold for it today." },
  { daysBefore: 60, title: "Request letters and records", text: "Ask for support letters, employment records and translations." },
  { daysBefore: 21, title: "Assemble the file", text: "Organise evidence by criterion and review it with your lawyer or adviser." },
  { daysBefore: 3, title: "File", text: "File through the official system and keep every receipt." },
];

const REFERENCE_TYPES = new Set<string>(["fellowship", "scholarship", "degree_program", "visiting_scholar", "award", "exchange_program"]);

/** Generic preparation steps for a type, counted back from its deadline. */
export function timelineFor(type: OpportunityTypeId): TimelineStep[] {
  if (REFERENCE_TYPES.has(type)) return TIMELINE_REFERENCES;
  const group: OpportunityGroup = getOpportunityType(type).group;
  if (group === "academic") return TIMELINE_ACADEMIC;
  if (group === "venture") return TIMELINE_VENTURE;
  if (group === "creative") return TIMELINE_CREATIVE;
  if (group === "mobility") return TIMELINE_MOBILITY;
  return TIMELINE_DEFAULT;
}

export interface DatedStep extends TimelineStep {
  /** ISO date to finish by, when the deadline is known and the date is still ahead. */
  by: string | null;
}

/** Puts real dates on a timeline from a known deadline; past dates and unknown deadlines get none. */
export function datedTimeline(steps: TimelineStep[], deadline: string | null, now: number = Date.now()): DatedStep[] {
  const d = deadline ? Date.parse(deadline) : NaN;
  return steps.map((s) => {
    if (!Number.isFinite(d)) return { ...s, by: null };
    const by = d - s.daysBefore * 24 * 60 * 60 * 1000;
    return { ...s, by: by > now ? new Date(by).toISOString() : null };
  });
}

/* ---------------------------------------------------------------- how Onward Scout helps */

/** What Onward Scout does for an application on each channel. Honest about what stays with the person. */
export const CHANNEL_HELP: Record<ChannelId, string> = {
  CH1: "Onward Scout reads the posting's own questions, tailors your résumé and answers from your sourced profile, and submits after your tap. If the form needs a login or a CAPTCHA, it hands it to you ready to paste.",
  CH2: "Onward Scout maps the official form field by field, fills it from your sourced profile and drafts the written answers; you review and tap to submit. If the form stops at a CAPTCHA, a login or a payment, you get a 30-second handoff with everything ready.",
  CH3: "Onward Scout fills the official form in a browser on your behalf after your tap, taking a screenshot at every step. CAPTCHAs, logins and payments stay with you, as a 30-second handoff.",
  CH4: "Onward Scout drafts a personal email for each contact, sent from your own Gmail one recipient at a time, and reminds you when to follow up. Nothing is sent without your tap.",
  CH5: "Onward Scout prepares the document set (statements, checklists, summaries) from your sourced profile, ready to download as PDF or Word.",
  CH6: "This one is submitted on the organiser's own site, behind your login. Onward Scout prepares every answer and file in the form's order with one-tap copy, so submitting takes minutes; you mark it submitted when you're done.",
  CH7: "Onward Scout submits through the organiser's partner connection after your tap.",
};

/** The channel a listing is applied through: its own, else its type's default. */
export function channelOf(l: Pick<PublicListing, "channel" | "type">): ChannelId {
  return l.channel ?? getOpportunityType(l.type).defaultChannel;
}

/** One paragraph on how Onward Scout handles this application, including what stays with the person. */
export function scoutHelpFor(l: Pick<PublicListing, "channel" | "type" | "requiresAccount" | "requiresPayment">): string {
  const ch = channelOf(l);
  const parts = [CHANNEL_HELP[ch]];
  if (ch !== "CH6" && l.requiresAccount) parts.push("The organiser requires an account, so the final step happens in your own login.");
  if (l.requiresPayment) parts.push("There is a fee to pay to the organiser; payment always stays with you.");
  return parts.join(" ");
}

/* ---------------------------------------------------------------- guides */

export interface GuideStep {
  name: string;
  text: string;
}

export interface ProgramGuide {
  title: string;
  description: string;
  facts: { label: string; value: string }[];
  eligibility: string[];
  checklist: ChecklistItem[];
  timeline: DatedStep[];
  questions: QA[];
  win: string[];
  steps: GuideStep[];
  help: string;
}

/** A step-by-step guide built only from the listing's own data and its type's playbook. */
export function buildProgramGuide(l: ListingDetail, now: number = Date.now()): ProgramGuide {
  const copy = typeCopy(l.type);
  const timing = timingOf(l, now);
  const eligibility = eligibilityLines(l.eligibility);
  const checklist = materialChecklist(l.requiredMaterials.length ? l.requiredMaterials : getOpportunityType(l.type).materials);
  const officialUrl = l.apply.url ?? l.url;
  const facts: { label: string; value: string }[] = [];
  if (l.orgName) facts.push({ label: "Organizer", value: l.orgName });
  facts.push({ label: "Timing", value: timing.label });
  if (l.cycle && timing.tone !== "cycle") facts.push({ label: "Cycle", value: l.cycle });
  const place = placeLine(l.geo);
  if (place) facts.push({ label: "Where", value: place });
  const benefit = benefitLine(l.benefits);
  if (benefit) facts.push({ label: "What you get", value: benefit });
  for (const c of costLines(l.cost)) facts.push({ label: "Cost", value: c });
  if (l.apply.platform) facts.push({ label: "Applied through", value: humanize(l.apply.platform) });
  if (l.requiresAccount) facts.push({ label: "Account", value: "You need an account on the application system" });

  const steps: GuideStep[] = [
    {
      name: "Check that you are eligible",
      text: eligibility.length
        ? `The published rules: ${eligibility.map((e) => e.replace(/[.;\s]+$/, "")).join("; ")}.`
        : "Read the eligibility section of the official page before preparing anything.",
    },
    { name: "Gather the materials", text: `You will need: ${checklist.map((c) => c.label).join(", ")}.` },
    { name: "Write the answers", text: copy.win[0] },
    {
      name: "Submit on the official page",
      text: `${officialUrl ? "Apply through the official page" : "Apply as the organiser describes"}${l.apply.platform ? ` (${humanize(l.apply.platform)})` : ""}${
        timing.date && timing.tone !== "closed" ? ` before ${formatDay(timing.date)}` : ""
      }, and keep the confirmation.`,
    },
    { name: "Follow up", text: "Note when results are due. If the organiser invites questions, ask once, briefly, after the date has passed." },
  ];

  return {
    title: `How to apply to ${l.name}`,
    description: shorten(
      `A step-by-step guide to applying to ${l.name}${l.orgName ? ` by ${l.orgName}` : ""}: eligibility, materials checklist, timeline and how to answer the common questions honestly.`,
      200,
    ),
    facts,
    eligibility,
    checklist,
    timeline: datedTimeline(timelineFor(l.type), timing.tone === "closed" ? null : l.deadline, now),
    questions: copy.questions,
    win: copy.win,
    steps,
    help: scoutHelpFor(l),
  };
}

/** Title and description of a type playbook (/guides/how-to-apply-for-<type>). */
export function playbookMeta(def: OpportunityTypeDef): { title: string; description: string } {
  const plural = def.plural.en;
  return {
    title: `How to apply for ${plural.toLowerCase()}`,
    description: shorten(`A practical playbook for ${plural.toLowerCase()}: how they are judged, a preparation timeline, the materials checklist and honest answers to the questions applicants meet.`, 200),
  };
}

/** Types in hub order: by group, as the taxonomy lists them. */
export function publicTypesInOrder(): OpportunityTypeDef[] {
  return publicOpportunityTypes();
}

export const GROUP_HEADINGS: Partial<Record<OpportunityGroup, string>> = {
  work: "Work programs",
  venture: "For founders",
  funding: "Funding, prizes and awards",
  academic: "Academic",
  education: "Study and learning",
  creative: "Creative",
  visibility: "Talks and media",
  community: "Community and events",
  mobility: "Moving abroad",
};

export function typesByGroup(): { group: OpportunityGroup; heading: string; types: OpportunityTypeDef[] }[] {
  const out: { group: OpportunityGroup; heading: string; types: OpportunityTypeDef[] }[] = [];
  for (const t of publicTypesInOrder()) {
    let entry = out.find((e) => e.group === t.group);
    if (!entry) {
      entry = { group: t.group, heading: GROUP_HEADINGS[t.group] ?? t.group, types: [] };
      out.push(entry);
    }
    entry.types.push(t);
  }
  return out;
}

/** All public types with their live counts (0 when absent). */
export function typeCounts(counts: Record<string, number>): { def: OpportunityTypeDef; count: number }[] {
  return publicTypesInOrder().map((def) => ({ def, count: Math.max(0, Math.floor(counts[def.id] ?? counts[def.slug] ?? 0)) }));
}

/* ================================================================== 3. data access (server only) */

export interface SeoData {
  /** Every listable public listing (live, public SEO types), sorted for display. */
  listings: PublicListing[];
  /** Live listing counts per type id (what each hub actually lists). */
  counts: Record<string, number>;
  /** False when no database is configured (a build without env): pages show their empty states. */
  available: boolean;
}

const EMPTY: SeoData = { listings: [], counts: {}, available: false };

/** Page size used to walk the public catalogue (the engine may clamp it; the loop follows what it returns). */
const WALK_PAGE = 200;
const WALK_MAX_PAGES = 50;

function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function engine() {
  return import("@/lib/opportunities");
}

async function walkPublic(total: number): Promise<PublicListing[]> {
  const { listPublicOpportunities } = await engine();
  const out: PublicListing[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let i = 0; i < WALK_MAX_PAGES; i++) {
    const rows = await listPublicOpportunities({ limit: WALK_PAGE, offset });
    if (!rows.length) break;
    for (const row of rows) {
      const l = toListing(row);
      if (l && !seen.has(l.slug)) {
        seen.add(l.slug);
        out.push(l);
      }
    }
    offset += rows.length;
    // A short page ends the walk once the engine's own total is reached (it may clamp the page size).
    if (rows.length < WALK_PAGE && offset >= total) break;
  }
  return out;
}

async function loadSeoData(): Promise<SeoData> {
  if (!databaseConfigured()) return EMPTY;
  const { countPublicByType } = await engine();
  const engineCounts = (await countPublicByType()) ?? {};
  const total = Object.values(engineCounts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const now = Date.now();
  const listings = sortListings(
    (await walkPublic(total)).filter((l) => isListable(l, now)),
    now,
  );
  // Hubs show the number of listings they actually list (past-deadline rounds that the expiry
  // cron has not closed yet are excluded), so a count never promises more than the page holds.
  const counts: Record<string, number> = {};
  for (const l of listings) counts[l.type] = (counts[l.type] ?? 0) + 1;
  return { listings, counts, available: true };
}

/**
 * The whole public catalogue, once per render (React cache) and once per hour across renders
 * (Next's data cache; ISR pages regenerate on the same hour).
 */
export const getSeoData = cache(async (): Promise<SeoData> => {
  if (!databaseConfigured()) return EMPTY;
  const { unstable_cache } = await import("next/cache");
  const cached = unstable_cache(loadSeoData, ["programmatic-seo-data-v1"], { revalidate: 3600, tags: ["opportunities"] });
  return cached();
});

/** One listing in full (any status: closed rounds still get their "this round has closed" page). */
export const getListingDetail = cache(async (slug: string): Promise<ListingDetail | null> => {
  if (!databaseConfigured() || !isValidSlug(slug)) return null;
  const { getOpportunityBySlug } = await engine();
  const row = await getOpportunityBySlug(slug);
  return row ? toDetail(row) : null;
});

/** Live listings of one organization (from the catalogue already in memory). */
export async function listingsOfOrg(orgSlug: string): Promise<PublicListing[]> {
  const { listings } = await getSeoData();
  return listings.filter((l) => l.orgSlug === orgSlug);
}

/** Organizations with at least ORG_MIN_ITEMS live listings, most listings first. */
export function organizationsOf(listings: PublicListing[]): { slug: string; name: string; count: number; lastmod: string | null; types: OpportunityTypeId[] }[] {
  const map = new Map<string, { slug: string; name: string; count: number; lastmod: string | null; types: OpportunityTypeId[] }>();
  for (const l of listings) {
    if (!l.orgSlug || !isValidSlug(l.orgSlug)) continue;
    const e = map.get(l.orgSlug) ?? { slug: l.orgSlug, name: l.orgName ?? l.orgSlug, count: 0, lastmod: null, types: [] };
    e.count += 1;
    const lm = lastmodOf(l);
    if (lm && (!e.lastmod || lm > e.lastmod)) e.lastmod = lm;
    if (!e.types.includes(l.type)) e.types.push(l.type);
    map.set(l.orgSlug, e);
  }
  return [...map.values()].filter((o) => orgIndexable(o.count)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Live listings matched to a role, best-documented first. */
export function listingsForRole(listings: PublicListing[], profile: CareerProfile): PublicListing[] {
  const pursued = new Set<string>(profile.publicTypes);
  return listings.filter((l) => listingMatchesRole(l, profile.occupation, pursued));
}

/** The careers quality inputs for one role, from the catalogue. */
export function careerQualityFor(profile: CareerProfile, data: Pick<SeoData, "listings" | "counts">): ReturnType<typeof careerQuality> & { matched: PublicListing[] } {
  const matched = listingsForRole(data.listings, profile);
  const liveTypeCount = profile.publicTypes.filter((t) => (data.counts[t] ?? 0) >= MIN_INDEX_ITEMS).length;
  return { ...careerQuality({ liveTypeCount, matchedListings: matched.length, relatedCount: profile.related.length }), matched };
}

/** Program guides that pass the card-level check (the guide page re-checks the full listing). */
export function guideCandidates(listings: PublicListing[], now: number = Date.now()): PublicListing[] {
  return listings.filter((l) => cardGuideCandidate(l, now));
}

/** How many program-guide candidates are checked against their full listing per refresh. */
const GUIDE_CHECK_LIMIT = 120;

async function loadReadyGuides(): Promise<PublicListing[]> {
  const { listings } = await getSeoData();
  const now = Date.now();
  const candidates = guideCandidates(listings, now).slice(0, GUIDE_CHECK_LIMIT);
  const ready: PublicListing[] = [];
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);
    const details = await Promise.all(batch.map((l) => getListingDetail(l.slug)));
    details.forEach((d, j) => {
      if (d && guideReadiness(d, now).ready) ready.push(batch[j]);
    });
  }
  return ready;
}

/** Listings whose program guide is complete (checked against the full listing), cached for an hour. */
export const getReadyProgramGuides = cache(async (): Promise<PublicListing[]> => {
  if (!databaseConfigured()) return [];
  const { unstable_cache } = await import("next/cache");
  return unstable_cache(loadReadyGuides, ["programmatic-ready-guides-v1"], { revalidate: 3600, tags: ["opportunities"] })();
});

export interface IndexableTargets {
  /** Type hubs with enough live listings (slug, live count, newest listing change). */
  types: { slug: string; type: OpportunityTypeId; count: number; lastmod: string | null }[];
  /** Region pages with enough live listings. */
  regions: { typeSlug: string; region: RegionId; count: number; lastmod: string | null }[];
  /** Career pages that pass the careers quality rule, with the newest matched listing change. */
  careers: { code: string; lastmod: string | null }[];
}

function newest(dates: (string | null)[]): string | null {
  return dates.reduce<string | null>((m, d) => (d && (!m || d > m) ? d : m), null);
}

async function loadIndexableTargets(): Promise<IndexableTargets> {
  const data = await getSeoData();
  const types: IndexableTargets["types"] = [];
  const regions: IndexableTargets["regions"] = [];
  for (const def of publicOpportunityTypes()) {
    const of = data.listings.filter((l) => l.type === def.id);
    if (hubIndexable(of.length)) types.push({ slug: def.slug, type: def.id, count: of.length, lastmod: newest(of.map(lastmodOf)) });
    for (const region of REGION_IDS) {
      const inRegion = of.filter((l) => regionsOf(l.geo).includes(region));
      if (hubIndexable(inRegion.length)) regions.push({ typeSlug: def.slug, region, count: inRegion.length, lastmod: newest(inRegion.map(lastmodOf)) });
    }
  }
  const careers: IndexableTargets["careers"] = [];
  if (data.listings.length) {
    for (const o of OCCUPATIONS) {
      const profile = careerProfile(o.code);
      if (!profile) continue;
      const q = careerQualityFor(profile, data);
      if (q.indexable) careers.push({ code: o.code, lastmod: newest(q.matched.map(lastmodOf)) });
    }
  }
  return { types, regions, careers };
}

/** What is indexable right now (sitemap, autolinks, careers prerendering), cached for an hour. */
export const getIndexableTargets = cache(async (): Promise<IndexableTargets> => {
  if (!databaseConfigured()) return { types: [], regions: [], careers: [] };
  const { unstable_cache } = await import("next/cache");
  return unstable_cache(loadIndexableTargets, ["programmatic-indexable-v1"], { revalidate: 3600, tags: ["opportunities"] })();
});

/* ================================================================== 4. sitemap rules (pure) */

/** Bilingual public pages (P5a's marketing and trust pages), with their sitemap priority. */
export const STATIC_SITEMAP_PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/students", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/professionals", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/founders", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/researchers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/creators", priority: 0.7, changeFrequency: "monthly" },
  { path: "/for/career-changers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
  { path: "/about", priority: 0.5, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.4, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/acceptable-use", priority: 0.2, changeFrequency: "yearly" },
  { path: "/cookie-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.2, changeFrequency: "yearly" },
];

/** The sitemap shards (/sitemap/<id>.xml), listed by the index at /sitemap.xml. */
export const SITEMAP_IDS = ["static", "opportunities", "careers", "organizations", "guides", "blog"] as const;
export type SitemapId = (typeof SITEMAP_IDS)[number];

/** Never in a sitemap: the signed-in area, admin, sign-in, APIs and the sandbox, in either locale. */
export function isPrivatePath(path: string): boolean {
  const p = path.replace(/^\/zh(?=\/|$)/, "") || "/";
  return /^\/(app|checkout|admin|sign-in)(\/|$)/.test(p) || /^\/(api|sandbox)(\/|$)/.test(p);
}

/** The /zh URL of a bilingual page ("/" → "/zh"). */
export function zhPath(path: string): string {
  return path === "/" ? "/zh" : `/zh${path}`;
}

export type ResolvedGuide =
  | { kind: "playbook"; def: OpportunityTypeDef; path: string }
  | { kind: "program"; detail: ListingDetail; path: string };

/** A /guides/<slug> segment → the playbook or the (complete) program guide it names, else null. */
export async function resolveGuide(segment: string): Promise<ResolvedGuide | null> {
  const ref = parseGuideSlug(segment);
  if (!ref) return null;
  if (ref.kind === "playbook") return { kind: "playbook", def: getOpportunityType(ref.type), path: playbookPath(ref.typeSlug) };
  const detail = await getListingDetail(ref.slug);
  if (!detail || !guideReadiness(detail).ready) return null;
  return { kind: "program", detail, path: programGuidePath(detail.slug) };
}

/** A listing that may be shown publicly: public, reviewed (active or expired), of a public SEO type. */
export function isShowable(d: ListingDetail | null): d is ListingDetail {
  return Boolean(d && d.isPublic && (d.status === "active" || d.status === "expired") && opportunityTypeBySlug(d.typeSlug));
}
