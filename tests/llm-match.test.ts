import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { localScoreMatches } from "@/lib/llm/local/match";
import { MatchScore, type OpportunityInput } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-10-21";
const designer = localExtractProfile({ documents: [{ id: "d", kind: "resume", filename: "r.txt", text: fx("resume-en.txt") }], locale: "en", now: NOW }).profile;
const founder = localExtractProfile({ documents: [{ id: "d", kind: "deck", filename: "d.txt", text: fx("deck-founder.txt") }], locale: "en", now: NOW }).profile;

const job: OpportunityInput = {
  id: "opp_fit",
  type: "job",
  name: "Senior Product Designer",
  orgName: "Juniper Clinics",
  summary: "Own our design system and patient intake flows. Figma, usability testing.",
  tags: ["figma", "design systems"],
  functions: ["design"],
  geo: { countries: ["US"], cities: ["Austin"], remote: "hybrid" },
  eligibility: { minYears: 5 },
  deadline: "2026-10-30",
};

describe("scoreMatches (local)", () => {
  const goals = [{ id: "gol_1", family: "G1", label: "Find a senior design role" }];

  it("scores a strong fit high with concrete reasons", () => {
    const [m] = localScoreMatches({ profile: designer, goals, opportunities: [job], now: NOW });
    MatchScore.parse(m);
    expect(m.eligible).toBe(true);
    expect(m.goalId).toBe("gol_1");
    expect(m.fit).toBeGreaterThanOrEqual(70);
    expect(m.reasons.join(" | ")).toMatch(/Matches your goal: Find a senior design role/);
    expect(m.reasons.join(" | ")).toMatch(/Uses your skills: .*Figma/);
    expect(m.reasons.join(" | ")).toMatch(/In Austin/);
    expect(m.reasons.join(" | ")).toMatch(/Deadline in 9 days/);
  });

  it("ranks a poor fit below a good one", () => {
    const poor: OpportunityInput = { id: "opp_poor", type: "job", name: "Staff Backend Engineer", orgName: "Rivet Systems", summary: "Go, Kubernetes, distributed databases", functions: ["engineering"], geo: { countries: ["DE"], remote: "onsite" } };
    const [good, bad] = localScoreMatches({ profile: designer, goals, opportunities: [job, poor], now: NOW });
    expect(bad.fit).toBeLessThan(good.fit - 25);
    expect(bad.gaps.join(" ")).toMatch(/Germany/);
  });

  it("applies hard eligibility filters with readable blockers", () => {
    const opps: OpportunityInput[] = [
      { id: "past", type: "job", name: "Designer", deadline: "2026-09-01" },
      { id: "founders", type: "accelerator", name: "Founder program", eligibility: { identities: ["F"] } },
      { id: "students", type: "internship", name: "Design intern", eligibility: { studentsOnly: true } },
      { id: "phd", type: "postdoc", name: "Postdoc", eligibility: { degree: "doctorate" } },
      { id: "newgrad", type: "graduate_program", name: "New grad", eligibility: { maxYears: 2 } },
      { id: "senior", type: "job", name: "Principal designer", eligibility: { minYears: 15 } },
    ];
    const r = Object.fromEntries(localScoreMatches({ profile: designer, goals, opportunities: opps, now: NOW }).map((m) => [m.opportunityId, m]));
    expect(r.past.blockers).toContain("The deadline has passed");
    expect(r.founders.blockers[0]).toMatch(/different group/);
    expect(r.students.blockers).toContain("Only open to current students");
    expect(r.phd.blockers[0]).toMatch(/higher degree/);
    expect(r.newgrad.blockers[0]).toMatch(/at most 2 years/);
    expect(r.senior.blockers[0]).toMatch(/15\+ years/);
    for (const m of Object.values(r)) {
      expect(m.eligible).toBe(false);
      expect(m.winProbability).toBe(0);
    }
  });

  it("respects a remote-only goal and lists missing materials as gaps", () => {
    const remoteGoal = [{ id: "g", family: "G1", constraints: { remote: "remote_only" } }];
    const [m] = localScoreMatches({ profile: designer, goals: remoteGoal, opportunities: [job], now: NOW });
    expect(m.eligible).toBe(false);
    const [acc] = localScoreMatches({
      profile: founder,
      goals: [{ id: "g3", family: "G3", sub: "G3.4" }],
      opportunities: [{ id: "acc", type: "accelerator", name: "Lanternfly", eligibility: { identities: ["F"], stages: ["pre_seed", "seed"] }, requiredMaterials: ["pitch_deck", "demo_video"], geo: { worldwide: true }, benefits: { money: { max: 150000, currency: "USD" } }, rolling: true }],
      now: NOW,
    });
    expect(acc.eligible).toBe(true);
    expect(acc.reasons.join(" | ")).toMatch(/Open to people like you/);
    expect(acc.reasons.join(" | ")).toMatch(/Right stage/);
    expect(acc.reasons.join(" | ")).toMatch(/Up to \$150K/);
    expect(acc.gaps).toContain("Record a short product demo");
    expect(acc.gaps).not.toContain("Upload your pitch deck");
  });

  it("writes reasons in Chinese when asked", () => {
    const [m] = localScoreMatches({ profile: designer, goals, opportunities: [job], language: "zh", now: NOW });
    expect(m.reasons.join(" ")).toMatch(/符合你的目标/);
  });
});
