import { describe, expect, it } from "vitest";
import { dedupe, dedupeJobs, nameSimilarity, nameTokens, orgKey, urlKey } from "@/lib/sources/dedupe";

describe("urlKey", () => {
  it("ignores scheme, www, trailing slashes, index pages, fragments and tracking parameters", () => {
    const k = "ycombinator.com/apply";
    expect(urlKey("https://www.ycombinator.com/apply/")).toBe(k);
    expect(urlKey("http://ycombinator.com/apply?utm_source=x#top")).toBe(k);
    expect(urlKey("https://www.ycombinator.com/apply/index.html")).toBe(k);
    expect(urlKey("https://YCombinator.com/Apply")).toBe(k);
  });
  it("keeps parameters that identify a posting", () => {
    expect(urlKey("https://www.acme.com/careers/job/?gh_jid=8139700&utm_medium=x")).toBe("acme.com/careers/job?gh_jid=8139700");
    expect(urlKey("https://acme.com/job?id=2")).not.toBe(urlKey("https://acme.com/job?id=3"));
  });
  it("rejects non-URLs", () => {
    expect(urlKey("not a url")).toBeNull();
    expect(urlKey("mailto:a@b.c")).toBeNull();
    expect(urlKey(null)).toBeNull();
  });
});

describe("names", () => {
  it("tokens drop stop words, single letters and accents", () => {
    expect(nameTokens("The Fulbright U.S. Scholar Programme")).toEqual(["fulbright", "scholar"]);
    expect(nameTokens("École Polytechnique Fellowship")).toEqual(["ecole", "polytechnique", "fellowship"]);
  });
  it("similarity is the Dice coefficient of the word sets", () => {
    expect(nameSimilarity("Y Combinator Batch", "Y Combinator Batch")).toBe(1);
    expect(nameSimilarity("Sundance Development Track", "Sundance Producers Track")).toBeCloseTo(2 / 3);
    expect(nameSimilarity("Fulbright U.S. Scholar Program", "Fulbright Visiting Scholar Program (to the U.S.)")).toBeCloseTo(0.8);
    expect(nameSimilarity("", "x")).toBe(0);
  });
  it("org keys drop legal suffixes", () => {
    expect(orgKey("Acme, Inc.")).toBe("acme");
    expect(orgKey("Acme Foundation")).toBe("acme");
    expect(orgKey(null)).toBeNull();
  });
});

describe("dedupe (curated programs)", () => {
  type P = { slug: string; url: string; org: string; name: string; type: string };
  const f = (p: P) => ({ url: p.url, org: p.org, name: p.name, type: p.type });
  it("drops the same program listed twice and keeps the first", () => {
    const items: P[] = [
      { slug: "a", url: "https://x.org/fellowship", org: "X Foundation", name: "X Fellowship 2027", type: "fellowship" },
      { slug: "b", url: "https://www.x.org/fellowship/", org: "X", name: "The X Fellowship 2027", type: "fellowship" },
      { slug: "c", url: "https://y.org/apply", org: "Y", name: "Y Residency", type: "residency" },
    ];
    const r = dedupe(items, f);
    expect(r.keep.map((p) => p.slug)).toEqual(["a", "c"]);
    expect(r.duplicates).toEqual([expect.objectContaining({ reason: "url", item: items[1], of: items[0] })]);
  });
  it("same organisation and (nearly) the same name is a duplicate even on another URL", () => {
    const r = dedupe(
      [
        { slug: "a", url: "https://x.org/a", org: "Xeno Institute", name: "Global Health Fellowship", type: "fellowship" },
        { slug: "b", url: "https://x.org/b", org: "Xeno Institute", name: "Global Health Fellowship", type: "fellowship" },
      ],
      f,
    );
    expect(r.duplicates[0]).toMatchObject({ reason: "name" });
  });
  it("different programs on one generic page are kept and reported as a shared URL", () => {
    const items: P[] = [
      { slug: "dev", url: "https://www.sundance.org/deadlines/", org: "Sundance Institute", name: "Sundance Development Track (Screenwriters Lab)", type: "fellowship" },
      { slug: "prod", url: "https://www.sundance.org/deadlines/", org: "Sundance Institute", name: "Sundance Producers Track (Producers Lab and Fellowship)", type: "fellowship" },
    ];
    const r = dedupe(items, f);
    expect(r.keep).toHaveLength(2);
    expect(r.sharedUrl).toEqual([{ item: items[1], with: items[0] }]);
  });
  it("different types never match", () => {
    const r = dedupe(
      [
        { slug: "a", url: "https://x.org/", org: "X", name: "X Awards", type: "award" },
        { slug: "b", url: "https://x.org/", org: "X", name: "X Awards", type: "exhibition" },
      ],
      f,
    );
    expect(r.keep).toHaveLength(2);
  });
});

describe("dedupeJobs (one board)", () => {
  it("collapses reposts of the same title and place, keeps other places", () => {
    const jobs = [
      { id: 1, title: "Software Engineer", type: "job", places: ["New York", "US"] },
      { id: 2, title: "Software Engineer", type: "job", places: ["US", "New York"] },
      { id: 3, title: "Software Engineer", type: "job", places: ["London", "GB"] },
      { id: 4, title: "Software Engineer", type: "internship", places: ["New York", "US"] },
    ];
    const r = dedupeJobs(jobs, (j) => j);
    expect(r.keep.map((j) => j.id)).toEqual([1, 3, 4]);
    expect(r.duplicates.map((j) => j.id)).toEqual([2]);
  });
});
