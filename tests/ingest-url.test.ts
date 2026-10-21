import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToReadable } from "@/lib/ingest/html";
import {
  SafeFetchError,
  assertPublicUrl,
  classifyLink,
  githubTarget,
  guardedLookup,
  ingestUrl,
  isPrivateAddress,
  isValidOrcid,
  normalizeUserUrl,
  orcidFromUrl,
  parseIpv6,
  parseOrcidRecord,
  rankGithubRepos,
  safeFetch,
} from "@/lib/ingest/url";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("SSRF guard: addresses", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254", // AWS metadata over IPv6
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.1.2.3",
    "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
    "2002:7f00:1::1", // 6to4 of 127.0.0.1
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("expands IPv6 forms", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("[fe80::1%eth0]")?.[0]).toBe(0xfe80);
    expect(parseIpv6("::ffff:1.2.3.4")?.slice(5)).toEqual([0xffff, 0x0102, 0x0304]);
    expect(parseIpv6("1::2::3")).toBeNull();
  });
});

describe("SSRF guard: URLs", () => {
  const blocked = (u: string, code: string) => {
    try {
      assertPublicUrl(u);
      throw new Error("not blocked");
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).code).toBe(code);
    }
  };

  it("rejects non-http schemes, credentials, odd ports and local names", () => {
    blocked("file:///etc/passwd", "blocked_scheme");
    blocked("ftp://example.com/x", "blocked_scheme");
    blocked("gopher://example.com", "blocked_scheme");
    blocked("http://user:pass@example.com/", "blocked_host");
    blocked("http://example.com:6379/", "blocked_port");
    blocked("http://localhost/", "blocked_host");
    blocked("http://metadata.google.internal/computeMetadata/v1/", "blocked_host");
    blocked("http://printer.local/", "blocked_host");
    blocked("http://intranet/", "blocked_host");
  });

  it("rejects literal private IPs in every notation the URL parser accepts", () => {
    blocked("http://127.0.0.1/", "blocked_ip");
    blocked("http://2130706433/", "blocked_ip"); // decimal 127.0.0.1
    blocked("http://0x7f.0.0.1/", "blocked_ip");
    blocked("http://127.1/", "blocked_ip");
    blocked("http://[::1]/", "blocked_ip");
    blocked("http://[::ffff:169.254.169.254]/", "blocked_ip");
    blocked("http://169.254.169.254/latest/meta-data/", "blocked_ip");
  });

  it("accepts ordinary public URLs", () => {
    expect(assertPublicUrl("https://example.com/about").hostname).toBe("example.com");
    expect(assertPublicUrl("http://example.com:443/").hostname).toBe("example.com");
  });

  it("refuses a hostname that resolves to a private address, before any connection", async () => {
    const resolver = async () => [{ address: "10.0.0.7", family: 4 }];
    await expect(safeFetch("http://rebind.example.com/", { resolver })).rejects.toMatchObject({ code: "blocked_ip" });
  });

  it("refuses mixed DNS answers (one public, one private)", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(safeFetch("http://mixed.example.com/", { resolver })).rejects.toMatchObject({ code: "blocked_ip" });
  });

  it("the guarded lookup honours the requested family and the `all` form", async () => {
    const lookup = guardedLookup(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    const one = await new Promise<unknown[]>((resolve) => lookup("example.com", { family: 6 }, (err, address, family) => resolve([err, address, family])));
    expect(one).toEqual([null, "2606:2800:220:1::1", 6]);
    const all = await new Promise<unknown[]>((resolve) => lookup("example.com", { all: true }, (err, address) => resolve([err, address])));
    expect(Array.isArray(all[1]) && (all[1] as unknown[]).length).toBe(2);
    // IPv4 is preferred whatever order the resolver answered in.
    const v6first = guardedLookup(async () => [
      { address: "2606:2800:220:1::1", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
    const pick = await new Promise<unknown[]>((resolve) => v6first("example.com", {}, (err, address, family) => resolve([err, address, family])));
    expect(pick).toEqual([null, "93.184.216.34", 4]);
  });
});

describe("links", () => {
  it("normalises what people paste", () => {
    expect(normalizeUserUrl("github.com/octocat")).toBe("https://github.com/octocat");
    expect(normalizeUserUrl("<https://example.com/a>.")).toBe("https://example.com/a");
    expect(normalizeUserUrl("0000-0002-1825-0097")).toBe("https://orcid.org/0000-0002-1825-0097");
    expect(normalizeUserUrl("not a url")).toBeNull();
  });

  it("classifies link kinds", () => {
    expect(classifyLink("https://www.linkedin.com/in/someone")).toBe("linkedin");
    expect(classifyLink("https://scholar.google.com/citations?user=abc")).toBe("scholar");
    expect(classifyLink("https://www.behance.net/someone")).toBe("behance");
    expect(classifyLink("https://space.bilibili.com/123")).toBe("bilibili");
    expect(classifyLink("https://averyquinn.example.com")).toBe("website");
  });

  it("never fetches LinkedIn or Google Scholar and explains what to do instead", async () => {
    const li = await ingestUrl("linkedin.com/in/avery-quinn-example");
    expect(li.status).toBe("skipped");
    if (li.status === "skipped") {
      expect(li.reason).toBe("linkedin");
      expect(li.hint.en).toMatch(/Save to PDF/);
      expect(li.hint.zh).toMatch(/存为 PDF/);
    }
    const gs = await ingestUrl("https://scholar.google.com/citations?user=xyz");
    expect(gs.status).toBe("skipped");
  });

  it("refuses private targets through ingestUrl with a readable error", async () => {
    const r = await ingestUrl("http://192.168.0.1/admin");
    expect(r).toMatchObject({ status: "error", code: "blocked_ip" });
  });

  it("parses GitHub targets", () => {
    expect(githubTarget("https://github.com/octocat")).toEqual({ owner: "octocat", repo: null });
    expect(githubTarget("https://github.com/octocat/Hello-World.git")).toEqual({ owner: "octocat", repo: "Hello-World" });
    expect(githubTarget("https://github.com/features/actions")).toBeNull();
    expect(githubTarget("https://gist.github.com/octocat")).toBeNull();
  });

  it("ranks GitHub repos: own, not archived, by stars", () => {
    const ranked = rankGithubRepos([
      { name: "fork", fork: true, stargazers_count: 999 },
      { name: "old", archived: true, stargazers_count: 500 },
      { name: "b", stargazers_count: 10, pushed_at: "2026-01-01" },
      { name: "a", stargazers_count: 40, language: "Go", topics: ["cli"] },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["a", "b"]);
    expect(ranked[0].language).toBe("Go");
  });

  it("validates ORCID iDs with the ISO 7064 checksum", () => {
    expect(isValidOrcid("0000-0002-1825-0097")).toBe(true);
    expect(isValidOrcid("0000-0002-1694-233X")).toBe(true);
    expect(isValidOrcid("0000-0002-1825-0098")).toBe(false);
    expect(orcidFromUrl("https://orcid.org/0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
  });

  it("maps a pub.orcid.org v3 record", () => {
    const r = parseOrcidRecord("0000-0002-1825-0097", JSON.parse(fx("orcid-record.json")));
    expect(r.name).toBe("Josiah Carberry");
    expect(r.keywords).toEqual(["psychoceramics", "ionian philology"]);
    expect(r.employments[0]).toMatchObject({ organization: "Wesleyan University", role: "Professor", start: "1999-09", end: null });
    expect(r.works.map((w) => w.title)).toEqual(["Cracked pots: a field guide", "The effect of brittle ceramics on morale"]);
    expect(r.works[1]).toMatchObject({ doi: "10.5555/12345678", url: "https://doi.org/10.5555/12345678", year: 2011 });
  });
});

describe("htmlToReadable", () => {
  it("reads title, meta, JSON-LD, main text and links, dropping site chrome", () => {
    const page = htmlToReadable(fx("job-posting.html"), "https://careers.example.com/jobs/42");
    expect(page.title).toBe("Senior Product Designer at Juniper Clinics | Careers");
    expect(page.description).toMatch(/patient-facing intake/);
    expect(page.siteName).toBe("Juniper Clinics Careers");
    expect(page.lang).toBe("en");
    expect((page.jsonLd[0] as { "@type": string })["@type"]).toBe("JobPosting");
    expect(page.text).toContain("# Senior Product Designer");
    expect(page.text).toContain("- 5+ years of experience in product design");
    expect(page.text).not.toContain("All jobs");
    expect(page.links.map((l) => l.url)).toContain("https://boards.greenhouse.io/juniperclinics/jobs/4012345");
  });
});

describe("decodeBody", () => {
  it("honours charsets from the header or a meta tag (GBK pages)", async () => {
    const { decodeBody } = await import("@/lib/ingest/url");
    const gbk = Buffer.from([0xc1, 0xd6, 0xcf, 0xfe, 0xd3, 0xea]); // 林晓雨
    expect(decodeBody({ body: gbk, contentType: "text/html; charset=GBK" })).toBe("林晓雨");
    const html = Buffer.concat([Buffer.from('<meta charset="gb2312"><p>'), gbk, Buffer.from("</p>")]);
    expect(decodeBody({ body: html, contentType: "text/html" })).toContain("林晓雨");
    expect(decodeBody({ body: Buffer.from("héllo"), contentType: "text/plain" })).toBe("héllo");
  });
});
