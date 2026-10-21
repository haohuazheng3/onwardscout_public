import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { githubProfileText, orcidRecordText, parseOrcidRecord, type GithubProfile } from "@/lib/ingest/url";
import { localExtractProfile } from "@/lib/llm/local/extract";
import { readProfile } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("link documents → profile", () => {
  it("an ORCID record becomes publications, positions, research fields and the iD", () => {
    const text = orcidRecordText(parseOrcidRecord("0000-0002-1825-0097", JSON.parse(fx("orcid-record.json"))));
    const out = localExtractProfile({ documents: [{ id: "doc_orcid", kind: "link", filename: "orcid", text, sourceUrl: "https://orcid.org/0000-0002-1825-0097" }], locale: "en", now: "2026-10-21" });
    const p = out.profile;
    expect(p.identity.name).toBe("Josiah Carberry");
    expect(p.packs.researcher).toMatchObject({ orcid: "0000-0002-1825-0097", fields: ["psychoceramics", "ionian philology"] });
    expect(p.publications.map((x) => x.title)).toEqual(expect.arrayContaining(["The effect of brittle ceramics on morale", "Cracked pots: a field guide"]));
    expect(p.publications.find((x) => x.doi)?.doi).toBe("10.5555/12345678");
    expect(p.experience[0]).toMatchObject({ organization: "Wesleyan University", title: "Professor", startDate: "1999-09", current: true });
    expect(p.education[0]).toMatchObject({ institution: "Brown University", degree: "PhD" });
    expect(out.facts.every((f) => f.sourceDocId === "doc_orcid" && f.confidence > 0.5)).toBe(true);
  });

  it("a GitHub profile becomes projects, languages and links", () => {
    const gh: GithubProfile = {
      login: "quinn-builds",
      name: "Avery Quinn",
      type: "User",
      bio: "Designer who codes",
      company: null,
      location: "Austin, TX",
      blog: "averyquinn.example.com",
      email: null,
      twitter: null,
      followers: 120,
      publicRepos: 14,
      createdAt: "2015-04-02T00:00:00Z",
      url: "https://github.com/quinn-builds",
      topRepos: [{ name: "pocket-pantry", description: "Meal planning for food banks", language: "TypeScript", stars: 210, forks: 12, topics: ["nextjs"], homepage: null, url: "https://github.com/quinn-builds/pocket-pantry", pushedAt: null }],
      languages: ["TypeScript", "Python"],
    };
    const out = localExtractProfile({ documents: [{ id: "doc_gh", kind: "link", filename: "github", text: githubProfileText(gh), sourceUrl: gh.url }], locale: "en", now: "2026-10-21" });
    const p = out.profile;
    expect(p.identity.links.map((l) => l.kind)).toEqual(expect.arrayContaining(["github", "website"]));
    expect(p.projects[0]).toMatchObject({ name: "pocket-pantry", summary: "Meal planning for food banks", url: "https://github.com/quinn-builds/pocket-pantry", skills: ["TypeScript"] });
    expect(p.skills.map((s) => s.name)).toEqual(["TypeScript", "Python"]);
    // A GitHub bio is weak evidence for a headline compared with a résumé.
    expect(out.facts.find((f) => f.path === "/identity/headline")!.confidence).toBeLessThan(0.5);
  });
});

describe("readProfile", () => {
  it("fills defaults and drops invalid items instead of failing", () => {
    const p = readProfile({ identity: { name: "Kai" }, skills: [{ name: "Go" }, { bad: true }], experience: "nope" });
    expect(p.identity.name).toBe("Kai");
    expect(p.identity.links).toEqual([]);
    expect(p.skills.map((s) => s.name)).toEqual(["Go"]);
    expect(p.experience).toEqual([]);
    expect(readProfile(null).roles).toEqual([]);
  });
});
