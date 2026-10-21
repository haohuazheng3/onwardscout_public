import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProfile, profileSchema, type Profile } from "@/lib/core/types";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { confirmedValueAt, factKey, mergeProfile, planFactSync, resolveIndexPath, setAt, stableStringify, valueAt, type StoredFact } from "@/lib/profile/merge";
import { applyProfilePatch, PatchError } from "@/lib/profile/patch";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-10-21";

function extracted(): Profile {
  return localExtractProfile({ documents: [{ id: "doc_cv", kind: "resume", filename: "resume-en.txt", text: fx("resume-en.txt") }], locale: "en", now: NOW }).profile;
}

describe("mergeProfile — documents decide, confirmed paths stay", () => {
  const fresh = extracted();

  it("an empty stored profile takes the extraction as is", () => {
    const merged = mergeProfile(emptyProfile(), fresh);
    expect(merged).toEqual(profileSchema.parse(fresh));
  });

  it("follows the documents for anything the person never confirmed", () => {
    const base: Profile = { ...fresh, identity: { ...fresh.identity, name: "Old Name", headline: "Old headline" }, summary: "stale" };
    const merged = mergeProfile(base, fresh);
    expect(merged.identity.name).toBe("Avery Quinn");
    expect(merged.identity.headline).toBe(fresh.identity.headline);
    expect(merged.summary).toBe(fresh.summary);
  });

  it("keeps a confirmed scalar even when the documents say something else", () => {
    const base: Profile = { ...fresh, identity: { ...fresh.identity, name: "Avery J. Quinn" } };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: "/identity/name", value: "Avery J. Quinn" }] });
    expect(merged.identity.name).toBe("Avery J. Quinn");
    // Siblings still follow the documents.
    expect(merged.identity.email).toBe(fresh.identity.email);
  });

  it("a location answer owns city and country too (path groups)", () => {
    const base: Profile = { ...fresh, identity: { ...fresh.identity, location: "Berlin, Germany", city: "Berlin", countryCode: "DE" } };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: "/identity/location" }] });
    expect(merged.identity).toMatchObject({ location: "Berlin, Germany", city: "Berlin", countryCode: "DE" });
  });

  it("drops stale document items nobody confirmed, keeps confirmed and user-owned ones", () => {
    const extra = { id: "exp_manual0001", organization: "Side Studio", title: "Founder", occupation: null, employmentType: null, industry: null, location: null, startDate: "2020", endDate: null, current: true, summary: null, highlights: [], skills: [] };
    const stale = { ...extra, id: "exp_stale00001", organization: "Gone Corp", title: "Analyst" };
    const base: Profile = { ...fresh, experience: [...fresh.experience, extra, stale] };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: `/experience/${extra.id}` }] });
    expect(merged.experience.map((e) => e.organization)).toContain("Side Studio");
    expect(merged.experience.map((e) => e.organization)).not.toContain("Gone Corp");
    expect(merged.experience).toHaveLength(fresh.experience.length + 1);
  });

  it("a fixed item keeps the person's version and its id; untouched items refresh", () => {
    const first = fresh.experience[0]!;
    const fixed = { ...first, title: "Lead Product Designer" };
    const base: Profile = { ...fresh, experience: [fixed, ...fresh.experience.slice(1)] };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: `/experience/${first.id}`, value: fixed }] });
    expect(merged.experience[0]).toMatchObject({ id: first.id, title: "Lead Product Designer" });
    expect(merged.experience.slice(1)).toEqual(fresh.experience.slice(1));
  });

  it("owning one field of an item merges field by field", () => {
    const first = fresh.experience[0]!;
    const base: Profile = { ...fresh, experience: [{ ...first, title: "Principal Designer", summary: "old summary" }, ...fresh.experience.slice(1)] };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: `/experience/${first.id}/title`, value: "Principal Designer" }] });
    expect(merged.experience[0]!.title).toBe("Principal Designer");
    expect(merged.experience[0]!.summary).toBe(first.summary);
  });

  it("matches the same item under a different id by its natural key", () => {
    const first = fresh.experience[0]!;
    const renamed = { ...first, id: "exp_olderid0001", title: first.title };
    const base: Profile = { ...fresh, experience: [renamed] };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: "/experience/exp_olderid0001/summary", value: "My own words" }] });
    const same = merged.experience.filter((e) => e.organization === first.organization && e.title === first.title);
    expect(same).toHaveLength(1);
    expect(same[0]!.id).toBe("exp_olderid0001");
  });

  it("value arrays keep confirmed entries by value, whatever their index became", () => {
    const base: Profile = { ...fresh, skills: [...fresh.skills, { name: "Service design", category: "domain", level: null, years: null }] };
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: `/skills/${base.skills.length - 1}`, value: { name: "Service design", category: "domain", level: null, years: null } }] });
    expect(merged.skills.map((s) => s.name)).toContain("Service design");
    expect(merged.skills.map((s) => s.name)).toEqual(expect.arrayContaining(fresh.skills.map((s) => s.name)));
    const plain = mergeProfile(base, fresh);
    expect(plain.skills.map((s) => s.name)).not.toContain("Service design");
  });

  it("roles the person picked survive re-extraction; inferred ones refresh", () => {
    const base: Profile = { ...fresh, roles: [{ code: "C1", stage: "full_time", since: null, inferred: false }] };
    expect(mergeProfile(base, fresh, { confirmed: [{ path: "/roles" }] }).roles).toEqual(base.roles);
    expect(mergeProfile(base, fresh).roles).toEqual(fresh.roles);
  });

  it("packs merge field by field and answers survive a new document", () => {
    const base = setAt(fresh, "/packs/jobSeeker", { targetFunctions: [], targetOccupations: ["product-designer"], targetIndustries: [], locations: [], remote: "remote_only", salaryMin: 80000, salaryMax: 120000, currency: "USD", salaryPeriod: "year", availableFrom: null, needsSponsorship: null, searchVisibility: null });
    const merged = mergeProfile(base, fresh, { confirmed: [{ path: "/packs/jobSeeker/remote" }, { path: "/packs/jobSeeker/salary" }] });
    expect(merged.packs.jobSeeker).toMatchObject({ remote: "remote_only", salaryMin: 80000, salaryMax: 120000, currency: "USD", salaryPeriod: "year" });
    // targetOccupations was not confirmed: it follows the documents (none here).
    expect(merged.packs.jobSeeker?.targetOccupations ?? []).toEqual(fresh.packs.jobSeeker?.targetOccupations ?? []);
  });

  it("restores the person's word from their confirmed facts when the stored profile lacks it", () => {
    const empty = emptyProfile();
    const merged = mergeProfile(empty, fresh, {
      confirmed: [
        { path: "/identity/location", value: { location: "Berlin, Germany", city: "Berlin", countryCode: "DE" } },
        { path: "/packs/jobSeeker/salary", value: { salaryMin: 60000, salaryMax: 90000, currency: "EUR", salaryPeriod: "year" } },
        { path: "/identity/name", value: "Avery J. Quinn" },
        { path: "/packs/jobSeeker/remote", value: "remote_only" },
      ],
    });
    expect(merged.identity).toMatchObject({ name: "Avery J. Quinn", location: "Berlin, Germany", city: "Berlin", countryCode: "DE" });
    expect(merged.packs.jobSeeker).toMatchObject({ remote: "remote_only", salaryMin: 60000, salaryMax: 90000, currency: "EUR", salaryPeriod: "year" });
    // A confirmed "nothing" stays nothing.
    expect(confirmedValueAt("/packs/founder/ventures/v1/currentRound", [{ path: "/packs/founder/ventures/v1/currentRound", value: null }])).toBeNull();
    expect(confirmedValueAt("/experience/e1/title", [{ path: "/experience/e1", value: { id: "e1", title: "Lead" } }])).toBe("Lead");
  });

  it("always returns a valid profile", () => {
    const merged = mergeProfile(fresh, emptyProfile(), { confirmed: [{ path: "/identity/name" }, { path: "/roles" }] });
    expect(() => profileSchema.parse(merged)).not.toThrow();
    expect(merged.identity.name).toBe("Avery Quinn");
    expect(merged.experience).toEqual([]);
  });
});

describe("planFactSync — dedupe by path + value, never touch confirmed facts", () => {
  const f = (id: string, path: string, value: unknown, extra: Partial<StoredFact> = {}): StoredFact => ({ id, path, value, claim: `${path}=${String(value)}`, sourceDocId: "doc_a", quote: "q", confidence: 0.9, confirmedByUser: false, ...extra });

  it("inserts new facts, removes ones no source supports, keeps the rest", () => {
    const existing = [f("f1", "/identity/name", "Ann"), f("f2", "/skills/0", { name: "Go" })];
    const plan = planFactSync(existing, [
      { path: "/identity/name", value: "Ann", claim: "/identity/name=Ann", sourceDocId: "doc_a", quote: "q", confidence: 0.9 },
      { path: "/skills/0", value: { name: "Rust" }, claim: "Skill: Rust", sourceDocId: "doc_a", quote: "Rust", confidence: 0.8 },
    ]);
    expect(plan.insert.map((x) => x.value)).toEqual([{ name: "Rust" }]);
    expect(plan.remove).toEqual(["f2"]);
    expect(plan.update).toEqual([]);
  });

  it("refreshes the quote of a fact produced again", () => {
    const plan = planFactSync([f("f1", "/identity/name", "Ann")], [{ path: "/identity/name", value: "Ann", claim: "Name: Ann", sourceDocId: "doc_b", quote: "Ann Lee", confidence: 0.95 }]);
    expect(plan.update).toEqual([{ id: "f1", claim: "Name: Ann", quote: "Ann Lee", confidence: 0.95, sourceDocId: "doc_b" }]);
    expect(plan.insert).toEqual([]);
  });

  it("never removes or shadows a confirmed fact", () => {
    const existing = [f("f1", "/identity/name", "Ann Lee", { confirmedByUser: true, sourceDocId: null })];
    const plan = planFactSync(existing, [{ path: "/identity/name", value: "Ann", claim: "Name: Ann", sourceDocId: "doc_a", quote: "Ann", confidence: 0.9 }]);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it("removes duplicate rows of one key and unconfirmed facts under an owned path", () => {
    const existing = [f("f1", "/summary", "x"), f("f2", "/summary", "x"), f("f3", "/packs/jobSeeker/salaryMin", 1), f("f4", "/packs/jobSeeker/salary", { min: 1 }, { confirmedByUser: true })];
    const plan = planFactSync(existing, [
      { path: "/summary", value: "x", claim: "/summary=x", sourceDocId: "doc_a", quote: "q", confidence: 0.9 },
      { path: "/packs/jobSeeker/salaryMin", value: 1, claim: "c", sourceDocId: "doc_a", quote: "q", confidence: 0.9 },
    ]);
    expect(plan.remove.sort()).toEqual(["f2", "f3"]);
    expect(plan.insert).toEqual([]);
  });

  it("keys are order-independent", () => {
    expect(factKey("/a", { x: 1, y: 2 })).toBe(factKey("/a", { y: 2, x: 1 }));
    expect(stableStringify({ b: [1, { d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });
});

describe("pointer helpers", () => {
  const p = extracted();
  it("reads items by id, values by index", () => {
    const first = p.experience[0]!;
    expect(valueAt(p, `/experience/${first.id}/title`)).toBe(first.title);
    expect(valueAt(p, "/skills/0")).toEqual(p.skills[0]);
    expect(valueAt(p, "/identity/email")).toBe(p.identity.email);
    expect(valueAt(p, "/nope/x")).toBeUndefined();
  });
  it("finds a value-array entry by value when its index moved", () => {
    const skill = p.skills[2]!;
    expect(resolveIndexPath(p, "/skills/0", skill)).toBe("/skills/2");
    expect(resolveIndexPath(p, "/skills/0", { name: "Not there" })).toBe("/skills/0");
    expect(resolveIndexPath(p, `/experience/${p.experience[0]!.id}`, p.experience[0])).toBe(`/experience/${p.experience[0]!.id}`);
  });
  it("writes immutably", () => {
    const first = p.experience[0]!;
    const next = setAt(p, `/experience/${first.id}/title`, "Changed");
    expect(next.experience[0]!.title).toBe("Changed");
    expect(p.experience[0]!.title).toBe(first.title);
    expect(() => setAt(p, "/experience/exp_missing/title", "x")).toThrow();
  });
});

describe("applyProfilePatch — taps become confirmed facts", () => {
  const p = extracted();
  it("roles: picked identities are no longer inferred, invalid stages refused", () => {
    const r = applyProfilePatch(p, { op: "roles", roles: [{ code: "E2", stage: "open" }, { code: "C1" }] });
    expect(r.profile.roles).toEqual([
      { code: "E2", stage: "open", since: null, inferred: false },
      { code: "C1", stage: null, since: null, inferred: false },
    ]);
    expect(r.facts[0]).toMatchObject({ path: "/roles" });
    expect(() => applyProfilePatch(p, { op: "roles", roles: [{ code: "E2", stage: "seed" }] })).toThrow(PatchError);
  });
  it("location writes the group and the claim", () => {
    const r = applyProfilePatch(p, { op: "location", location: "Shanghai, China", countryCode: "CN" }, { locale: "zh" });
    expect(r.profile.identity).toMatchObject({ location: "Shanghai, China", city: "Shanghai", countryCode: "CN" });
    expect(r.facts[0]).toMatchObject({ path: "/identity/location", claim: "所在地：Shanghai, China" });
  });
  it("taxonomy codes are checked", () => {
    expect(() => applyProfilePatch(p, { op: "occupations", codes: ["not-a-job"] })).toThrow(PatchError);
    expect(applyProfilePatch(p, { op: "occupations", codes: ["product-designer"] }).profile.occupations).toEqual(["product-designer"]);
  });
  it("needing sponsorship updates the job-seeker pack", () => {
    const r = applyProfilePatch(p, { op: "workAuthorization", items: [{ countryCode: "US", status: "needs_sponsorship" }] });
    expect(r.profile.packs.jobSeeker?.needsSponsorship).toBe(true);
  });
  it("emails are validated", () => {
    expect(() => applyProfilePatch(p, { op: "field", field: "email", value: "nope" })).toThrow(PatchError);
  });
});
