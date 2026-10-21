import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileSchema } from "@/lib/core/types";
import { extractFile } from "@/lib/ingest/extract";
import { QuoteChecker, buildProfile, parseTraction } from "@/lib/llm/build";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { parseCitation } from "@/lib/llm/local/research";
import { findDateRange, totalYears } from "@/lib/llm/local/text";
import { ExtractProfileOutput, emptyIR, type ExtractDocument } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const NOW = "2026-10-21";

function extract(id: string, kind: ExtractDocument["kind"], file: string, locale: "en" | "zh" = "en") {
  const out = localExtractProfile({ documents: [{ id, kind, filename: file, text: fx(file) }], locale, now: NOW });
  // The output is valid against the shared contract (F2's profile schema included).
  ExtractProfileOutput.parse(out);
  return out;
}

function everyFactQuoted(out: ReturnType<typeof extract>, text: string) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  for (const f of out.facts) {
    expect(f.quote.length).toBeGreaterThan(0);
    for (const seg of f.quote.split(" / ")) expect(norm(text)).toContain(norm(seg.trim()));
  }
}

describe("local extraction — English résumé", () => {
  const out = extract("doc_en", "resume", "resume-en.txt");
  const p = out.profile;

  it("reads identity and contact details", () => {
    expect(p.identity).toMatchObject({ name: "Avery Quinn", headline: "Senior Product Designer", email: "avery.quinn@example.com", phone: "(512) 555-0142", location: "Austin, TX", countryCode: "US" });
    expect(p.identity.links.map((l) => l.kind)).toEqual(expect.arrayContaining(["linkedin", "website"]));
    expect(p.identity.languages).toEqual([{ code: "en", level: "native" }, { code: "es", level: "professional" }]);
  });

  it("reads experience with titles, organisations, dates and bullets", () => {
    expect(p.experience).toHaveLength(3);
    expect(p.experience[0]).toMatchObject({ title: "Senior Product Designer", organization: "Quillfeather Health", startDate: "2021-03", endDate: null, current: true, location: "Austin, TX", occupation: "product-designer" });
    expect(p.experience[0].highlights[0]).toMatch(/^Led the redesign of the patient intake flow/);
    expect(p.experience[1]).toMatchObject({ title: "Product Designer", organization: "Northwind Lending", startDate: "2018-06", endDate: "2021-02", location: "New York, NY" });
    expect(p.experience[2]).toMatchObject({ title: "UX Design Intern", organization: "Fieldnote Studio", employmentType: "internship" });
  });

  it("reads education, skills, projects, certifications and awards", () => {
    expect(p.education[0]).toMatchObject({ institution: "University of Texas at Austin", degree: "B.S.", level: "bachelor", field: "Human Factors and Ergonomics", endDate: "2018", gpa: { value: 3.8, scale: 4 } });
    expect(p.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Figma", "Design Systems", "Usability Testing", "Jira"]));
    expect(p.skills.find((s) => s.name === "Figma")?.category).toBe("tool");
    expect(p.projects[0]).toMatchObject({ name: "Pocket Pantry", url: "https://pocketpantry.example.org" });
    expect(p.certifications[0]).toMatchObject({ name: "Certified Usability Analyst (CUA)", issuer: "Human Factors International", issuedAt: "2019" });
    expect(p.achievements[0]).toMatchObject({ title: "Interaction Design Notable", issuer: "Core77 Design Awards", date: "2022", kind: "award" });
    expect(p.functions).toContain("design");
  });

  it("every fact has a verbatim quote from the document and points into the profile", () => {
    everyFactQuoted(out, fx("resume-en.txt"));
    expect(out.facts.every((f) => f.sourceDocId === "doc_en")).toBe(true);
    const expIds = p.experience.map((e) => `/experience/${e.id}`);
    expect(out.facts.map((f) => f.path)).toEqual(expect.arrayContaining(expIds));
  });

  it("infers a senior professional, not a freelancer", () => {
    expect(out.identities[0]).toMatchObject({ code: "E3" });
    expect(p.roles.map((r) => r.code)).toEqual(["E3"]);
    expect(p.roles[0].inferred).toBe(true);
    expect(out.identities.some((g) => g.code === "T8")).toBe(false);
  });

  it("asks only useful gap questions", () => {
    expect(out.gaps).toContain("What kind of role do you want next?");
    expect(out.gaps).not.toContain("Which email should organisations reply to?");
  });

  it("produces stable item ids (re-extraction keeps fact paths valid)", () => {
    const again = extract("doc_en", "resume", "resume-en.txt");
    expect(again.profile.experience.map((e) => e.id)).toEqual(p.experience.map((e) => e.id));
  });
});

describe("local extraction — Chinese 简历", () => {
  const out = extract("doc_zh", "resume", "resume-zh.txt", "zh");
  const p = out.profile;

  it("reads identity, labelled fields and the job objective", () => {
    expect(p.identity).toMatchObject({ name: "林晓雨", headline: "产品经理", email: "xiaoyu.lin@example.com", phone: "138 0013 8000", location: "上海", countryCode: "CN", birthYear: 1996 });
    expect(p.packs.jobSeeker?.targetOccupations).toContain("product-manager");
    expect(p.packs.jobSeeker?.locations).toEqual(["上海", "杭州"]);
  });

  it("reads experience with 至今 and column layouts", () => {
    expect(p.experience[0]).toMatchObject({ organization: "上海云帆数字科技有限公司", title: "产品经理", startDate: "2021-07", current: true });
    expect(p.experience[1]).toMatchObject({ organization: "杭州青禾网络有限公司", title: "产品助理", startDate: "2019-07", endDate: "2021-06" });
    expect(p.experience[0].highlights[0]).toContain("1200 家增长到 4800 家");
  });

  it("reads education, skills with levels, tests and awards", () => {
    expect(p.education[0]).toMatchObject({ institution: "华东理工大学", degree: "本科", level: "bachelor", field: "信息管理与信息系统", startDate: "2015-09", endDate: "2019-06", gpa: { value: 3.6, scale: 4 } });
    expect(p.education[0].honors.join(" ")).toContain("一等奖学金");
    expect(p.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Axure", "Figma", "SQL", "A/B 测试"]));
    expect(p.skills.find((s) => s.name === "Axure")?.level).toBe("intermediate");
    expect(p.packs.student?.testScores.map((t) => t.test)).toEqual(expect.arrayContaining(["CET-6"]));
    expect(p.achievements[0].kind).toBe("competition");
  });

  it("writes claims in Chinese and quotes the source", () => {
    expect(out.facts.find((f) => f.path === "/identity/name")?.claim).toBe("姓名：林晓雨");
    everyFactQuoted(out, fx("resume-zh.txt"));
  });

  it("product manager is a mid-level professional, not a people manager", () => {
    expect(out.identities[0].code).toBe("E2");
    expect(out.identities.some((g) => g.code === "E4")).toBe(false);
  });
});

describe("local extraction — founder deck", () => {
  const out = extract("doc_deck", "deck", "deck-founder.txt");
  const v = out.profile.packs.founder!.ventures[0];

  it("reads the venture", () => {
    expect(v).toMatchObject({ company: "Tallyfern", oneLiner: "Bookkeeping on autopilot for independent restaurants", website: "https://tallyfern.example.com", stage: "seed", teamSize: 6, deckDocumentId: "doc_deck" });
    expect(v.currentRound).toMatchObject({ amount: 1_500_000, currency: "USD" });
    expect(v.traction.revenue).toMatchObject({ amount: 73_000, currency: "USD", period: "year" });
    expect(v.traction.users).toMatchObject({ count: 41, label: "paying restaurants" });
    expect(v.traction.growth).toMatchObject({ percent: 14, period: "month" });
  });

  it("keeps problem, market, use of funds and team as sourced facts", () => {
    const base = `/packs/founder/ventures/${v.id}`;
    const byPath = new Map(out.facts.map((f) => [f.path, f]));
    expect(byPath.get(`${base}/problem`)?.value).toMatch(/6\+ hours a week/);
    expect(byPath.get(`${base}/useOfFunds`)?.value).toBe("50% engineering, 30% sales, 20% operations");
    expect(out.facts.filter((f) => f.path.startsWith(`${base}/traction/items/`)).length).toBe(4);
    expect(out.facts.filter((f) => f.path.startsWith(`${base}/team/`)).map((f) => (f.value as { name: string }).name)).toEqual(["Maya Okafor", "Dev Raman"]);
    expect(out.facts.some((f) => /Raising/.test(f.claim) && f.path.endsWith("/traction/items/4"))).toBe(false);
  });

  it("doesn't assume which founder uploaded the deck", () => {
    expect(out.profile.identity.name).toBeNull();
    expect(out.gaps[0]).toMatch(/full name/);
    expect(out.identities[0]).toMatchObject({ code: "F2", stage: "seed" });
  });
});

describe("local extraction — researcher CV", () => {
  const out = extract("doc_cv", "cv", "cv-researcher.txt");
  const p = out.profile;

  it("reads publications with authors, venues, years and DOIs", () => {
    expect(p.publications).toHaveLength(3);
    const first = p.publications.find((x) => x.year === 2025)!;
    expect(first).toMatchObject({ title: "Sediment pulses buffer salt marshes against sea-level rise", venue: "Journal of Coastal Ecology", doi: "10.5555/jce.2025.0113", kind: "journal", authorPosition: 1 });
    expect(p.publications.find((x) => x.year === 2024)).toMatchObject({ kind: "conference", title: "Mapping marsh edge erosion with drone photogrammetry" });
  });

  it("reads the researcher pack and education", () => {
    expect(p.packs.researcher).toMatchObject({ orcid: "0000-0002-1825-0097", fields: ["Salt-marsh resilience", "blue carbon", "remote sensing of coastal wetlands"] });
    expect(p.packs.researcher!.grants[0]).toMatchObject({ title: "Coastal Futures Postdoctoral Fellowship", funder: "Harbor Foundation", amount: { amount: 120_000, currency: "USD" } });
    expect(p.education[0]).toMatchObject({ institution: "Northbridge University", degree: "Ph.D.", level: "doctorate", field: "Ecology and Evolutionary Biology" });
    expect(p.identity.links.find((l) => l.kind === "orcid")?.url).toBe("https://orcid.org/0000-0002-1825-0097");
  });

  it("infers an early-career postdoc", () => {
    expect(out.identities[0]).toMatchObject({ code: "R1", stage: "early_career" });
    expect(out.identities.some((g) => g.code.startsWith("E"))).toBe(false);
  });
});

describe("local extraction — binary documents end to end", () => {
  it("PDF → text → profile", async () => {
    const file = await extractFile({ bytes: new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures", "resume.pdf"))), filename: "resume.pdf" });
    const out = localExtractProfile({ documents: [{ id: "doc_pdf", kind: file.kind, filename: "resume.pdf", text: file.text }], locale: "en", now: NOW });
    expect(out.profile.identity).toMatchObject({ name: "Jordan Reyes", email: "jordan.reyes@example.com", location: "Denver, CO" });
    expect(out.profile.experience[0]).toMatchObject({ title: "Data Analyst", organization: "Bramblewood Outfitters", startDate: "2022-01", current: true });
    expect(out.profile.education[0]).toMatchObject({ institution: "Colorado Plains University", level: "bachelor", field: "Economics" });
  });

  it("DOCX → text → profile", async () => {
    const file = await extractFile({ bytes: new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures", "resume.docx"))), filename: "resume.docx" });
    const out = localExtractProfile({ documents: [{ id: "doc_docx", kind: file.kind, filename: "resume.docx", text: file.text }], locale: "en", now: NOW });
    expect(out.profile.identity.name).toBe("Priya Shah-Lindgren");
    expect(out.profile.experience[0]).toMatchObject({ title: "Backend Engineer", organization: "Larchmont Logistics", startDate: "2020-08" });
    expect(out.profile.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["Go", "PostgreSQL", "Kubernetes"]));
  });

  it("merges several documents: résumé identity wins, deck adds the venture", () => {
    const out = localExtractProfile({
      documents: [
        { id: "doc_deck", kind: "deck", filename: "deck.txt", text: fx("deck-founder.txt") },
        { id: "doc_en", kind: "resume", filename: "resume.txt", text: fx("resume-en.txt") },
      ],
      links: [{ url: "https://github.com/avery-quinn-example" }],
      locale: "en",
      now: NOW,
    });
    expect(out.profile.identity.email).toBe("avery.quinn@example.com");
    expect(out.profile.packs.founder?.ventures[0].company).toBe("Tallyfern");
    expect(out.profile.identity.links.some((l) => l.kind === "github")).toBe(true);
    expect(out.facts.find((f) => f.claim.startsWith("Link added by the person"))?.confidence).toBe(1);
  });
});

describe("building blocks", () => {
  it("parses date ranges in many formats", () => {
    expect(findDateRange("Mar 2021 – Present")).toMatchObject({ start: "2021-03", end: null, current: true });
    expect(findDateRange("2019.07 - 2021.06")).toMatchObject({ start: "2019-07", end: "2021-06" });
    expect(findDateRange("2020年9月至今")).toMatchObject({ start: "2020-09", current: true });
    expect(findDateRange("09/2016 to 06/2020")).toMatchObject({ start: "2016-09", end: "2020-06" });
    expect(findDateRange("Summer 2019 - Fall 2020")).toMatchObject({ start: "2019-06", end: "2020-09" });
  });

  it("counts years without double-counting overlaps", () => {
    const y = totalYears(
      [
        { start: "2018-01", end: "2020-01" },
        { start: "2019-01", end: "2021-01" },
      ],
      new Date("2026-01-01"),
    );
    expect(y).toBe(3);
  });

  it("parses citations (APA, quoted titles, GB/T 7714)", () => {
    expect(parseCitation("Lee, A., & Park, J. (2023). Fast graph search for maps. Proceedings of the Mapping Conference, 12–19.")).toMatchObject({ title: "Fast graph search for maps", year: 2023, kind: "conference" });
    expect(parseCitation('Ruiz, M. "Tidal flats and memory." Coastal Review, 2021.')).toMatchObject({ title: "Tidal flats and memory", year: 2021 });
    expect(parseCitation("张伟, 李娜. 城市湿地碳汇评估[J]. 生态学报, 2022, 42(3): 1-10.")).toMatchObject({ title: "城市湿地碳汇评估", year: 2022 });
  });

  it("parses traction lines", () => {
    expect(parseTraction(["MRR $12K", "1,200 monthly active users", "growing 8% week over week"])).toEqual({
      revenue: { amount: 12_000, currency: "USD", period: "month", text: "MRR $12K" },
      users: { count: 1200, label: "monthly active users", text: "1,200 monthly active users" },
      growth: { percent: 8, period: "week", text: "growing 8% week over week" },
    });
  });

  it("caps the confidence of quotes that aren't in the document", () => {
    const docs = [{ id: "d1", kind: "resume" as const, filename: "a.txt", text: "Jane Roe\nEngineer at Acme" }];
    const checker = new QuoteChecker(docs);
    expect(checker.verify({ docId: "d1", quote: "Engineer at Acme", confidence: 0.9 }).confidence).toBe(0.9);
    expect(checker.verify({ docId: "d1", quote: "Won a Nobel prize", confidence: 0.9 }).confidence).toBe(0.35);
    const ir = emptyIR();
    ir.identity.push({ field: "name", value: "Jane Roe", src: { docId: "wrong", quote: "Jane Roe", confidence: 0.8 } });
    const { profile, facts } = buildProfile(ir, { locale: "en", documents: docs });
    expect(profileSchema.parse(profile).identity.name).toBe("Jane Roe");
    expect(facts[0].sourceDocId).toBe("d1"); // fixed to the document that actually contains the quote
  });
});

describe("local extraction — LinkedIn 'Save to PDF' export", () => {
  const out = extract("doc_li", "resume", "linkedin-export.txt");
  const p = out.profile;

  it("finds the name, headline and location behind the sidebar", () => {
    expect(p.identity).toMatchObject({ name: "Avery Quinn", headline: "Senior Product Designer at Quillfeather Health", location: "Austin, Texas, United States", countryCode: "US", email: "avery.quinn@example.com" });
    expect(p.identity.links.map((l) => l.kind)).toEqual(expect.arrayContaining(["linkedin", "website"]));
  });

  it("reads company-then-title entries with durations and prose descriptions", () => {
    expect(p.experience.map((e) => [e.title, e.organization, e.startDate, e.endDate, e.location])).toEqual([
      ["Senior Product Designer", "Quillfeather Health", "2021-03", null, "Austin, Texas, United States"],
      ["Product Designer", "Northwind Lending", "2018-06", "2021-02", "New York, United States"],
    ]);
    expect(p.experience[0].highlights[0]).toMatch(/^Led the redesign/);
  });

  it("reads 'Top Skills', certifications and 'Degree - ABBR, Field' education", () => {
    expect(p.skills.map((s) => s.name)).toEqual(["Design Systems", "User Research", "Prototyping"]);
    expect(p.certifications.map((c) => c.name)).toEqual(["Certified Usability Analyst"]);
    expect(p.education[0]).toMatchObject({ institution: "University of Texas at Austin", degree: "Bachelor of Science", field: "Human Factors and Ergonomics", startDate: "2014", endDate: "2018" });
    expect(out.identities.map((g) => g.code)).toEqual(["E3"]);
  });
});
