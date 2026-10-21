import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_FIELD_ORDER } from "@/app/sandbox/form/render";
import { applyInfoSchema, eligibilitySchema, opportunityBenefitsSchema, opportunityCostSchema, opportunityGeoSchema } from "@/lib/core/types";
import { CURATED_DIR, curatedDescription, curatedSourceOf, loadCurated, mapCuratedEntry, validateCurated, type CuratedEntry } from "@/lib/sources/curated";
import { PRACTICE_FORM_URL, PRACTICE_SLUG, practiceFields, practiceOpportunity } from "@/lib/sources/practice";

const NOW = new Date("2026-10-21T12:00:00Z");

const entry = (over: Record<string, unknown> = {}) => ({
  slug: "acme-accelerator",
  type: "accelerator",
  name: "Acme Accelerator",
  org: "Acme Ventures",
  url: "https://acme.example/apply",
  summary: "Twelve-week program for pre-seed founders with funding, mentors and a demo day.",
  benefits: { funding: "Up to $150,000 for 7%", other: ["mentors", "demo day"] },
  cost: { fee: "free", equity: "7%" },
  geo: { countries: ["US", "uk"], cities: ["Austin"], remote: false, global: true },
  languages: ["EN"],
  industries: ["fintech", "any"],
  tags: ["Pre-Seed", "demo day"],
  eligibility: { identities: ["F", "S2", "nobody"], stages: ["pre-seed"], notes: "Open to founders anywhere." },
  deadline: "2027-01-15",
  rolling: false,
  cycle: "Two cohorts a year",
  apply: { channel: "CH6", url: "https://apply.acme.example", email: null, platform: "own_portal", requiresAccount: true, requiresPayment: false },
  requiredMaterials: ["deck", "video", "mystery_doc"],
  verified: { checkedAt: "2026-10-21", httpStatus: 200, evidence: "Applications close January 15" },
  ...over,
});

describe("validateCurated", () => {
  it("accepts valid entries and reports invalid ones with the reasons (never throws)", () => {
    const r = validateCurated("startups.json", [entry(), entry({ slug: "Bad Slug", url: "ftp://x" }), { name: "no fields" }, entry({ type: "spaceship" })]);
    expect(r.entries).toHaveLength(1);
    expect(r.invalid.map((i) => i.index)).toEqual([1, 2, 3]);
    expect(r.invalid[0].slug).toBe("Bad Slug");
    expect(r.invalid[0].issues.join(" ")).toMatch(/slug/i);
    expect(r.invalid[0].issues.join(" ")).toMatch(/url/i);
  });
  it("a file that is not an array is one invalid record", () => {
    expect(validateCurated("x.json", { not: "an array" }).invalid).toEqual([{ file: "x.json", index: -1, slug: null, issues: ["The file must contain a JSON array of entries."] }]);
  });
  it("tolerates missing optional fields (unknown = null)", () => {
    const minimal = { slug: "min", type: "grant", name: "Minimal Grant", url: "https://g.example", summary: "A grant for artists working with sound and space.", apply: { channel: "CH6" } };
    const r = validateCurated("f.json", [minimal]);
    expect(r.invalid).toEqual([]);
    const { mapped } = mapCuratedEntry(r.entries[0], NOW);
    expect(mapped.draft).toMatchObject({ benefits: null, cost: null, eligibility: null, deadline: null, rolling: false, status: "unverified", verifiedAt: null });
  });
});

describe("mapCuratedEntry", () => {
  const item = { file: "startups.json", entry: validateCurated("startups.json", [entry()]).entries[0].entry as CuratedEntry };
  const { mapped, warnings } = mapCuratedEntry(item, NOW);
  const d = mapped.draft;

  it("keeps the slug, the type and a public page for public program types", () => {
    expect(d).toMatchObject({ slug: "acme-accelerator", type: "accelerator", public: true, status: "active", sourceRef: "acme-accelerator", orgSlug: "acme-ventures" });
    expect(d.verifiedAt?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    // never in the future, even when the check date is later than "now"
    expect(mapCuratedEntry(item, new Date("2026-10-20T08:00:00Z")).mapped.draft.verifiedAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });
  it("produces jsonb that passes the domain schemas", () => {
    expect(() => opportunityBenefitsSchema.parse(d.benefits)).not.toThrow();
    expect(() => opportunityCostSchema.parse(d.cost)).not.toThrow();
    expect(() => opportunityGeoSchema.parse(d.geo)).not.toThrow();
    expect(() => eligibilitySchema.parse(d.eligibility)).not.toThrow();
    expect(() => applyInfoSchema.parse(d.apply)).not.toThrow();
  });
  it("maps place, money, cost and eligibility without inventing anything", () => {
    expect(d.geo).toEqual({ countries: ["US", "GB"], cities: ["Austin"], remote: "onsite", worldwide: true });
    expect(d.benefits?.money).toEqual({ kind: "investment", min: null, max: 150000, currency: "USD", period: null });
    expect(d.benefits?.perks).toEqual(["mentors", "demo day"]);
    expect(d.cost).toMatchObject({ free: true, equityPercent: 7, applicationFee: null, notes: null });
    expect(d.eligibility).toMatchObject({ identities: ["F", "S2"], stages: ["pre-seed"], notes: "Open to founders anywhere." });
    expect(d.industries).toEqual(["finance.fintech-payments"]);
    expect(d.languages).toEqual(["en"]);
    expect(d.tags).toEqual(["pre-seed", "demo day"]);
    expect(d.deadline?.toISOString()).toBe("2027-01-15T23:59:59.000Z");
    expect(d.apply).toMatchObject({ channel: "CH6", url: "https://apply.acme.example", platform: "own_portal", requiresAccount: true });
    expect(d.requiredMaterials).toEqual(["pitch_deck", "demo_video"]);
  });
  it("says what it could not carry over", () => {
    expect(warnings.map((w) => w.message)).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown identity "nobody"/), expect.stringMatching(/mystery_doc/)]));
  });
  it("the description restates the entry, including the materials it could not map", () => {
    const text = curatedDescription(item.entry);
    expect(text).toContain("What it offers: Up to $150,000 for 7%.");
    expect(text).toContain("What to prepare: deck, video, mystery doc.");
    expect(text).toContain("From the official page (checked 2026-10-21): “Applications close January 15”");
    expect(text).toContain("you need an account there");
  });
  it("past deadlines expire; rolling programs stay open", () => {
    const later = new Date("2027-02-01T00:00:00Z");
    expect(mapCuratedEntry(item, later).mapped.draft.status).toBe("expired");
    const rolling = { ...item, entry: { ...item.entry, rolling: true } };
    expect(mapCuratedEntry(rolling, later).mapped.draft.status).toBe("active");
  });
  it("private program types stay off the public site", () => {
    const inv = { ...item, entry: { ...item.entry, type: "investor" as const } };
    expect(mapCuratedEntry(inv, NOW).mapped.draft.public).toBe(false);
  });
  it("the hash changes when the entry changes, not when time passes", () => {
    expect(mapCuratedEntry(item, new Date("2026-12-01")).mapped.hash).toBe(mapped.hash);
    expect(mapCuratedEntry({ ...item, entry: { ...item.entry, name: "Acme Accelerator II" } }, NOW).mapped.hash).not.toBe(mapped.hash);
  });
  it("names each file's source row", () => {
    expect(curatedSourceOf("startups.json")).toEqual({ name: "Curated programs · startups", url: "seed://curated/startups" });
  });
});

describe("the research team's curated files", () => {
  const present = fs.existsSync(CURATED_DIR); // the public mirror ships without seed data

  it("every file is a JSON array and loading never throws", () => {
    if (!present) return;
    const files = fs.readdirSync(CURATED_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const json = JSON.parse(fs.readFileSync(path.join(CURATED_DIR, f), "utf8"));
      expect(Array.isArray(json), f).toBe(true);
    }
    const load = loadCurated();
    expect(load.unreadable).toEqual([]);
    if (load.invalid.length) console.warn(`curated: ${load.invalid.length} invalid entries\n${load.invalid.map((i) => `  ${i.file}#${i.index} ${i.slug ?? ""}: ${i.issues.join("; ")}`).join("\n")}`);
    // The loader reports invalid entries instead of failing; the data itself must stay overwhelmingly valid.
    expect(load.entries.length).toBeGreaterThan(0);
    expect(load.invalid.length / (load.entries.length + load.invalid.length)).toBeLessThan(0.05);
  });

  it("every valid entry maps to a row that passes the domain schemas", () => {
    if (!present) return;
    const load = loadCurated();
    for (const e of load.entries) {
      const { draft } = mapCuratedEntry(e, NOW).mapped;
      expect(() => applyInfoSchema.parse(draft.apply), e.entry.slug).not.toThrow();
      expect(() => opportunityGeoSchema.parse(draft.geo), e.entry.slug).not.toThrow();
      if (draft.benefits) expect(() => opportunityBenefitsSchema.parse(draft.benefits), e.entry.slug).not.toThrow();
      if (draft.cost) expect(() => opportunityCostSchema.parse(draft.cost), e.entry.slug).not.toThrow();
      expect(draft.summary?.length ?? 0, e.entry.slug).toBeLessThanOrEqual(320);
      expect(draft.url, e.entry.slug).toMatch(/^https?:\/\//);
    }
  });
});

describe("practice opportunity", () => {
  const m = practiceOpportunity(NOW);
  it("is the free, private, always-open sandbox application", () => {
    expect(m.draft).toMatchObject({ slug: PRACTICE_SLUG, type: "practice", public: false, status: "active", rolling: true, deadline: null, url: PRACTICE_FORM_URL });
    expect(m.draft.slug).toBe("practice-application");
    expect(m.draft.cost?.free).toBe(true);
    expect(m.draft.apply).toMatchObject({ channel: "CH2", url: "https://onwardscout.com/sandbox/form", platform: "sandbox", requiresAccount: false, requiresPayment: false });
    expect(() => applyInfoSchema.parse(m.draft.apply)).not.toThrow();
  });
  it("describes the sandbox form's fields in the form's own order", () => {
    const fields = practiceFields();
    expect(fields.map((f) => f.name)).toEqual([...SANDBOX_FIELD_ORDER]);
    expect(fields.find((f) => f.name === "resume")).toMatchObject({ type: "file", required: true });
    expect(fields.find((f) => f.name === "phone")?.required).toBe(false);
    expect(fields.find((f) => f.name === "availability")?.options?.map((o) => o.value)).toContain("2-weeks");
    expect(fields.find((f) => f.name === "email")?.profilePath).toBe("/identity/email");
  });
});
