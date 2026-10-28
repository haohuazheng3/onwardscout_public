import { describe, expect, it } from "vitest";
import { finishPlan, localRecommendDirections, profileSummary } from "@/lib/llm/local/directions";
import { mockIntelligence } from "@/lib/llm/provider-mock";
import { emptyProfile, type IdentityCode, type Profile } from "@/lib/core/types";
import type { DirectionCandidate, LifePath } from "@/lib/llm/types";
import { OTHER_GOAL, QUICK_GOALS } from "@/lib/profile/quick-goals";

/* After the questions, Onward Scout plans the person's path (the dashboard shows the plan). */

const PATHS: Record<string, LifePath[]> = Object.fromEntries([...QUICK_GOALS, OTHER_GOAL].map((g) => [g.id, [...g.paths]]));

const OPEN: Record<string, number> = { job: 4000, internship: 900, graduate: 16, scholarship: 46, fellowship: 52, accelerator: 65, investors: 11, pitch: 32, phd: 18, grant: 29, cfp: 44, art: 40, hackathon: 20, other: 34000 };
const AUDIENCE: Record<string, string[]> = { job: ["E", "T", "S5", "P"], internship: ["S"], graduate: ["S"], scholarship: ["S"], fellowship: ["ALL"], accelerator: ["F"], investors: ["F2", "F3"], pitch: ["F", "S", "R"], phd: ["S3", "S4", "R1"], grant: ["R"], cfp: ["R", "S4"], art: ["C1", "C2", "C5"], hackathon: ["S", "C", "F"], other: ["ALL"] };

function candidates(codes: string[], open: Record<string, number> = OPEN): DirectionCandidate[] {
  return Object.keys(OPEN).map((id) => ({
    id,
    family: "G1",
    sub: "G1.1",
    label: id,
    opportunityTypes: [],
    open: open[id] ?? 0,
    forThem: AUDIENCE[id]!.some((a) => a === "ALL" || codes.some((c) => c === a || c.charAt(0) === a)),
    field: id === "job" || id === "internship" ? "Data" : null,
    paths: PATHS[id]!,
  }));
}

function person(code: IdentityCode, stage: string | null = null, extra: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), roles: [{ code, stage, since: null, inferred: false }], ...extra };
}

const planFor = (p: Profile, opts: { open?: Record<string, number>; path?: LifePath; language?: "en" | "zh" } = {}) =>
  localRecommendDirections({ profile: p, candidates: candidates(p.roles.map((r) => r.code), opts.open), language: opts.language ?? "en", preferredPath: opts.path ?? null });
const ids = (p: Profile, open?: Record<string, number>) => planFor(p, { open }).directions.map((d) => d.id);

describe("where a person should go", () => {
  it("puts students on the work path with internships first, final-year students on graduate programs", () => {
    const plan = planFor(person("S2", "year_2"));
    expect(plan.path).toBe("work");
    expect(plan.directions[0]!.id).toBe("internship");
    expect(ids(person("S2", "year_4_plus"))).toEqual(expect.arrayContaining(["graduate"]));
    // The compass still shows that study (scholarships) fits too.
    expect(plan.pathScores.find((x) => x.path === "study")!.score).toBeGreaterThan(0.3);
  });

  it("chooses the path from the strongest directions: founders startup, researchers research, artists create, professionals work", () => {
    expect(planFor(person("F2")).path).toBe("startup");
    expect(planFor(person("R2", null, { publications: [{} as never, {} as never] })).path).toBe("research");
    expect(planFor(person("C5")).path).toBe("create");
    expect(planFor(person("E2")).path).toBe("work");
    expect(planFor(emptyProfile()).path).toBe("explore");
  });

  it("follows the path the person chose, with that path's directions only", () => {
    const plan = planFor(person("S3", "first_year", { functions: ["data"] }), { path: "research" });
    expect(plan.path).toBe("research");
    expect(plan.directions.length).toBeGreaterThan(0);
    for (const d of plan.directions) expect(PATHS[d.id]).toContain("research");
  });

  it("lays out a roadmap inside the horizon, strengths from the profile, and the gaps that matter", () => {
    const p = person("S3", "first_year", {
      functions: ["data"],
      education: [{ id: "e1", institution: "Fudan University", degree: null, level: "master", field: "Statistics", location: null, startDate: "2025-09", endDate: "2027-06", current: true, gpa: null, honors: [], courses: [] , description: null }],
    });
    const plan = planFor(p);
    expect(plan.headline.length).toBeGreaterThan(5);
    expect([3, 6, 12]).toContain(plan.horizonMonths);
    expect(plan.roadmap.length).toBeGreaterThanOrEqual(3);
    for (const st of plan.roadmap) {
      expect(st.startMonth).toBeGreaterThanOrEqual(0);
      expect(st.endMonth).toBeLessThanOrEqual(plan.horizonMonths);
      expect(st.endMonth).toBeGreaterThan(st.startMonth);
    }
    expect(plan.strengths[0]!.evidence).toContain("Fudan University");
    expect(plan.gaps.map((g) => g.action)).toContain("add_skills");
    expect(planFor(emptyProfile()).gaps.map((g) => g.action)).toContain("upload_resume");
  });

  it("points founders at accelerators and investors, researchers at grants and calls for papers, artists at residencies", () => {
    expect(ids(person("F2")).slice(0, 2)).toEqual(expect.arrayContaining(["accelerator", "investors"]));
    expect(ids(person("R2", null, { publications: [{} as never, {} as never] }))).toEqual(expect.arrayContaining(["grant", "cfp"]));
    expect(ids(person("C5"))[0]).toBe("art");
    expect(ids(person("E2"))[0]).toBe("job");
  });

  it("never suggests a direction with nothing open, and falls back to everything that fits", () => {
    expect(ids(person("F2"), { ...OPEN, accelerator: 0, investors: 0 })).not.toEqual(expect.arrayContaining(["accelerator"]));
    expect(ids(emptyProfile())).toEqual(["other"]);
  });

  it("checks a model's plan against the candidates and fills what is missing", () => {
    const input = { profile: person("S3", "first_year", { functions: ["data"] }), candidates: candidates(["S3"], { ...OPEN, graduate: 0 }), language: "en" as const, preferredPath: null };
    const plan = finishPlan(
      {
        summary: "A master's student in Data.",
        path: "work",
        headline: "x".repeat(200),
        horizonMonths: 5,
        // unknown id, nothing open, another path's direction, a duplicate, then one real one
        directions: [
          { id: "made-up", reason: "r", strength: 1 },
          { id: "graduate", reason: "r", strength: 1 },
          { id: "phd", reason: "r", strength: 1 },
          { id: "internship", reason: "Internships fit you.", strength: 2 },
          { id: "internship", reason: "again", strength: 1 },
        ],
        roadmap: [{ title: "Only one stage", detail: "", startMonth: 0, endMonth: 40 }],
        strengths: [],
        gaps: [],
      },
      input,
    );
    expect(plan.directions).toEqual([{ id: "internship", reason: "Internships fit you.", strength: 1 }]);
    expect(plan.headline.length).toBeLessThanOrEqual(80);
    expect(plan.horizonMonths).toBe(6);
    expect(plan.roadmap.length).toBeGreaterThanOrEqual(3);
    expect(plan.pathScores).toHaveLength(5);
    // A path the person chose wins over the model's.
    expect(finishPlan({ path: "work", directions: [] }, { ...input, preferredPath: "study" }).path).toBe("study");
  });

  it("gives at most three, each with a reason that cites the count, in the person's language", () => {
    const plan = localRecommendDirections({ profile: person("S3", "first_year", { functions: ["data"] }), candidates: candidates(["S3"]), language: "zh" });
    expect(plan.directions.length).toBeLessThanOrEqual(3);
    for (const d of plan.directions) expect(d.reason).toMatch(/\d/);
    expect(plan.summary).toContain("硕士");
  });

  it("names a field only when the count was taken in it", () => {
    const plan = localRecommendDirections({ profile: person("E1", null, { functions: ["data"] }), candidates: candidates(["E1"]), language: "en" });
    expect(plan.directions.find((d) => d.id === "job")?.reason).toContain("in Data");
  });

  it("sums up where the person stands from facts only", () => {
    const p = person("S3", null, { functions: ["data"], identity: { ...emptyProfile().identity, city: "Shanghai" } });
    expect(profileSummary(p, "en")).toBe("You're a master's student in Data, based in Shanghai.");
  });

  it("the mock engine only picks open directions in the person's audience", async () => {
    const plan = await mockIntelligence.recommendDirections({ profile: person("S2"), candidates: candidates(["S2"]), language: "en" });
    expect(plan.directions.length).toBeGreaterThan(0);
    expect(plan.directions.every((d) => d.id !== "investors")).toBe(true);
  });
});
