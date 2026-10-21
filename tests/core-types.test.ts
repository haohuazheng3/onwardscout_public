import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applicationAnswerSchema,
  applicationEvidenceSchema,
  applicationOutcomeSchema,
  applicationQuestionSchema,
  applyInfoSchema,
  authorizationScopeSchema,
  autoSubmitScope,
  countryCodeSchema,
  currencySchema,
  eligibilitySchema,
  emptyProfile,
  familyOfSubGoal,
  formFieldSchema,
  generatedContentSchema,
  goalConstraintsSchema,
  groupOfIdentity,
  localize,
  opportunityBenefitsSchema,
  opportunityCostSchema,
  opportunityGeoSchema,
  partialDateSchema,
  profileSchema,
  requirementsSchema,
  roleSchema,
  sourceConfigSchema,
  ventureSchema,
} from "@/lib/core";

describe("profile document", () => {
  it("parses an empty object into a complete, honest empty profile", () => {
    const p = emptyProfile();
    expect(p.identity.name).toBeNull();
    expect(p.identity.links).toEqual([]);
    expect(p.roles).toEqual([]);
    expect(p.packs).toEqual({});
    expect(p.summary).toBeNull();
    expect(profileSchema.parse({})).toEqual(p);
  });

  it("parses a realistic extracted profile and fills nested defaults", () => {
    const p = profileSchema.parse({
      identity: { name: "Lin Wei", countryCode: "cn", languages: [{ code: "zh", level: "native" }], links: [{ kind: "github", url: "https://github.com/lin" }] },
      roles: [{ code: "E2", stage: "open" }, { code: "F5", inferred: true }],
      functions: ["engineering"],
      experience: [{ id: "exp_1", organization: "Acme", title: "Backend Engineer", startDate: "2021-03", current: true }],
      packs: {
        founder: {
          ventures: [{ id: "v1", company: "Tiny Tools", stage: "bootstrapped", traction: { revenue: { amount: 4000, currency: "usd", period: "month" } } }],
        },
      },
    });
    expect(p.identity.countryCode).toBe("CN");
    expect(p.roles[1]).toEqual({ code: "F5", stage: null, since: null, inferred: true });
    expect(p.experience[0].highlights).toEqual([]);
    expect(p.packs.founder?.ventures[0].traction.revenue?.currency).toBe("USD");
    expect(p.packs.founder?.ventures[0].fundingHistory).toEqual([]);
  });

  it("rejects invalid identity codes, functions and dates", () => {
    expect(() => roleSchema.parse({ code: "Z9" })).toThrow();
    expect(() => profileSchema.parse({ functions: ["juggling"] })).toThrow();
    expect(partialDateSchema.safeParse("2024").success).toBe(true);
    expect(partialDateSchema.safeParse("2024-07").success).toBe(true);
    expect(partialDateSchema.safeParse("2024-07-31").success).toBe(true);
    expect(partialDateSchema.safeParse("2024-13").success).toBe(false);
    expect(partialDateSchema.safeParse("July 2024").success).toBe(false);
    expect(() => ventureSchema.parse({ id: "v", company: "" })).toThrow();
  });

  it("normalises currency and country codes", () => {
    expect(currencySchema.parse(" eur ")).toBe("EUR");
    expect(countryCodeSchema.parse("gb")).toBe("GB");
    expect(currencySchema.safeParse("dollars").success).toBe(false);
    expect(countryCodeSchema.safeParse("USA").success).toBe(false);
  });

  it("converts to JSON Schema for structured model output", () => {
    const schema = z.toJSONSchema(profileSchema, { io: "input" });
    expect(schema.type).toBe("object");
    expect(Object.keys((schema as { properties: object }).properties)).toContain("experience");
    expect(() => z.toJSONSchema(requirementsSchema, { io: "input" })).not.toThrow();
  });
});

describe("opportunity jsonb shapes", () => {
  it("keeps unknowns as null instead of guessing", () => {
    expect(opportunityBenefitsSchema.parse({})).toEqual({ summary: null, money: null, perks: [], visaSponsorship: null, travelSupport: null, housing: null });
    expect(opportunityCostSchema.parse({}).free).toBeNull();
    expect(eligibilitySchema.parse({}).degree).toBeNull();
    expect(opportunityGeoSchema.parse({})).toEqual({ countries: [], cities: [], remote: null, worldwide: false });
  });

  it("validates apply info, form fields and eligibility targets", () => {
    const apply = applyInfoSchema.parse({
      channel: "CH1",
      url: "https://boards.greenhouse.io/acme/jobs/123",
      ats: { provider: "greenhouse", board: "acme", postingId: "123" },
      fieldsSchema: [
        { name: "first_name", label: "First name", type: "text", required: true, profilePath: "/identity/name" },
        { name: "resume", label: "Resume", type: "file", accept: ".pdf,.docx" },
        { name: "visa", label: "Need sponsorship?", type: "select", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      ],
    });
    expect(apply.fieldsSchema[1].required).toBe(false);
    expect(apply.requiresAccount).toBe(false);
    expect(() => applyInfoSchema.parse({ channel: "CH9" })).toThrow();
    expect(() => formFieldSchema.parse({ name: "x", label: "X", type: "radio" })).toThrow();
    expect(eligibilitySchema.parse({ identities: ["ALL", "S", "F2"] }).identities).toEqual(["ALL", "S", "F2"]);
    expect(() => eligibilitySchema.parse({ identities: ["Q1"] })).toThrow();
  });

  it("accepts source configs for each source kind", () => {
    expect(sourceConfigSchema.parse({ board: "acme", orgName: "Acme", defaultType: "job", public: false }).board).toBe("acme");
    expect(sourceConfigSchema.parse({ selectors: { item: ".card", title: "h3" }, feedFormat: "rss", countries: ["us"] }).countries).toEqual(["US"]);
    expect(() => sourceConfigSchema.parse({ defaultType: "gig" })).toThrow();
  });
});

describe("application jsonb shapes", () => {
  it("validates gap questions, answers, evidence and outcomes", () => {
    const q = applicationQuestionSchema.parse({
      id: "q1",
      prompt: "Are you authorised to work in the UK?",
      kind: "choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      why: "The form requires it and your profile does not say.",
      profilePath: "/identity/workAuthorization",
    });
    expect(q.required).toBe(true);
    expect(() => applicationQuestionSchema.parse({ id: "q", prompt: "?", kind: "essay", why: "x" })).toThrow();
    expect(applicationAnswerSchema.parse({ value: ["a", "b"], source: "user" })).toEqual({ value: ["a", "b"], source: "user", factIds: [], confirmed: false, fileKey: null });
    expect(applicationEvidenceSchema.parse({ url: "https://x/confirm", channel: "CH6", userConfirmed: true }).screenshotKey).toBeNull();
    expect(applicationOutcomeSchema.parse({ result: "offer" }).lessons).toEqual([]);
    expect(() => applicationOutcomeSchema.parse({ result: "maybe" })).toThrow();
  });

  it("requires block-format generated content with fact ids", () => {
    const c = generatedContentSchema.parse({
      format: "blocks",
      blocks: [
        { type: "heading", text: "Why Acme" },
        { type: "paragraph", text: "I led the payments migration.", factIds: ["fct_1"] },
        { type: "field", label: "Years of experience", text: "5", factIds: ["fct_2"] },
        { type: "paragraph", text: "I am passionate about fintech.", flags: ["unsourced"] },
      ],
    });
    expect(c.blocks[0].factIds).toEqual([]);
    expect(c.blocks[3].flags).toEqual(["unsourced"]);
    expect(() => generatedContentSchema.parse({ format: "markdown", blocks: [] })).toThrow();
    expect(() => generatedContentSchema.parse({ format: "blocks", blocks: [{ type: "table", text: "x" }] })).toThrow();
  });

  it("validates goal constraints and authorization scopes", () => {
    const c = goalConstraintsSchema.parse({ geo: ["US", "Shanghai, CN"], remote: "remote_ok", salaryMin: 120000, currency: "usd", intensity: "steady" });
    expect(c.currency).toBe("USD");
    expect(c.opportunityTypes).toEqual([]);
    expect(() => goalConstraintsSchema.parse({ remote: "sometimes" })).toThrow();
    expect(authorizationScopeSchema.safeParse("auto_submit:accelerator").success).toBe(true);
    expect(authorizationScopeSchema.safeParse("auto_followup").success).toBe(true);
    expect(authorizationScopeSchema.safeParse("auto_submit:anything").success).toBe(false);
    expect(autoSubmitScope("scholarship")).toBe("auto_submit:scholarship");
  });

  it("derives groups and families from codes, and localizes", () => {
    expect(groupOfIdentity("C4")).toBe("C");
    expect(familyOfSubGoal("G10.3")).toBe("G10");
    expect(familyOfSubGoal("G1.10")).toBe("G1");
    expect(localize({ en: "Jobs", zh: "岗位" }, "zh")).toBe("岗位");
    expect(localize({ en: "Jobs", zh: "岗位" }, "de")).toBe("Jobs");
  });
});
