import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@/lib/core/types";
import { applyGapAnswer } from "@/lib/profile/gaps";
import { applicableSubGoals, defaultSubGoal, leadFamilies, retimeDefinition, snapHorizon, successOptions, successParams } from "@/lib/profile/success-params";

const NOW = new Date("2026-10-21T00:00:00Z");

describe("step 3 defaults", () => {
  it("pre-selects the lead family of the strongest identities", () => {
    expect(leadFamilies(["S2"])).toEqual(["G1"]);
    expect(leadFamilies(["F2", "E2"])).toEqual(["G3", "G1"]);
    expect(leadFamilies(["R2", "S4", "C1"])).toEqual(["G4", "G1"]);
    expect(leadFamilies([])).toEqual([]);
  });

  it("picks a sub-goal aimed at the person", () => {
    expect(defaultSubGoal("G1", ["S2"])).toBe("G1.2");
    expect(defaultSubGoal("G1", ["E2"])).toBe("G1.1");
    expect(defaultSubGoal("G3", ["F2"])).toBe("G3.2");
    expect(defaultSubGoal("G3", ["F1"])).toBe("G3.4");
    for (const s of applicableSubGoals("G1", ["S2"])) expect(s.family).toBe("G1");
  });

  it("fills success definitions only with what the profile knows", () => {
    expect(successParams(emptyProfile(), "en")).toEqual({});
    let p: Profile = { ...emptyProfile(), occupations: ["product-designer"], roles: [{ code: "E2", stage: null, since: null, inferred: false }] };
    p = applyGapAnswer(p, "jobSeeker.salary", ["b2"], { now: NOW }).profile;
    const params = successParams(p, "en");
    expect(params).toMatchObject({ role: "Product Designer", salary: 80000, currency: "USD" });
    const opts = successOptions("G1.1", p, 6, "en");
    expect(opts).toHaveLength(3);
    expect(opts[0]!.text).toBe("Get a full-time Product Designer offer within 6 months");
    expect(opts[1]!.text).toContain("$80,000");
    expect(successOptions("G1.1", emptyProfile(), 3, "zh")[0]!.text).toBe("3 个月内拿到全职 offer");
  });

  it("snaps horizons to 3, 6 or 12 months", () => {
    expect([1, 3, 4, 5, 6, 8, 9, 12, 24].map(snapHorizon)).toEqual([3, 3, 3, 6, 6, 6, 12, 12, 12]);
  });

  it("moves a success definition's deadline with the horizon", () => {
    expect(retimeDefinition("Get a full-time offer within 6 months", 12)).toBe("Get a full-time offer within 12 months");
    expect(retimeDefinition("Land an internship within 3 months", 1)).toBe("Land an internship within 1 month");
    expect(retimeDefinition("6 个月内拿到全职 offer", 3)).toBe("3 个月内拿到全职 offer");
    expect(retimeDefinition("Publish a first-author paper this year", 12)).toBe("Publish a first-author paper this year");
  });
});
