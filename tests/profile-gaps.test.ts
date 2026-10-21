import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProfile, profileSchema, type Profile } from "@/lib/core/types";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { applyGapAnswer, bandCurrency, GAP_IDS, GapAnswerError, gapQuestion, gapsFor, relevantGapPacks, roundBands, salaryBands, targetRoleOptions } from "@/lib/profile/gaps";
import { mergeProfile } from "@/lib/profile/merge";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = new Date("2026-10-21T00:00:00Z");

function from(file: string, kind: "resume" | "cv" | "deck" = "resume"): Profile {
  return localExtractProfile({ documents: [{ id: "doc_1", kind, filename: file, text: fx(file) }], locale: "en", now: NOW }).profile;
}
const withRoles = (p: Profile, ...codes: Profile["roles"][number]["code"][]): Profile => ({ ...p, roles: codes.map((code) => ({ code, stage: null, since: null, inferred: false })) });

describe("gapsFor — choice questions from the gaps that matter", () => {
  it("asks nothing when there are no identities and no goals", () => {
    expect(gapsFor(emptyProfile(), [], { now: NOW })).toEqual([]);
  });

  it("job seekers: target role (from their occupations), remote, salary, start date", () => {
    const p = withRoles(from("resume-en.txt"), "E2");
    const qs = gapsFor(p, [], { now: NOW });
    expect(qs.map((q) => q.id)).toEqual(["jobSeeker.targetRole", "jobSeeker.remote", "jobSeeker.salary", "jobSeeker.start"]);
    const role = qs[0]!;
    expect(role.multi).toBe(true);
    expect(role.maxPicks).toBe(3);
    expect(role.options[0]!.value).toBe("product-designer");
    expect(role.options.length).toBeGreaterThanOrEqual(3);
    // Every question is a real choice with bilingual text.
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.prompt.en).toBeTruthy();
      expect(q.prompt.zh).toBeTruthy();
      for (const o of q.options) expect(o.label.zh).toBeTruthy();
    }
  });

  it("goals come first, then identities; limit caps the list", () => {
    const p = withRoles(from("resume-en.txt"), "E2", "S4");
    expect(relevantGapPacks(p, [{ family: "G4" }])).toEqual(["researcher", "jobSeeker", "student"]);
    const qs = gapsFor(p, [{ family: "G4" }], { now: NOW, limit: 3 });
    expect(qs).toHaveLength(3);
    expect(qs[0]!.pack).toBe("researcher");
  });

  it("founders are asked about their venture's round, team and traction", () => {
    const p = withRoles(from("deck-founder.txt", "deck"), "F2");
    const v = p.packs.founder!.ventures[0]!;
    const known = { round: v.currentRound != null, team: v.teamSize != null, traction: Boolean(v.traction.revenue || v.traction.users || v.traction.growth) };
    const ids = gapsFor(p, [{ family: "G3", sub: "G3.2" }], { now: NOW }).map((q) => q.id);
    expect(ids.includes("founder.round")).toBe(!known.round);
    expect(ids.includes("founder.team")).toBe(!known.team);
    expect(ids.includes("founder.traction")).toBe(!known.traction);
    // Without a venture there is nothing to attach the answer to.
    expect(gapsFor(withRoles(emptyProfile(), "F1"), [], { now: NOW }).filter((q) => q.pack === "founder")).toEqual([]);
  });

  it("students, researchers and creators get their own pack questions", () => {
    expect(gapsFor(withRoles(emptyProfile(), "S2"), [], { now: NOW }).map((q) => q.id)).toEqual(["student.graduation", "student.degree"]);
    expect(gapsFor(withRoles(emptyProfile(), "R2"), [], { now: NOW }).map((q) => q.id)).toEqual(["researcher.field", "researcher.tier"]);
    expect(gapsFor(withRoles(emptyProfile(), "C1"), [], { now: NOW }).map((q) => q.id)).toEqual(["creator.rates", "creator.audience"]);
  });

  it("minors are never asked about salary", () => {
    const p = withRoles(emptyProfile(), "S1");
    expect(gapsFor(p, [{ family: "G1" }], { now: NOW }).map((q) => q.id)).not.toContain("jobSeeker.salary");
  });

  it("skips what the profile already knows and what was already answered", () => {
    const p = withRoles(from("resume-en.txt"), "E2");
    const after = applyGapAnswer(p, "jobSeeker.remote", ["remote_ok"], { now: NOW }).profile;
    expect(gapsFor(after, [], { now: NOW }).map((q) => q.id)).not.toContain("jobSeeker.remote");
    // "Prefer not to say" leaves the value empty, so the answered path is what stops the question.
    const na = applyGapAnswer(p, "jobSeeker.salary", ["na"], { now: NOW });
    expect(na.profile.packs.jobSeeker?.salaryMin ?? null).toBeNull();
    expect(gapsFor(na.profile, [], { now: NOW }).map((q) => q.id)).toContain("jobSeeker.salary");
    expect(gapsFor(na.profile, [], { now: NOW, answeredPaths: [na.fact.path] }).map((q) => q.id)).not.toContain("jobSeeker.salary");
  });
});

describe("applyGapAnswer — taps become profile values", () => {
  const p = withRoles(from("resume-en.txt"), "E2");

  it("salary bands follow the person's country and write the whole band", () => {
    expect(bandCurrency("CN")).toBe("CNY");
    expect(bandCurrency("DE")).toBe("EUR");
    expect(bandCurrency("GB")).toBe("GBP");
    expect(bandCurrency(null)).toBe("USD");
    const band = salaryBands("USD")[2]!;
    const r = applyGapAnswer(p, "jobSeeker.salary", [band.value], { now: NOW });
    expect(r.profile.packs.jobSeeker).toMatchObject({ salaryMin: 80000, salaryMax: 120000, currency: "USD", salaryPeriod: "year" });
    expect(r.fact).toMatchObject({ path: "/packs/jobSeeker/salary", value: { salaryMin: 80000, salaryMax: 120000, currency: "USD", salaryPeriod: "year" } });
    expect(r.fact.claim).toBe("You told us: $80k–120k");
    const zh = applyGapAnswer({ ...p, identity: { ...p.identity, countryCode: "CN" } }, "jobSeeker.salary", ["b2"], { now: NOW, locale: "zh" });
    expect(zh.fact.claim).toBe("你告诉我们：¥30万–50万");
  });

  it("start dates are months from now", () => {
    const r = applyGapAnswer(p, "jobSeeker.start", ["3m"], { now: NOW });
    expect(r.profile.packs.jobSeeker?.availableFrom).toBe("2026-12");
  });

  it("target roles write occupations and their functions", () => {
    const opts = targetRoleOptions(p);
    const r = applyGapAnswer(p, "jobSeeker.targetRole", [opts[0]!.value, opts[1]!.value], { now: NOW });
    expect(r.profile.packs.jobSeeker?.targetOccupations).toEqual([opts[0]!.value, opts[1]!.value]);
    expect(r.profile.packs.jobSeeker?.targetFunctions.length).toBeGreaterThan(0);
  });

  it("founder answers land on the venture", () => {
    const f = withRoles(from("deck-founder.txt", "deck"), "F2");
    const v = f.packs.founder!.ventures[0]!;
    const r = applyGapAnswer(f, "founder.round", [roundBands("USD")[2]!.value], { now: NOW });
    expect(r.profile.packs.founder!.ventures[0]!.currentRound).toMatchObject({ amount: 1_000_000, currency: "USD" });
    expect(r.fact.path).toBe(`/packs/founder/ventures/${v.id}/currentRound`);
    const none = applyGapAnswer(f, "founder.round", ["not_raising"], { now: NOW });
    expect(none.profile.packs.founder!.ventures[0]!.currentRound).toBeNull();
    const team = applyGapAnswer(f, "founder.team", ["4"], { now: NOW });
    expect(team.profile.packs.founder!.ventures[0]!.teamSize).toBe(4);
    const tr = applyGapAnswer(f, "founder.traction", ["paying"], { now: NOW });
    expect(tr.profile.packs.founder!.ventures[0]!.traction.revenue?.text).toBe("Paying customers");
  });

  it("creates the pack when it is missing and keeps the profile valid", () => {
    for (const [id, value] of [
      ["researcher.field", "computer-science"],
      ["researcher.tier", "top"],
      ["student.graduation", "2027"],
      ["student.degree", "master"],
      ["creator.rates", "b1"],
      ["creator.audience", "10000"],
    ] as const) {
      const r = applyGapAnswer(emptyProfile(), id, [value], { now: NOW });
      expect(() => profileSchema.parse(r.profile)).not.toThrow();
    }
    const c = applyGapAnswer(emptyProfile(), "creator.audience", ["10000"], { now: NOW });
    expect(c.fact.path).toBe("/packs/creator/audienceMetrics/0");
    expect(c.profile.packs.creator?.audienceMetrics[0]?.followers).toBe(10000);
  });

  it("a confirmed answer survives the next extraction", () => {
    const r = applyGapAnswer(p, "jobSeeker.remote", ["remote_only"], { now: NOW });
    const fresh = from("resume-en.txt");
    const merged = mergeProfile(r.profile, fresh, { confirmed: [{ path: r.fact.path, value: r.fact.value }] });
    expect(merged.packs.jobSeeker?.remote).toBe("remote_only");
  });

  it("rejects answers that are not among the choices", () => {
    expect(() => applyGapAnswer(p, "jobSeeker.remote", ["sometimes"], { now: NOW })).toThrow(GapAnswerError);
    expect(() => applyGapAnswer(p, "jobSeeker.remote", ["remote_ok", "onsite_only"], { now: NOW })).toThrow(GapAnswerError);
    expect(() => applyGapAnswer(emptyProfile(), "founder.team", ["4"], { now: NOW })).toThrow(GapAnswerError);
  });

  it("every question id can be built for a profile that needs it", () => {
    const rich = withRoles(from("deck-founder.txt", "deck"), "F2", "E2", "R2", "S3", "C1");
    for (const id of GAP_IDS) {
      if (id === "jobSeeker.targetRole" && !targetRoleOptions(rich).length) continue;
      expect(gapQuestion(id, rich, NOW), id).not.toBeNull();
    }
  });
});
