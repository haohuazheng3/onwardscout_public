import { describe, expect, it } from "vitest";
import { localRecommendDirections, profileSummary } from "@/lib/llm/local/directions";
import { mockIntelligence } from "@/lib/llm/provider-mock";
import { emptyProfile, type IdentityCode, type Profile } from "@/lib/core/types";
import type { DirectionCandidate } from "@/lib/llm/types";

/* After the questions, Onward Scout works out where the person should go (the dashboard plans from this). */

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
  }));
}

function person(code: IdentityCode, stage: string | null = null, extra: Partial<Profile> = {}): Profile {
  return { ...emptyProfile(), roles: [{ code, stage, since: null, inferred: false }], ...extra };
}

const ids = (p: Profile, open?: Record<string, number>) => localRecommendDirections({ profile: p, candidates: candidates(p.roles.map((r) => r.code), open), language: "en" }).directions.map((d) => d.id);

describe("where a person should go", () => {
  it("points students at internships and scholarships, and final-year students at jobs and graduate programs", () => {
    expect(ids(person("S2", "year_2")).slice(0, 2)).toEqual(expect.arrayContaining(["internship", "scholarship"]));
    expect(ids(person("S2", "year_4_plus"))).toEqual(expect.arrayContaining(["graduate"]));
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
