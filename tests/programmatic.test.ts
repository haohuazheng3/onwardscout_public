import { describe, expect, it } from "vitest";
import { OCCUPATIONS } from "@/lib/core/occupations";
import { OPPORTUNITY_TYPES, publicOpportunityTypes } from "@/lib/core/opportunity-types";
import {
  CHANNEL_HELP,
  LIST_PAGE_SIZE,
  MIN_INDEX_ITEMS,
  REGION_IDS,
  REGION_LABELS,
  RESERVED_LISTING_SLUGS,
  SITEMAP_IDS,
  STATIC_SITEMAP_PAGES,
  TYPE_COPY,
  benefitLine,
  buildProgramGuide,
  canonicalRedirect,
  cardGuideCandidate,
  careerGroups,
  careerProfile,
  careerQuality,
  careerQualityFor,
  costLines,
  datedTimeline,
  displayTags,
  eligibilityLines,
  eventDatesOf,
  guideReadiness,
  hubIndexable,
  isClosed,
  isListable,
  isPrivatePath,
  isValidSlug,
  lastmodOf,
  listingIndexable,
  listingMatchesRole,
  materialChecklist,
  moneyLine,
  opportunityPath,
  orgIndexable,
  organizationsOf,
  parseGuideSlug,
  placeLine,
  playbookPath,
  programGuidePath,
  regionOfCountry,
  regionPath,
  regionsOf,
  scoutHelpFor,
  shorten,
  sortListings,
  timelineFor,
  timingOf,
  toDetail,
  toListing,
  typeCopy,
  typePath,
  zhPath,
  zhRedirectTarget,
  type ListingDetail,
  type PublicListing,
} from "@/lib/programmatic";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

/** A card in the shape P2a's listPublicOpportunities returns (OpportunityCard). */
function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "opp_abc",
    slug: "example-accelerator-2027",
    type: "accelerator",
    name: "Example Accelerator 2027",
    orgName: "Example Ventures",
    orgSlug: "example-ventures",
    url: "https://example.org/apply",
    summary: "A three-month program for early-stage software companies, with mentorship and a demo day for investors.",
    deadline: inDays(30),
    rolling: false,
    cycle: null,
    geo: { countries: ["us"], cities: ["Boston"], remote: null, worldwide: false },
    benefits: { summary: null, money: { kind: "investment", min: null, max: 500000, currency: "USD", period: "once" }, perks: ["mentors"], visaSponsorship: null, travelSupport: null, housing: null },
    cost: { free: null, applicationFee: null, participationFee: null, equityPercent: 7, timeCommitment: null, relocationRequired: null, notes: null },
    channel: "CH2",
    requiresAccount: false,
    requiresPayment: false,
    captchaLikely: false,
    requiredMaterials: ["pitch_deck", "business_plan"],
    tags: ["software", "saas"],
    estEffortMinutes: 60,
    qualityScore: 80,
    verifiedAt: "2026-10-20T00:00:00.000Z",
    status: "active",
    public: true,
    mine: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function listing(over: Record<string, unknown> = {}): PublicListing {
  const l = toListing(card(over));
  if (!l) throw new Error("fixture did not normalise");
  return l;
}

/** A full `opportunities` row (Date objects, apply jsonb). */
function detail(over: Record<string, unknown> = {}): ListingDetail {
  const d = toDetail({
    ...card(),
    deadline: new Date(NOW + 30 * DAY),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-15T00:00:00Z"),
    verifiedAt: new Date("2026-10-20T00:00:00Z"),
    description: "Longer description.",
    eligibility: { identities: ["F"], stages: [], degree: null, minYears: null, maxYears: null, nationality: [], residency: [], ageMin: null, ageMax: null, studentsOnly: null, companyMaxAgeYears: 3, notes: null },
    languages: ["en"],
    industries: ["software-internet"],
    functions: [],
    apply: { channel: "CH2", url: "https://example.org/apply/form", email: null, platform: "own_site", fieldsSchema: [], requiresAccount: false, requiresPayment: false, captchaLikely: false, ats: null, instructions: null },
    ...over,
  });
  if (!d) throw new Error("fixture did not normalise");
  return d;
}

describe("slugs, paths and canonicals", () => {
  it("validates slugs", () => {
    expect(isValidSlug("cvpr-2027-call-for-papers")).toBe(true);
    for (const bad of ["", "UPPER", "a--b", "-a", "a_b", "a/b", "x".repeat(161), 42]) expect(isValidSlug(bad)).toBe(false);
  });

  it("builds every public URL from one place", () => {
    expect(typePath("grants")).toBe("/opportunities/grants");
    expect(typePath("grants", 1)).toBe("/opportunities/grants");
    expect(typePath("grants", 3)).toBe("/opportunities/grants/page/3");
    expect(regionPath("grants", "europe")).toBe("/opportunities/grants/in/europe");
    expect(opportunityPath("accelerator", "example")).toBe("/opportunities/accelerators/example");
    expect(opportunityPath("conference_cfp", "cvpr")).toBe("/opportunities/conference-cfps/cvpr");
    expect(programGuidePath("example")).toBe("/guides/how-to-apply-to-example");
    expect(playbookPath("grants")).toBe("/guides/how-to-apply-for-grants");
  });

  it("redirects a listing reached under the wrong type to its canonical URL", () => {
    expect(canonicalRedirect("accelerators", { type: "accelerator", slug: "example" })).toBeNull();
    expect(canonicalRedirect("grants", { type: "accelerator", slug: "example" })).toBe("/opportunities/accelerators/example");
  });

  it("reserves the static segments beside listing slugs", () => {
    expect([...RESERVED_LISTING_SLUGS]).toEqual(["page", "in"]);
  });

  it("parses guide URLs into playbooks and program guides", () => {
    expect(parseGuideSlug("how-to-apply-for-grants")).toEqual({ kind: "playbook", typeSlug: "grants", type: "grant" });
    expect(parseGuideSlug("how-to-apply-to-cvpr-2027")).toEqual({ kind: "program", slug: "cvpr-2027" });
    expect(parseGuideSlug("how-to-apply-for-jobs")).toBeNull(); // jobs are not a public SEO type
    expect(parseGuideSlug("how-to-apply-for-nothing")).toBeNull();
    expect(parseGuideSlug("how-to-apply-to-")).toBeNull();
    expect(parseGuideSlug("random-page")).toBeNull();
    expect(parseGuideSlug("How-To")).toBeNull();
  });

  it("maps /zh requests for English-only pages to their English URL, and only those", () => {
    expect(zhRedirectTarget("/zh/opportunities")).toBe("/opportunities");
    expect(zhRedirectTarget("/zh/opportunities/grants/page/2")).toBe("/opportunities/grants/page/2");
    expect(zhRedirectTarget("/zh/careers/software-engineer/")).toBe("/careers/software-engineer");
    expect(zhRedirectTarget("/zh/organizations/example")).toBe("/organizations/example");
    expect(zhRedirectTarget("/zh/guides")).toBe("/guides");
    expect(zhRedirectTarget("/zh/blog/academic-life/some-post")).toBe("/blog/academic-life/some-post");
    expect(zhRedirectTarget("/zh/pricing")).toBeNull();
    expect(zhRedirectTarget("/zh")).toBeNull();
    expect(zhRedirectTarget("/zh/blogger")).toBeNull();
    expect(zhRedirectTarget("/opportunities")).toBeNull();
    expect(zhRedirectTarget("/zhx/opportunities")).toBeNull();
  });
});

describe("regions", () => {
  it("places countries in one region each and labels every region", () => {
    expect(regionOfCountry("US")).toBe("north-america");
    expect(regionOfCountry("br")).toBe("latin-america");
    expect(regionOfCountry("GB")).toBe("europe");
    expect(regionOfCountry("AE")).toBe("middle-east");
    expect(regionOfCountry("KE")).toBe("africa");
    expect(regionOfCountry("CN")).toBe("asia-pacific");
    expect(regionOfCountry("AU")).toBe("asia-pacific");
    expect(regionOfCountry("ZZ")).toBeNull();
    for (const r of REGION_IDS) expect(REGION_LABELS[r]).toBeTruthy();
  });

  it("derives a listing's regions from where it happens and whether it is open to anyone", () => {
    expect(regionsOf({ countries: ["US", "DE"], cities: [], remote: null, worldwide: false })).toEqual(["north-america", "europe"]);
    expect(regionsOf({ countries: [], cities: [], remote: "remote", worldwide: false })).toEqual(["worldwide"]);
    expect(regionsOf({ countries: ["SG"], cities: [], remote: null, worldwide: true })).toEqual(["worldwide", "asia-pacific"]);
    expect(regionsOf({ countries: [], cities: [], remote: null, worldwide: false })).toEqual([]);
  });

  it("writes a short place line", () => {
    expect(placeLine({ countries: ["US"], cities: ["Boston"], remote: null, worldwide: false })).toBe("Boston, United States");
    expect(placeLine({ countries: [], cities: [], remote: "remote", worldwide: true })).toBe("Remote · open worldwide");
    expect(placeLine({ countries: [], cities: [], remote: null, worldwide: false })).toBeNull();
  });
});

describe("normalisers", () => {
  it("reads P2a's card shape", () => {
    const l = listing();
    expect(l.type).toBe("accelerator");
    expect(l.typeSlug).toBe("accelerators");
    expect(l.geo.countries).toEqual(["US"]);
    expect(l.channel).toBe("CH2");
    expect(l.isPublic).toBe(true);
    expect(l.updatedAt).toBeNull();
    expect(lastmodOf(l)).toBe("2026-10-20T00:00:00.000Z");
  });

  it("rejects rows without the essentials or with an unknown type", () => {
    expect(toListing(card({ slug: null }))).toBeNull();
    expect(toListing(card({ type: "spaceship" }))).toBeNull();
    expect(toListing(null)).toBeNull();
    expect(toListing("x")).toBeNull();
  });

  it("reads the full row shape (Date objects, apply jsonb) and P2a's detail shape", () => {
    const d = detail();
    expect(d.deadline).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect(d.apply.url).toBe("https://example.org/apply/form");
    expect(d.apply.platform).toBe("own_site");
    expect(lastmodOf(d)).toBe("2026-10-20T00:00:00.000Z");
    const fromDetailShape = toDetail({ ...card(), applyUrl: "https://example.org/a", platform: "f6s", instructions: "Apply online." });
    expect(fromDetailShape?.apply).toEqual({ url: "https://example.org/a", email: null, platform: "f6s", instructions: "Apply online." });
  });
});

describe("timing", () => {
  it("closes a round one day after its deadline, never a rolling one", () => {
    expect(isClosed(listing({ deadline: inDays(-0.5) }), NOW)).toBe(false);
    expect(isClosed(listing({ deadline: inDays(-2) }), NOW)).toBe(true);
    expect(isClosed(listing({ deadline: inDays(-2), rolling: true }), NOW)).toBe(false);
    expect(isClosed(listing({ status: "expired", deadline: null }), NOW)).toBe(true);
  });

  it("says honestly when to apply", () => {
    expect(timingOf(listing({ deadline: inDays(5) }), NOW)).toMatchObject({ tone: "soon" });
    expect(timingOf(listing({ deadline: "2026-12-01T00:00:00Z" }), NOW)).toEqual({ tone: "open", label: "Apply by 1 December 2026", date: "2026-12-01T00:00:00.000Z" });
    expect(timingOf(listing({ deadline: null, rolling: true }), NOW).tone).toBe("rolling");
    expect(timingOf(listing({ deadline: null, cycle: "Annual, opens in March" }), NOW).label).toBe("Cycle: Annual, opens in March");
    expect(timingOf(listing({ deadline: null }), NOW).label).toMatch(/check the official page/);
    expect(timingOf(listing({ deadline: inDays(-3) }), NOW).tone).toBe("closed");
  });

  it("lists upcoming deadlines first, then rolling, then the rest", () => {
    const sorted = sortListings(
      [
        listing({ slug: "unknown", deadline: null }),
        listing({ slug: "rolling", deadline: null, rolling: true }),
        listing({ slug: "later", deadline: inDays(40) }),
        listing({ slug: "sooner", deadline: inDays(10) }),
      ],
      NOW,
    );
    expect(sorted.map((l) => l.slug)).toEqual(["sooner", "later", "rolling", "unknown"]);
  });

  it("puts real dates on a timeline only when they are still ahead", () => {
    const steps = timelineFor("grant");
    const dated = datedTimeline(steps, inDays(10), NOW);
    expect(dated.find((s) => s.daysBefore === 28)?.by).toBeNull();
    expect(dated.find((s) => s.daysBefore === 2)?.by).toBe(inDays(8));
    expect(datedTimeline(steps, null, NOW).every((s) => s.by === null)).toBe(true);
  });

  it("orders every type's timeline from earliest to last step", () => {
    for (const t of publicOpportunityTypes()) {
      const steps = timelineFor(t.id);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < steps.length; i++) expect(steps[i].daysBefore).toBeLessThan(steps[i - 1].daysBefore);
    }
  });
});

describe("money, cost and eligibility lines (only what the organiser published)", () => {
  it("formats benefits", () => {
    expect(moneyLine({ kind: "investment", min: null, max: 500000, currency: "USD", period: "once" })).toBe("Up to $500,000 investment");
    expect(moneyLine({ kind: "stipend", min: 2000, max: 2000, currency: "EUR", period: "month" })).toBe("€2,000 a month stipend");
    expect(moneyLine({ kind: "prize", min: 1000, max: 5000, currency: null, period: null })).toBe("1,000–5,000 in prizes");
    expect(moneyLine({ kind: "grant", min: null, max: null, currency: "USD", period: null })).toBeNull();
    expect(benefitLine({ summary: "Mentorship and office space", money: null, perks: [], visaSponsorship: null, travelSupport: null, housing: null })).toBe("Mentorship and office space");
    expect(benefitLine(null)).toBeNull();
  });

  it("lists costs", () => {
    expect(costLines(listing().cost)).toEqual(["Takes 7% equity"]);
    expect(costLines({ free: true, applicationFee: null, participationFee: null, equityPercent: 0, timeCommitment: "3 months", relocationRequired: true, notes: null })).toEqual([
      "Free to apply and take part",
      "Takes no equity",
      "Time: 3 months",
      "Relocation required",
    ]);
  });

  it("states eligibility rules in plain words", () => {
    expect(eligibilityLines(detail().eligibility)).toEqual(["Open to founders", "Company founded within the last 3 years"]);
    expect(
      eligibilityLines({ identities: ["S", "R"], stages: [], degree: "master", minYears: 2, maxYears: null, nationality: ["DE"], residency: [], ageMin: null, ageMax: 30, studentsOnly: null, companyMaxAgeYears: null, notes: "Must attend in person." }),
    ).toEqual(["Open to students, researchers", "Minimum degree: Master's degree", "At least 2 years of experience", "Nationality: Germany", "Age 30 or under", "Must attend in person."]);
    expect(eligibilityLines(null)).toEqual([]);
  });

  it("uses only explicit event dates, never a deadline", () => {
    expect(eventDatesOf(["event:2027-06-20..2027-06-25"])).toEqual({ startDate: "2027-06-20", endDate: "2027-06-25" });
    expect(eventDatesOf(["ai", "event:2027-06-20"])).toEqual({ startDate: "2027-06-20" });
    expect(eventDatesOf(["event:2027-06-25..2027-06-20"])).toEqual({ startDate: "2027-06-25" });
    expect(eventDatesOf(["deadline:2026-11-10", "cvpr"])).toBeNull();
    expect(displayTags(["AI", "ai", "event:2027-06-20", "computer vision"])).toEqual(["ai", "computer vision"]);
  });

  it("shortens on word boundaries", () => {
    expect(shorten("one two three four", 9)).toBe("one two…");
    expect(shorten("short", 10)).toBe("short");
  });
});

describe("quality gates", () => {
  it("indexes hubs and region pages from three live listings", () => {
    expect(MIN_INDEX_ITEMS).toBe(3);
    expect(hubIndexable(2)).toBe(false);
    expect(hubIndexable(3)).toBe(true);
    expect(orgIndexable(1)).toBe(false);
    expect(orgIndexable(2)).toBe(false);
    expect(orgIndexable(3)).toBe(true);
    expect(LIST_PAGE_SIZE).toBeGreaterThan(0);
  });

  it("indexes a listing only while public, open and described", () => {
    expect(listingIndexable(detail(), NOW)).toBe(true);
    expect(listingIndexable(detail({ deadline: new Date(NOW - 3 * DAY) }), NOW)).toBe(false);
    expect(listingIndexable(detail({ summary: "Too short." }), NOW)).toBe(false);
    expect(listingIndexable(detail({ public: false }), NOW)).toBe(false);
    expect(listingIndexable(detail({ type: "job" }), NOW)).toBe(false); // jobs have no public pages
    expect(isListable(listing({ type: "investor" }), NOW)).toBe(false);
  });

  it("builds a program guide only from complete data, naming what is missing", () => {
    expect(guideReadiness(detail(), NOW)).toEqual({ ready: true, missing: [] });
    const thin = guideReadiness(detail({ requiredMaterials: [], eligibility: null, orgName: null, cycle: null, deadline: null }), NOW);
    expect(thin.ready).toBe(false);
    expect(thin.missing).toEqual(["the organizer", "dates or cycle", "required materials", "eligibility rules"]);
    expect(guideReadiness(detail({ deadline: new Date(NOW - 5 * DAY) }), NOW).missing).toContain("an open round");
    expect(cardGuideCandidate(listing(), NOW)).toBe(true);
    expect(cardGuideCandidate(listing({ requiredMaterials: [] }), NOW)).toBe(false);
  });

  it("indexes a career page only with role-specific live content behind it", () => {
    expect(careerQuality({ liveTypeCount: 3, matchedListings: 3, relatedCount: 2 }).indexable).toBe(true);
    const thin = careerQuality({ liveTypeCount: 5, matchedListings: 2, relatedCount: 8 });
    expect(thin.indexable).toBe(false);
    expect(thin.reasons[0]).toMatch(/2 live listing/);
    expect(careerQuality({ liveTypeCount: 2, matchedListings: 9, relatedCount: 8 }).indexable).toBe(false);
    expect(careerQuality({ liveTypeCount: 9, matchedListings: 9, relatedCount: 1 }).indexable).toBe(false);
  });

  it("lists organizations with at least three live listings (the bar of every hub)", () => {
    const orgs = organizationsOf([
      listing({ slug: "a" }),
      listing({ slug: "b", type: "grant" }),
      listing({ slug: "d" }),
      listing({ slug: "c", orgSlug: "pair", orgName: "Pair" }),
      listing({ slug: "e", orgSlug: "pair", orgName: "Pair" }),
    ]);
    expect(orgs).toEqual([{ slug: "example-ventures", name: "Example Ventures", count: 3, lastmod: "2026-10-20T00:00:00.000Z", types: ["accelerator", "grant"] }]);
  });
});

describe("careers", () => {
  it("derives identity groups from the role", () => {
    expect(careerGroups(careerProfile("software-engineer")!.occupation).groups).toEqual(["E"]);
    const researcher = OCCUPATIONS.find((o) => o.function === "research" && !o.identity)!;
    expect(careerGroups(researcher).groups).toEqual(["E", "R"]);
    expect(careerGroups(careerProfile("ai-research-scientist")!.occupation).groups).toEqual(["R"]); // identity hint R4
    expect(careerGroups(careerProfile("physician")!.occupation).groups[0]).toBe("P");
  });

  it("builds a profile: goals, public and private types, materials, related roles", () => {
    const p = careerProfile("software-engineer");
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.goals.length).toBeGreaterThan(0);
    expect(p.publicTypes.length).toBeGreaterThan(0);
    for (const t of p.publicTypes) expect(OPPORTUNITY_TYPES.find((d) => d.id === t)?.publicSeo).toBe(true);
    for (const t of p.privateTypes) expect(OPPORTUNITY_TYPES.find((d) => d.id === t)?.publicSeo).toBe(false);
    expect(p.publicTypes).not.toContain("practice");
    expect(p.materials.length).toBeGreaterThan(0);
    expect(p.related.length).toBeGreaterThanOrEqual(2);
    expect(p.related.some((r) => r.code === "software-engineer")).toBe(false);
    expect(careerProfile("not-a-role")).toBeNull();
  });

  it("matches live listings to a role by its text, within the types the role pursues", () => {
    const p = careerProfile("software-engineer")!;
    const pursued = new Set<string>(p.publicTypes);
    const type = p.publicTypes[0];
    expect(listingMatchesRole(listing({ type, slug: "m1", tags: ["software engineers"], summary: "For software engineers who want to grow." }), p.occupation, pursued)).toBe(true);
    expect(listingMatchesRole(listing({ type, slug: "m2", tags: ["pottery"], name: "Ceramics residency", summary: "A month at the kiln for ceramic artists." }), p.occupation, pursued)).toBe(false);
    expect(listingMatchesRole(listing({ type: "journal", slug: "m3", tags: ["software engineer"] }), p.occupation, new Set(["grant"]))).toBe(false);
  });

  it("feeds the quality rule from the catalogue", () => {
    const p = careerProfile("software-engineer")!;
    const type = p.publicTypes[0];
    const listings = [1, 2, 3].map((i) => listing({ slug: `se-${i}`, type, tags: ["software engineer"], summary: "A program for software engineers." }));
    const counts = Object.fromEntries(p.publicTypes.map((t) => [t, 5]));
    const q = careerQualityFor(p, { listings, counts });
    expect(q.matched).toHaveLength(3);
    expect(q.indexable).toBe(true);
    expect(careerQualityFor(p, { listings: [], counts }).indexable).toBe(false);
  });
});

describe("copy", () => {
  it("has hand-written guidance for every public type", () => {
    for (const t of publicOpportunityTypes()) {
      const copy = TYPE_COPY[t.id];
      expect(copy, t.id).toBeDefined();
      expect(copy.intro.length).toBeGreaterThan(80);
      expect(copy.win).toHaveLength(3);
      expect(copy.questions).toHaveLength(2);
      // No invented figures: no percentages, money amounts or lorem.
      const all = [copy.intro, ...copy.win, ...copy.questions.flatMap((q) => [q.q, q.a])].join(" ");
      expect(all).not.toMatch(/%|\$|€|£|lorem/i);
    }
    expect(typeCopy("job").win).toHaveLength(3); // private types fall back to neutral guidance
  });

  it("says what Onward Scout does on every channel, and what stays with the person", () => {
    for (const ch of ["CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"] as const) expect(CHANNEL_HELP[ch].length).toBeGreaterThan(40);
    expect(scoutHelpFor({ channel: "CH2", type: "grant", requiresAccount: true, requiresPayment: true })).toMatch(/own login.*payment always stays with you/);
    expect(scoutHelpFor({ channel: null, type: "conference_cfp", requiresAccount: false, requiresPayment: false })).toBe(CHANNEL_HELP.CH6);
  });

  it("labels materials with who produces them", () => {
    const list = materialChecklist(["pitch_deck", "transcript", "cover_letter", "supplementary_material", "pitch_deck"]);
    expect(list.map((c) => [c.id, c.producedBy])).toEqual([
      ["pitch_deck", "either"],
      ["transcript", "user"],
      ["cover_letter", "platform"],
      ["supplementary_material", "unknown"],
    ]);
    expect(list[3].label).toBe("Supplementary material");
  });

  it("builds a program guide from the listing's own facts", () => {
    const g = buildProgramGuide(detail(), NOW);
    expect(g.title).toBe("How to apply to Example Accelerator 2027");
    expect(g.steps.map((s) => s.name)).toEqual(["Check that you are eligible", "Gather the materials", "Write the answers", "Submit on the official page", "Follow up"]);
    expect(g.steps[3].text).toMatch(/before 20 November 2026/);
    expect(g.facts.find((f) => f.label === "What you get")?.value).toBe("Up to $500,000 investment");
    expect(g.checklist.map((c) => c.id)).toEqual(["pitch_deck", "business_plan"]);
    expect(g.description.length).toBeLessThanOrEqual(200);
  });
});

describe("sitemap rules", () => {
  it("lists only public, bilingual static pages", () => {
    for (const p of STATIC_SITEMAP_PAGES) expect(isPrivatePath(p.path)).toBe(false);
    expect(new Set(STATIC_SITEMAP_PAGES.map((p) => p.path)).size).toBe(STATIC_SITEMAP_PAGES.length);
    expect(SITEMAP_IDS).toContain("blog");
  });

  it("recognises private paths in both locales", () => {
    for (const p of ["/app", "/app/scout/x", "/zh/app", "/checkout/success", "/admin", "/zh/admin/users", "/sign-in", "/zh/sign-in/factor", "/api/me", "/sandbox/form"]) {
      expect(isPrivatePath(p), p).toBe(true);
    }
    for (const p of ["/", "/zh", "/applications-guide", "/opportunities", "/apply"]) expect(isPrivatePath(p), p).toBe(false);
  });

  it("writes zh URLs for bilingual pages", () => {
    expect(zhPath("/")).toBe("/zh");
    expect(zhPath("/pricing")).toBe("/zh/pricing");
  });
});
