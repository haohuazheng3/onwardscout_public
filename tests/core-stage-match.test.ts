import { describe, expect, it } from "vitest";
import { normalizeStage, stageVerdict } from "@/lib/core/stage-match";
import type { IdentityCode, Profile } from "@/lib/core/types";

const person = (roles: [IdentityCode, string | null][], ventures: (string | null)[] = []) =>
  ({
    roles: roles.map(([code, stage]) => ({ code, stage, since: null })),
    packs: ventures.length ? { founder: { ventures: ventures.map((stage) => ({ stage })) } } : {},
  }) as unknown as Pick<Profile, "roles" | "packs">;

describe("stage verdict", () => {
  it("reads curated words and profile ids as one vocabulary", () => {
    expect(normalizeStage("Pre-seed")).toBe("pre_seed");
    expect(stageVerdict(["pre-seed", "seed"], person([["F2", "pre_seed"]]))).toBe("match");
    expect(stageVerdict(["early-career", "mid-career"], person([["R2", "early_career"]]))).toBe("match");
    expect(stageVerdict(["series-b"], person([["F3", "series_b_plus"]]))).toBe("match");
  });

  it("matches education levels from the identity code alone", () => {
    expect(stageVerdict(["undergraduate"], person([["S2", "year_3"]]))).toBe("match");
    expect(stageVerdict(["phd", "postdoc"], person([["S4", "candidate"]]))).toBe("match");
    expect(stageVerdict(["masters"], person([["S3", "final_year"]]))).toBe("match");
  });

  it("excludes only a clear mismatch in a domain the person belongs to", () => {
    expect(stageVerdict(["phd", "postdoc"], person([["S2", "year_3"]]))).toBe("mismatch");
    expect(stageVerdict(["idea", "pre-seed"], person([["F2", "seed"]]))).toBe("mismatch");
    expect(stageVerdict(["early-career"], person([["E2", "actively_looking"]]))).toBe("mismatch");
  });

  it("leaves lists in another domain to the person instead of filtering them out", () => {
    expect(stageVerdict(["early-career", "mid-career"], person([["S3", "first_year"]]))).toBe("unknown");
    expect(stageVerdict(["emerging", "established"], person([["C5", "full_time"]]))).toBe("unknown");
    expect(stageVerdict(["seed"], person([]))).toBe("unknown");
  });

  it("treats 'any' and an empty list as no requirement, and an MVP as idea or pre-seed", () => {
    expect(stageVerdict(["any"], person([["E1", null]]))).toBe("match");
    expect(stageVerdict([], person([]))).toBe("match");
    expect(stageVerdict(["idea", "pre-seed"], person([["F2", "mvp"]]))).toBe("match");
    expect(stageVerdict(["seed"], person([["F2", null]], ["seed"]))).toBe("match");
  });

  it("does not exclude on a founder code without a stage, a bare 'student', or a list reaching into another domain", () => {
    expect(stageVerdict(["idea", "pre-seed", "seed"], person([["F2", null]]))).toBe("match");
    expect(stageVerdict(["idea", "pre-seed", "seed"], person([["F1", null]]))).toBe("match");
    expect(stageVerdict(["series-a"], person([["F1", null]]))).toBe("mismatch");
    expect(stageVerdict(["undergraduate", "masters"], person([["S6", null]]))).toBe("unknown");
    expect(stageVerdict(["masters", "phd", "early-career"], person([["E2", "actively_looking"]]))).toBe("unknown");
    expect(stageVerdict(["phd", "early-career"], person([["S3", "first_year"]]))).toBe("unknown");
    expect(stageVerdict(["seed"], person([["F8" as IdentityCode, null]]))).toBe("unknown");
  });
});
