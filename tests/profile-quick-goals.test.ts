import { describe, expect, it } from "vitest";
import { getSubGoal } from "@/lib/core/goals";
import { emptyProfile } from "@/lib/core/types";
import { applyGapAnswer } from "@/lib/profile/gaps";
import { OTHER_GOAL, QUICK_GOALS, isJobGoal, quickGoalById, quickGoalsFor } from "@/lib/profile/quick-goals";
import { successOptions } from "@/lib/profile/success-params";

describe("onboarding goal question", () => {
  it("offers only real sub-goals, each with a default success definition", () => {
    for (const g of [...QUICK_GOALS, OTHER_GOAL]) {
      expect(getSubGoal(g.sub).family, g.id).toBe(g.family);
      expect(successOptions(g.sub, emptyProfile(), 6, "en")[0]?.text.length ?? 0, g.id).toBeGreaterThanOrEqual(3);
      expect(quickGoalById(g.id)).toBe(g);
    }
  });

  it("puts goals open to the person first and keeps every option reachable", () => {
    const student = quickGoalsFor(["S2"]);
    expect(student.first.map((g) => g.id)).toContain("internship");
    expect(student.first.map((g) => g.id)).not.toContain("investors");
    const founder = quickGoalsFor(["F2"]);
    expect(founder.first.map((g) => g.id).slice(0, 4)).toEqual(expect.arrayContaining(["accelerator", "investors"]));
    for (const codes of [[], ["S2"], ["E2"], ["F2"], ["R1"], ["C5"], ["S1"]] as const) {
      const { first, more } = quickGoalsFor(codes as never);
      expect(first.length).toBeGreaterThan(0);
      expect(new Set([...first, ...more].map((g) => g.id)).size).toBe(QUICK_GOALS.length + 1);
      expect(more.at(-1)).toBe(OTHER_GOAL);
    }
  });

  it("asks the role and remote questions only for job goals", () => {
    expect(QUICK_GOALS.filter((g) => isJobGoal(g.sub)).map((g) => g.id)).toEqual(["job", "internship", "graduate"]);
  });

  it("takes any occupation as the target role, even before there is anything to suggest", () => {
    const r = applyGapAnswer(emptyProfile(), "jobSeeker.targetRole", ["software-engineer"], { locale: "en" });
    expect(r.profile.packs.jobSeeker?.targetOccupations).toEqual(["software-engineer"]);
    expect(() => applyGapAnswer(emptyProfile(), "jobSeeker.targetRole", ["not_a_real_role"])).toThrow();
  });
});
