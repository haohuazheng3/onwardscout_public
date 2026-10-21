import { describe, expect, it } from "vitest";
import type { NormalizedOpportunity } from "@/lib/llm/types";
import { canonicalOpportunityUrl, deadlineDate, hostName, rowFromNormalized, slugify } from "@/lib/opportunities/normalize";
import { benefitsFacts, countryLabel, deadlineInfo, formatMoneyRange, hostOf, whatYoullDo } from "@/lib/opportunities/present";

function normalized(over: Partial<NormalizedOpportunity> = {}): NormalizedOpportunity {
  return {
    type: "grant",
    name: "Open Source Climate Grant",
    orgName: "Example Foundation",
    summary: null,
    description: "Short intro.\nThis grant funds open-source tools that measure emissions in cities around the world.",
    url: "https://example.org/grants/climate",
    deadline: "2027-01-15",
    rolling: false,
    cycle: "Annual",
    geo: { countries: ["us", "Germany", "DE"], cities: ["Berlin"], remote: null, worldwide: false },
    languages: ["EN", "english"],
    tags: ["Climate", "open source", "x"],
    industries: ["energy-environment", "not-a-code"],
    functions: ["engineering", "wizardry"],
    eligibility: { identities: ["R", "F2", "martians"], stages: [], degree: "phd", minYears: null, maxYears: null, nationality: ["us", "XX1"], residency: [], ageMin: null, ageMax: 35.4, studentsOnly: null, notes: null },
    benefits: { summary: "Up to $50,000", money: { min: null, max: 50_000, currency: "usd", text: "$50,000" }, perks: ["Mentorship"] },
    cost: { free: true, applicationFee: null, equityPercent: 140, notes: null },
    requiredMaterials: ["project_proposal", "budget_sheet"],
    apply: { channel: "CH9", url: null, email: null, platform: null, requiresAccount: true, requiresPayment: null },
    estEffortMinutes: 45.4,
    confidence: 0.7,
    missing: ["orgSlug"],
    expired: false,
    ...over,
  };
}

describe("canonicalOpportunityUrl", () => {
  it("drops tracking, hash, www and trailing slashes", () => {
    expect(canonicalOpportunityUrl("https://WWW.Example.org/jobs/123/?utm_source=x&gh_jid=9#apply")).toBe("https://example.org/jobs/123/?gh_jid=9");
    expect(canonicalOpportunityUrl("https://example.org/jobs/123/")).toBe("https://example.org/jobs/123");
    expect(canonicalOpportunityUrl("https://example.org/")).toBe("https://example.org");
    expect(canonicalOpportunityUrl("https://example.org/a?b=2&a=1&fbclid=z")).toBe("https://example.org/a?a=1&b=2");
  });

  it("rejects what isn't a web URL", () => {
    expect(canonicalOpportunityUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalOpportunityUrl("not a url")).toBeNull();
  });
});

describe("rowFromNormalized", () => {
  const ctx = { url: "https://example.org/grants/climate", fallbackType: "job" as const, fallbackName: "Opportunity on example.org" };

  it("keeps only valid values and never invents unknown ones", () => {
    const row = rowFromNormalized(normalized(), ctx);
    expect(row.type).toBe("grant");
    expect(row.typeGuessed).toBe(false);
    expect(row.geo.countries).toEqual(["US", "DE"]);
    expect(row.languages).toEqual(["en"]);
    expect(row.tags).toEqual(["climate", "open source"]);
    expect(row.industries).toEqual(["energy-environment"]);
    expect(row.functions).toEqual(["engineering"]);
    expect(row.eligibility.identities).toEqual(["R", "F2"]);
    expect(row.eligibility.degree).toBeNull();
    expect(row.eligibility.nationality).toEqual(["US"]);
    expect(row.eligibility.ageMax).toBe(35);
    expect(row.benefits.money).toEqual({ kind: "grant", min: null, max: 50_000, currency: "USD", period: null });
    expect(row.cost.free).toBe(true);
    expect(row.cost.equityPercent).toBeNull();
    expect(row.requiredMaterials).toEqual(["project_proposal"]);
    expect(row.apply.channel).toBe("CH2");
    expect(row.apply.url).toBe(ctx.url);
    expect(row.apply.requiresAccount).toBe(true);
    expect(row.estEffortMinutes).toBe(45);
    expect(row.deadline?.toISOString()).toBe("2027-01-15T23:59:59.000Z");
    expect(row.summary).toBe("This grant funds open-source tools that measure emissions in cities around the world.");
    expect(row.orgSlug).toBe("example-foundation");
  });

  it("uses the person's goal type and the page title only when the page says nothing", () => {
    const row = rowFromNormalized(normalized({ type: null, name: null, orgName: null }), ctx);
    expect(row.type).toBe("job");
    expect(row.typeGuessed).toBe(true);
    expect(row.missing).toContain("type");
    expect(row.name).toBe("Opportunity on example.org");
    expect(row.orgSlug).toBeNull();
    expect(rowFromNormalized(normalized({ type: "practice" }), { ...ctx, fallbackType: "practice" }).type).toBe("job");
  });
});

describe("small helpers", () => {
  it("slugifies, reads hosts and deadlines", () => {
    expect(slugify("Société Générale — Graduate Programme 2027!")).toBe("societe-generale-graduate-programme-2027");
    expect(slugify("中文名称")).toBe("");
    expect(hostName("https://www.jobs.example.com/x")).toBe("jobs.example.com");
    expect(hostOf("nope")).toBeNull();
    expect(deadlineDate("2027-03-01T12:00:00Z")?.toISOString()).toBe("2027-03-01T12:00:00.000Z");
    expect(deadlineDate("someday")).toBeNull();
    expect(deadlineDate(null)).toBeNull();
  });
});

describe("presentation", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("says what the person will do, by channel", () => {
    expect(whatYoullDo({ channel: "CH1" })).toBe("confirm");
    expect(whatYoullDo({ channel: "CH2", requiresAccount: true })).toBe("confirmHandoff");
    expect(whatYoullDo({ channel: "CH3", captchaLikely: true })).toBe("confirmHandoff");
    expect(whatYoullDo({ channel: "CH4" })).toBe("email");
    expect(whatYoullDo({ channel: "CH5" })).toBe("documents");
    expect(whatYoullDo({ channel: "CH6" })).toBe("handoff");
    expect(whatYoullDo({ channel: "CH7" })).toBe("confirm");
  });

  it("turns deadlines into countdowns that warn under a week", () => {
    expect(deadlineInfo(null, false, now)).toEqual({ kind: "unknown" });
    expect(deadlineInfo(null, true, now)).toEqual({ kind: "rolling" });
    expect(deadlineInfo("2026-10-20T00:00:00Z", false, now)).toEqual({ kind: "closed" });
    expect(deadlineInfo("2026-10-21T20:00:00Z", false, now)).toEqual({ kind: "today", urgent: true });
    expect(deadlineInfo("2026-10-25T23:59:59Z", false, now)).toEqual({ kind: "days", days: 5, urgent: true });
    expect(deadlineInfo("2026-11-10T23:59:59Z", false, now)).toEqual({ kind: "days", days: 21, urgent: false });
    expect(deadlineInfo("2027-06-01T00:00:00Z", false, now).kind).toBe("date");
    expect(deadlineInfo("garbage", true, now)).toEqual({ kind: "rolling" });
  });

  it("formats money ranges compactly, or not at all", () => {
    expect(formatMoneyRange({ min: 5000, max: 10000, currency: "USD" }, "en")).toBe("$5K–$10K");
    expect(formatMoneyRange({ max: 1_200_000, currency: "EUR" }, "en")).toBe("€1.2M");
    expect(formatMoneyRange({ min: 300 }, "en")).toBe("300");
    expect(formatMoneyRange({ min: 0, max: null }, "en")).toBeNull();
    expect(formatMoneyRange(null, "en")).toBeNull();
  });

  it("collects benefit facts without inventing", () => {
    const f = benefitsFacts(
      { summary: null, money: { kind: "prize", min: null, max: 20000, currency: "USD", period: "once" }, perks: ["", "Mentors"], visaSponsorship: null, travelSupport: null, housing: null },
      { free: true, applicationFee: null, participationFee: null, equityPercent: 7, timeCommitment: null, relocationRequired: null, notes: null },
      "en",
    );
    expect(f).toMatchObject({ money: "$20K", moneyKind: "prize", perks: ["Mentors"], free: true, fee: null, equityPercent: 7 });
    expect(benefitsFacts(null, null, "en")).toMatchObject({ money: null, summary: null, perks: [], free: null });
    expect(countryLabel("DE", "en")).toBe("Germany");
  });
});

describe("stored URLs", () => {
  it("keeps the host as served when asked (the link we store), strips it for dedupe keys", () => {
    expect(canonicalOpportunityUrl("https://www.example.org/jobs/1?utm_medium=x#top", { keepWww: true })).toBe("https://www.example.org/jobs/1");
    expect(canonicalOpportunityUrl("https://www.example.org/jobs/1?utm_medium=x#top")).toBe("https://example.org/jobs/1");
  });
});
