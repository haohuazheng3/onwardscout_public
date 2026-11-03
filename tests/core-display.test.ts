import { describe, expect, it } from "vitest";
import { goalLabelFor, subGoalLabel } from "@/lib/core/goals";
import { buildMilestones, milestoneTitleFor } from "@/lib/core/playbooks";
import { renderSuccessDefinitions, successDefinitionFor } from "@/lib/core/success";
import { passForScope, STARTUP_PASS_TYPES } from "@/content/plans";

describe("names read in the reader's language", () => {
  it("a goal set in Chinese reads in English (and back); the person's own name is kept", () => {
    expect(goalLabelFor({ sub: "G1.1", label: subGoalLabel("G1.1", "zh") }, "en")).toBe(subGoalLabel("G1.1", "en"));
    expect(goalLabelFor({ sub: "G1.1", label: subGoalLabel("G1.1", "en") }, "zh")).toBe(subGoalLabel("G1.1", "zh"));
    expect(goalLabelFor({ sub: "G1.1", label: "Get into Stripe" }, "zh")).toBe("Get into Stripe");
    expect(goalLabelFor({ sub: null, label: "Mine" }, "en")).toBe("Mine");
  });

  it("our milestone titles follow the locale with their own target; edited titles stay", () => {
    const planned = buildMilestones("G1", { intensity: "steady", horizonMonths: 6, sub: "G1.9" });
    for (const m of planned) {
      const stored = { title: m.title.zh, target: m.target, position: m.position };
      expect(milestoneTitleFor(stored, { family: "G1", sub: "G1.9" }, "en")).toBe(m.title.en);
    }
    expect(milestoneTitleFor({ title: "My own step", target: 3, position: 0 }, { family: "G1", sub: "G1.1" }, "zh")).toBe("My own step");
  });
});

describe("success definitions in the reader's language", () => {
  it("our template reads in the locale (any horizon); an edited one stays", () => {
    const zh = renderSuccessDefinitions("G8.3", { months: 6 }, "zh")[0].text;
    const en = renderSuccessDefinitions("G8.3", { months: 6 }, "en")[0].text;
    expect(successDefinitionFor({ sub: "G8.3", successDefinition: zh, horizonMonths: 6 }, "en")).toBe(en);
    expect(successDefinitionFor({ sub: "G8.3", successDefinition: en, horizonMonths: 12 }, "zh")).toBe(zh);
    expect(successDefinitionFor({ sub: "G8.3", successDefinition: "Win a hackathon in Detroit", horizonMonths: 6 }, "zh")).toBe("Win a hackathon in Detroit");
  });
});

describe("season pass from a lot's scope", () => {
  it("finds the pass whatever the order of its types", () => {
    expect(passForScope(["returnship"])).toBe("season_returnship");
    expect(passForScope([...STARTUP_PASS_TYPES].reverse())).toBe("season_startup");
    expect(passForScope([])).toBeNull();
    expect(passForScope(["job"])).toBeNull();
  });
});
