import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@/lib/core/types";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { COMPLETENESS_WEIGHTS, completenessBreakdown, completenessNext, completenessScore, packFill, relevantPacks } from "@/lib/profile/completeness";
import { applyGapAnswer } from "@/lib/profile/gaps";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = new Date("2026-10-21T00:00:00Z");

function from(file: string, kind: "resume" | "cv" | "deck" = "resume"): Profile {
  return localExtractProfile({ documents: [{ id: "doc_1", kind, filename: file, text: fx(file) }], locale: "en", now: NOW }).profile;
}

describe("completenessScore", () => {
  it("weights add up to 100", () => {
    expect(Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("an empty profile is 0 and stays within bounds", () => {
    expect(completenessScore(emptyProfile())).toBe(0);
    for (const part of completenessBreakdown(emptyProfile())) expect(part.score).toBe(0);
  });

  it("a real résumé scores well but not perfectly", () => {
    const p = from("resume-en.txt");
    const score = completenessScore(p);
    expect(score).toBeGreaterThan(55);
    expect(score).toBeLessThan(100);
    for (const part of completenessBreakdown(p)) {
      expect(part.score).toBeGreaterThanOrEqual(0);
      expect(part.score).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonic: adding information never lowers the score", () => {
    const p = from("resume-en.txt");
    const before = completenessScore(p);
    const withRoles: Profile = { ...p, roles: [{ code: "E2", stage: "open", since: null, inferred: false }] };
    const afterRoles = completenessScore(withRoles);
    expect(afterRoles).toBeGreaterThanOrEqual(before);
    const answered = applyGapAnswer(withRoles, "jobSeeker.remote", ["remote_ok"], { now: NOW }).profile;
    expect(completenessScore(answered)).toBeGreaterThanOrEqual(afterRoles);
  });

  it("confirming an inferred role counts more than leaving it inferred", () => {
    const base = emptyProfile();
    const inferred = completenessScore({ ...base, roles: [{ code: "S2", stage: null, since: null, inferred: true }] });
    const confirmed = completenessScore({ ...base, roles: [{ code: "S2", stage: null, since: null, inferred: false }] });
    expect(confirmed).toBeGreaterThan(inferred);
  });

  it("measures the pack that matters for the person's identities", () => {
    const p: Profile = { ...emptyProfile(), roles: [{ code: "F2", stage: null, since: null, inferred: false }, { code: "E2", stage: null, since: null, inferred: false }] };
    expect(relevantPacks(p)).toEqual(["founder", "jobSeeker"]);
    expect(packFill(p, "founder")).toBe(0);
    const deck = from("deck-founder.txt", "deck");
    expect(packFill(deck, "founder")).toBeGreaterThan(0);
  });

  it("names what would help most next", () => {
    const next = completenessNext(emptyProfile());
    expect(next).toHaveLength(3);
    expect(next[0]).toBe("experience");
    expect(completenessNext(from("resume-en.txt"))).not.toContain("experience");
  });
});
