import { describe, expect, it } from "vitest";
import { profileSchema } from "@/lib/core/types";
import { eligibilityChecklist } from "@/lib/opportunities/eligibility";
import { anyOfQuery, countryFromGeo, geoConstraint, identityTargets, profileTerms } from "@/lib/opportunities/prefilter";
import {
  DEFAULT_TYPE_CAP,
  RANK_WEIGHTS,
  candidateTypes,
  combineScore,
  daysUntil,
  deadlineProximity,
  diversify,
  effectiveChannel,
  goalWeights,
  interleaveByGoal,
  repeatKey,
  feedbackPenalty,
  feedbackSignals,
  goalPlanTypes,
  milestoneAlignment,
  playbookPriority,
  rankCandidates,
  varietyLimits,
  yourMinutes,
  EMPTY_SIGNALS,
  type GoalPlan,
  type RankContext,
  type RankInput,
} from "@/lib/opportunities/ranking";

const NOW = new Date("2026-10-21T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function input(over: Partial<RankInput> = {}): RankInput {
  return {
    opportunityId: over.opportunityId ?? "opp_a",
    type: "job",
    channel: "CH1",
    deadline: null,
    rolling: false,
    countries: [],
    industries: [],
    remoteOrWorldwide: false,
    pinned: false,
    goalId: null,
    fit: 60,
    winProbability: 0.1,
    effort: 20,
    value: 60,
    eligible: true,
    ...over,
  };
}

const ctx = (over: Partial<RankContext> = {}): RankContext => ({ now: NOW, plans: [], signals: EMPTY_SIGNALS, ...over });

describe("goal plans", () => {
  it("puts a sub-goal's own types first, in playbook order", () => {
    expect(goalPlanTypes({ family: "G1", sub: "G1.1" })).toEqual(["job", "remote_job"]);
    expect(goalPlanTypes({ family: "G1", sub: "G1.2" })).toEqual(["internship"]);
  });

  it("falls back to the family playbook without a sub-goal", () => {
    const types = goalPlanTypes({ family: "G1", sub: null });
    expect(types[0]).toBe("job");
    expect(types).toContain("internship");
  });

  it("lets the person's own type override win", () => {
    expect(goalPlanTypes({ family: "G1", sub: "G1.1", constraints: { opportunityTypes: ["internship", "hackathon"] } })).toEqual(["internship", "hackathon"]);
  });

  it("treats custom goals and unknown families as 'any type'", () => {
    expect(goalPlanTypes({ family: "G12", sub: "G12.1" })).toEqual([]);
    expect(goalPlanTypes({ family: "nope" })).toEqual([]);
  });

  it("builds the candidate type filter from every goal, never including practice", () => {
    expect(candidateTypes([])).toBeNull();
    expect(candidateTypes([{ types: ["job"] }, { types: [] }])).toBeNull();
    expect(candidateTypes([{ types: ["job", "remote_job"] }, { types: ["grant", "job", "practice"] }])).toEqual(["job", "remote_job", "grant"]);
  });

  it("derives variety limits from the playbook, with defaults when there is no goal", () => {
    expect(varietyLimits([])).toEqual({ typeCap: DEFAULT_TYPE_CAP, window: 10 });
    const v = varietyLimits([{ family: "G1", constraints: { intensity: "steady" } }]);
    expect(v.typeCap).toBeGreaterThanOrEqual(2);
    expect(v.window).toBeGreaterThan(v.typeCap);
  });
});

describe("ranking parts", () => {
  const plan: GoalPlan = { goalId: "gol_1", family: "G1", types: ["job", "remote_job", "internship"], milestoneMetric: "applications" };

  it("scores playbook priority from first to last type", () => {
    expect(playbookPriority("job", plan)).toBe(1);
    expect(playbookPriority("internship", plan)).toBeCloseTo(0.2);
    expect(playbookPriority("grant", plan)).toBe(0.1);
    expect(playbookPriority("job", null)).toBe(0.5);
    expect(playbookPriority("job", { types: ["job"] })).toBe(1);
  });

  it("aligns candidates with the current milestone", () => {
    expect(milestoneAlignment({ type: "job", channel: "CH1", winProbability: 0.1 }, plan)).toBe(1);
    expect(milestoneAlignment({ type: "grant", channel: "CH2", winProbability: 0.1 }, plan)).toBe(0.2);
    const meetings = { ...plan, types: ["investor", "pitch_event", "accelerator"] as GoalPlan["types"], milestoneMetric: "meetings" as const };
    expect(milestoneAlignment({ type: "investor", channel: "CH4", winProbability: 0 }, meetings)).toBe(1);
    expect(milestoneAlignment({ type: "accelerator", channel: "CH2", winProbability: 0 }, meetings)).toBe(0.5);
    const offers = { ...plan, milestoneMetric: "offers" as const };
    expect(milestoneAlignment({ type: "job", channel: "CH1", winProbability: 0.3 }, offers)).toBe(1);
    expect(milestoneAlignment({ type: "job", channel: "CH1", winProbability: 0 }, offers)).toBe(0.5);
    expect(milestoneAlignment({ type: "job", channel: "CH1", winProbability: 0 }, { ...plan, milestoneMetric: null })).toBe(0.5);
  });

  it("prefers deadlines two to three weeks out", () => {
    expect(deadlineProximity(days(10), false, NOW)).toBe(1);
    expect(deadlineProximity(days(2), false, NOW)).toBe(0.75);
    expect(deadlineProximity(days(-1), false, NOW)).toBe(0);
    expect(deadlineProximity(days(40), false, NOW)).toBeLessThan(1);
    expect(deadlineProximity(days(40), false, NOW)).toBeGreaterThan(0.5);
    expect(deadlineProximity(days(200), false, NOW)).toBe(0.4);
    expect(deadlineProximity(null, true, NOW)).toBe(0.5);
    expect(deadlineProximity(null, false, NOW)).toBe(0.35);
    expect(daysUntil(days(3), NOW)).toBe(3);
    expect(daysUntil(null, NOW)).toBeNull();
  });

  it("estimates the person's own minutes by channel", () => {
    expect(yourMinutes({ channel: "CH1" })).toBe(2);
    expect(yourMinutes({ channel: "CH1", requiresAccount: true })).toBe(5);
    expect(yourMinutes({ channel: "CH6", requiresAccount: true })).toBe(12);
    expect(yourMinutes({ channel: "CH4", requiresAccount: true })).toBe(2);
    expect(yourMinutes({ channel: "CH2", requiresPayment: true, gaps: 9 })).toBe(2 + 2 + 9);
  });

  it("uses the opportunity's channel, else its type's default", () => {
    expect(effectiveChannel("job", "CH6")).toBe("CH6");
    expect(effectiveChannel("investor", null)).toBe("CH4");
    expect(effectiveChannel("job", "CH9")).toBe("CH1");
    expect(effectiveChannel("not_a_type", undefined)).toBe("CH6");
  });
});

describe("feedback learning", () => {
  const rows = [
    { type: "job", countries: ["US"], industries: ["finance"], feedback: "not_interested" as const, reason: "wrong_location" },
    { type: "job", countries: ["US"], industries: ["finance"], feedback: "not_interested" as const, reason: "not_my_field" },
    { type: "hackathon", countries: [], industries: [], feedback: "not_interested" as const, reason: "not_this_type" },
    { type: "grant", countries: ["DE"], industries: [], feedback: "later" as const, reason: null },
  ];
  const signals = feedbackSignals(rows);

  it("learns penalties from Not interested only", () => {
    expect(signals.type.hackathon).toBeCloseTo(0.19);
    expect(signals.type.job).toBeCloseTo(0.08);
    expect(signals.type.grant).toBeUndefined();
    expect(signals.country.US).toBeCloseTo(0.2);
    expect(signals.field.finance).toBeCloseTo(0.15);
  });

  it("never penalises remote or worldwide roles for location, and caps the total", () => {
    expect(feedbackPenalty({ type: "job", countries: ["US"], industries: [], remoteOrWorldwide: true }, signals)).toBeCloseTo(0.08);
    expect(feedbackPenalty({ type: "job", countries: ["US"], industries: [], remoteOrWorldwide: false }, signals)).toBeCloseTo(0.28);
    const heavy = feedbackSignals(Array.from({ length: 10 }, () => ({ type: "job", countries: ["US"], industries: ["finance"], feedback: "not_interested" as const, reason: "not_this_type" })));
    expect(feedbackPenalty({ type: "job", countries: ["US"], industries: ["finance"], remoteOrWorldwide: false }, heavy)).toBeLessThanOrEqual(0.7);
  });
});

describe("combineScore", () => {
  it("has weights that sum to one", () => {
    expect(Object.values(RANK_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("rewards fit, value, a good deadline and less of the person's time", () => {
    const base = combineScore(input(), ctx()).score;
    expect(combineScore(input({ fit: 90 }), ctx()).score).toBeGreaterThan(base);
    expect(combineScore(input({ value: 90 }), ctx()).score).toBeGreaterThan(base);
    expect(combineScore(input({ deadline: days(12) }), ctx()).score).toBeGreaterThan(base);
    expect(combineScore(input({ effort: 80 }), ctx()).score).toBeLessThan(base);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThanOrEqual(100);
  });

  it("follows the goal's playbook order and the feedback penalty", () => {
    const plans: GoalPlan[] = [{ goalId: "gol_1", family: "G1", types: ["internship", "job"], milestoneMetric: "applications" }];
    const intern = combineScore(input({ type: "internship", goalId: "gol_1" }), ctx({ plans })).score;
    const job = combineScore(input({ type: "job", goalId: "gol_1" }), ctx({ plans })).score;
    expect(intern).toBeGreaterThan(job);
    const penalised = combineScore(input({ type: "job" }), ctx({ signals: { type: { job: 0.4 }, country: {}, field: {} } }));
    expect(penalised.parts.penalty).toBeCloseTo(0.4);
    expect(penalised.score).toBeLessThan(combineScore(input({ type: "job" }), ctx()).score);
  });
});

describe("diversify", () => {
  const list = (types: string[]) => types.map((type, i) => ({ type, id: i }));

  it("keeps at most `cap` of one type in any window", () => {
    const out = diversify(list(["job", "job", "job", "job", "grant", "grant", "event"]), 2, 4);
    for (let i = 0; i < out.length; i++) {
      const window = out.slice(Math.max(0, i - 3), i + 1);
      if (out.length - i > 2) expect(window.filter((x) => x.type === "job").length).toBeLessThanOrEqual(2);
    }
    expect(out.slice(0, 3).map((x) => x.type)).toEqual(["job", "job", "grant"]);
    expect(out).toHaveLength(7);
  });

  it("is stable when nothing needs moving and still places everything when one type is all there is", () => {
    expect(diversify(list(["a", "b", "c"]), 2, 4).map((x) => x.id)).toEqual([0, 1, 2]);
    expect(diversify(list(["a", "a", "a", "a"]), 1, 3).map((x) => x.id)).toEqual([0, 1, 2, 3]);
    expect(diversify(list(["a", "a"]), 0, 3).map((x) => x.id)).toEqual([0, 1]);
  });
});

describe("rankCandidates", () => {
  it("drops ineligible candidates, pins the person's own links, numbers from 1 and respects the limit", () => {
    const inputs = [
      input({ opportunityId: "opp_low", fit: 30 }),
      input({ opportunityId: "opp_high", fit: 95 }),
      input({ opportunityId: "opp_blocked", fit: 99, eligible: false }),
      input({ opportunityId: "opp_mine", fit: 10, pinned: true, eligible: false }),
      input({ opportunityId: "opp_mid", fit: 60 }),
    ];
    const ranked = rankCandidates(inputs, ctx(), { limit: 2 });
    expect(ranked.map((r) => [r.opportunityId, r.rank])).toEqual([
      ["opp_mine", 0],
      ["opp_high", 1],
      ["opp_mid", 2],
    ]);
  });

  it("keeps extra fields of the inputs", () => {
    const ranked = rankCandidates([{ ...input(), reasons: ["x"] }], ctx());
    expect(ranked[0].reasons).toEqual(["x"]);
    expect(ranked[0].score).toBeGreaterThan(0);
  });
});

describe("sharing the board between goals", () => {
  it("takes turns by weight and keeps each goal's own order", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({ goalId: "jobs", id: `j${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ goalId: "funding", id: `f${i}` })),
    ];
    const out = interleaveByGoal(items, { jobs: 2, funding: 1 }).map((x) => x.id);
    expect(out.slice(0, 6)).toEqual(["j0", "f0", "j1", "j2", "f1", "j3"]);
    expect(out).toHaveLength(9);
    expect(out.filter((x) => x.startsWith("j"))).toEqual(["j0", "j1", "j2", "j3", "j4", "j5"]);
  });

  it("leaves a single bucket alone and gives unclaimed picks half the lightest weight", () => {
    const one = [{ goalId: "a", id: 1 }, { goalId: "a", id: 2 }];
    expect(interleaveByGoal(one, { a: 3 })).toEqual(one);
    const mixed = interleaveByGoal(
      [{ goalId: "a", id: 1 }, { goalId: "a", id: 2 }, { goalId: "a", id: 3 }, { goalId: null, id: 4 }],
      { a: 2 },
    ).map((x) => x.id);
    expect(mixed).toEqual([1, 4, 2, 3]);
  });

  it("weighs goals by their playbook quota", () => {
    const w = goalWeights([{ id: "g1", family: "G1", constraints: { intensity: "intense" } }, { id: "g2", family: "G8", constraints: { intensity: "light" } }, { id: "g3", family: "nope" }]);
    expect(w.g1).toBeGreaterThan(w.g2);
    expect(w.g3).toBe(5);
  });

  it("keeps only the best copy of a repeated posting, and shares slots in rankCandidates", () => {
    const k = repeatKey("ClickHouse", "Senior  Engineer");
    expect(k).toBe(repeatKey(" clickhouse ", "senior engineer"));
    const ranked = rankCandidates(
      [
        input({ opportunityId: "opp_1", fit: 90, goalId: "g1", dedupeKey: k }),
        input({ opportunityId: "opp_2", fit: 80, goalId: "g1", dedupeKey: k }),
        input({ opportunityId: "opp_3", fit: 85, goalId: "g1" }),
        input({ opportunityId: "opp_4", fit: 20, goalId: "g2", type: "grant" }),
      ],
      ctx(),
      { goalWeights: { g1: 1, g2: 1 } },
    );
    expect(ranked.map((r) => r.opportunityId)).toEqual(["opp_1", "opp_4", "opp_3"]);
  });
});

describe("prefilter inputs", () => {
  const profile = profileSchema.parse({
    roles: [{ code: "E2" }, { code: "F1" }],
    identity: { headline: "Backend engineer, payments" },
    skills: [{ name: "TypeScript" }, { name: "Postgres" }, { name: "Go" }],
    experience: [{ id: "exp_1", organization: "Acme", title: "Senior Software Engineer" }],
  });

  it("lists the audience values that include the person", () => {
    expect(identityTargets(profile)).toEqual(["ALL", "E", "F", "E2", "F1"]);
    expect(identityTargets(profileSchema.parse({}))).toEqual([]);
  });

  it("reads country codes from goal geo entries", () => {
    expect(countryFromGeo("us")).toBe("US");
    expect(countryFromGeo("Berlin, DE")).toBe("DE");
    expect(countryFromGeo("Berlin")).toBeNull();
  });

  it("limits places only when every goal does", () => {
    expect(geoConstraint([])).toEqual({ remoteOnly: false, countries: null });
    expect(geoConstraint([{ constraints: { geo: ["US", "London, GB"] } }])).toEqual({ remoteOnly: false, countries: ["US", "GB"] });
    expect(geoConstraint([{ constraints: { geo: ["US"] } }, { constraints: { geo: [] } }]).countries).toBeNull();
    expect(geoConstraint([{ constraints: { remote: "remote_only" } }, { constraints: { remote: "remote_ok" } }]).remoteOnly).toBe(false);
    expect(geoConstraint([{ constraints: { remote: "remote_only" } }]).remoteOnly).toBe(true);
  });

  it("turns the profile into search terms and an OR query", () => {
    const terms = profileTerms(profile);
    expect(terms).toContain("senior software engineer");
    expect(terms).toContain("typescript");
    expect(terms).toContain("backend engineer, payments");
    expect(anyOfQuery(["go", "senior software engineer"])).toBe('go OR "senior software engineer"');
    expect(anyOfQuery([])).toBeNull();
  });
});

describe("eligibility checklist", () => {
  const student = profileSchema.parse({
    roles: [{ code: "S3", stage: "final_year" }],
    identity: { countryCode: "CN", languages: [{ code: "en" }, { code: "zh" }], birthYear: 2003, workAuthorization: [{ countryCode: "CN", status: "citizen" }] },
    education: [{ id: "edu_1", institution: "Fudan University", level: "bachelor", current: true }],
  });

  it("checks each stated rule against the profile in plain statuses", () => {
    const list = eligibilityChecklist(
      {
        eligibility: {
          identities: ["S"],
          stages: [],
          degree: "bachelor",
          minYears: null,
          maxYears: null,
          nationality: ["US"],
          residency: [],
          ageMin: null,
          ageMax: 30,
          studentsOnly: true,
          companyMaxAgeYears: null,
          notes: "Teams of up to four.",
        },
        geo: { countries: ["US"], cities: ["Boston"], remote: "onsite", worldwide: false },
        languages: ["en"],
      },
      student,
      "en",
      NOW,
    );
    const by = Object.fromEntries(list.map((c) => [c.key, c.status]));
    expect(by).toEqual({ who: "yes", degree: "unknown", nationality: "no", age: "yes", students: "yes", location: "unknown", language: "yes", notes: "unknown" });
    expect(list.find((c) => c.key === "who")?.values.who).toBe("students");
  });

  it("says nothing it can't check, and marks unknowns as '?'", () => {
    expect(eligibilityChecklist({ eligibility: null }, profileSchema.parse({}), "en", NOW)).toEqual([]);
    const list = eligibilityChecklist(
      { eligibility: { identities: ["F"], stages: ["seed"], degree: null, minYears: 3, maxYears: null, nationality: [], residency: [], ageMin: null, ageMax: null, studentsOnly: null, companyMaxAgeYears: 5, notes: null } },
      profileSchema.parse({}),
      "zh",
      NOW,
    );
    expect(list.map((c) => c.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(list.find((c) => c.key === "who")?.values.who).toBe("创业者");
  });
});
