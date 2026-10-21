import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { boardContext, parseBoards } from "@/lib/sources/ats";
import { ashbySalary, ashbyJobSchema, fetchAshbyBoard } from "@/lib/sources/ats/ashby";
import { AtsHttpError, buildJob, fetchJson, mapPool, newestFirst, retryDelayMs, visaSponsorship } from "@/lib/sources/ats/common";
import { fetchGreenhouseBoard, greenhouseHostedUrl, greenhouseJobSchema, greenhouseToInput } from "@/lib/sources/ats/greenhouse";
import { fetchLeverBoard } from "@/lib/sources/ats/lever";
import type { JobInput } from "@/lib/sources/types";

/*
 * Fixtures: one real public board per provider (Greenhouse: cockroachlabs, Lever: deputy,
 * Ashby: deepl), fetched once on 2026-10-21 and trimmed. No network in these tests.
 */
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "sources-fixtures", `${name}.json`), "utf8"));
const NOW = new Date("2026-10-21T12:00:00Z");
const noSleep = async () => {};

function fakeFetch(...responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

describe("fetchJson", () => {
  it("returns parsed JSON", async () => {
    const { fetchImpl } = fakeFetch({ status: 200, body: { ok: 1 } });
    await expect(fetchJson("https://x.test/a", { fetchImpl, sleepImpl: noSleep })).resolves.toEqual({ ok: 1 });
  });
  it("retries 5xx and 429, then succeeds", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 503 }, { status: 429, headers: { "retry-after": "0" } }, { status: 200, body: [1] });
    await expect(fetchJson("https://x.test/b", { fetchImpl, sleepImpl: noSleep, retries: 2 })).resolves.toEqual([1]);
    expect(calls).toHaveLength(3);
  });
  it("fails at once on 404 without retrying", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 404 }, { status: 200, body: {} });
    const err = await fetchJson("https://x.test/c", { fetchImpl, sleepImpl: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(AtsHttpError);
    expect((err as AtsHttpError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
  it("gives up after the retries on network errors", async () => {
    const { fetchImpl, calls } = fakeFetch(new TypeError("fetch failed"));
    const err = await fetchJson("https://x.test/d", { fetchImpl, sleepImpl: noSleep, retries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AtsHttpError);
    expect((err as AtsHttpError).retryable).toBe(true);
    expect(calls).toHaveLength(2);
  });
  it("backs off 1 s, 3 s, 9 s and honours Retry-After", () => {
    expect([1, 2, 3].map((a) => retryDelayMs(a, null))).toEqual([1000, 3000, 9000]);
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(1, "999")).toBe(30000);
  });
});

describe("mapPool", () => {
  it("never runs more than `limit` at once and keeps order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
  it("stops starting new items when told to", async () => {
    let started = 0;
    const out = await mapPool([1, 2, 3, 4], 1, async (n) => {
      started++;
      return n;
    }, () => started >= 2);
    expect(out).toEqual([1, 2, undefined, undefined]);
  });
});

describe("Greenhouse", () => {
  const ctx = boardContext({ provider: "greenhouse", token: "cockroachlabs", company: "Cockroach Labs", industries: ["software", "cloud"] });
  it("reads the board and maps every posting", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: fixture("greenhouse") });
    const r = await fetchGreenhouseBoard("cockroachlabs", { fetchImpl, sleepImpl: noSleep });
    expect(calls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/cockroachlabs/jobs?content=true");
    expect(r).toMatchObject({ total: 5, invalid: 0 });
    const jobs = r.inputs.map((i) => buildJob(i, ctx, NOW));
    const sdr = jobs.find((j) => j.sourceRef === "8139700");
    expect(sdr?.draft).toMatchObject({
      type: "remote_job",
      name: "Sales Development Representative, Singapore",
      orgName: "Cockroach Labs",
      orgSlug: "cockroach-labs",
      geo: { countries: ["SG"], remote: "remote", worldwide: false },
      functions: ["sales"],
      public: false,
      status: "active",
      languages: ["en"],
    });
    expect(sdr?.draft.apply).toMatchObject({ channel: "CH1", platform: "greenhouse", ats: { provider: "greenhouse", board: "cockroachlabs", postingId: "8139700" }, url: "https://www.cockroachlabs.com/careers/job/?gh_jid=8139700" });
    expect(sdr?.draft.summary).toMatch(/^Cockroach Labs is looking for a Sales Development Representative/);
    expect(sdr?.draft.summary?.length).toBeLessThanOrEqual(320);
    expect(sdr?.draft.industries).toEqual(["software-internet", "software-internet.cloud-infrastructure"]);

    const multi = jobs.find((j) => j.sourceRef === "8209735");
    expect(multi?.draft.geo).toMatchObject({ countries: ["US"], cities: expect.arrayContaining(["New York", "San Mateo"]) });
    expect(multi?.draft.functions).toEqual(["finance"]);

    const pool = jobs.find((j) => j.sourceRef === "2578081");
    expect(pool?.draft.tags).toContain("general application");
    expect(pool?.draft.qualityScore).toBeLessThan(40);
    expect(pool?.draft.summary).toMatch(/not a specific opening/);

    // Every posting gets a unique slug and a hash.
    expect(new Set(jobs.map((j) => j.draft.slug)).size).toBe(jobs.length);
    for (const j of jobs) expect(j.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is deterministic: the same posting hashes the same tomorrow", () => {
    const job = greenhouseJobSchema.parse(fixture("greenhouse").jobs[0]);
    const a = buildJob(greenhouseToInput(job, "cockroachlabs"), ctx, NOW);
    const b = buildJob(greenhouseToInput(job, "cockroachlabs"), ctx, new Date("2026-10-22T12:00:00Z"));
    expect(a.hash).toBe(b.hash);
    expect(a.draft.slug).toBe(b.draft.slug);
  });
  it("falls back to Greenhouse's hosted page when the employer URL does not name the posting", () => {
    const job = greenhouseJobSchema.parse({ id: 42, title: "Engineer", absolute_url: "https://acme.test/careers" });
    expect(greenhouseToInput(job, "acme").url).toBe(greenhouseHostedUrl("acme", "42"));
  });
  it("skips postings with an unrecognised shape instead of failing the board", async () => {
    const { fetchImpl } = fakeFetch({ status: 200, body: { jobs: [{ id: 1 }, fixture("greenhouse").jobs[0]] } });
    const r = await fetchGreenhouseBoard("x", { fetchImpl, sleepImpl: noSleep });
    expect(r).toMatchObject({ total: 2, invalid: 1 });
    expect(r.inputs).toHaveLength(1);
  });
  it("throws when the board itself is malformed", async () => {
    const { fetchImpl } = fakeFetch({ status: 200, body: { nope: true } });
    await expect(fetchGreenhouseBoard("x", { fetchImpl, sleepImpl: noSleep })).rejects.toThrow();
  });
});

describe("Lever", () => {
  const ctx = boardContext({ provider: "lever", token: "deputy", company: "Deputy", industries: ["saas"] });
  it("maps internships, remote roles with salary, contracts and hybrid roles", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: fixture("lever") });
    const r = await fetchLeverBoard("deputy", { fetchImpl, sleepImpl: noSleep });
    expect(calls[0]).toBe("https://api.lever.co/v0/postings/deputy?mode=json");
    expect(r.eu).toBe(false);
    const jobs = r.inputs.map((i) => buildJob(i, ctx, NOW));
    const intern = jobs.find((j) => j.draft.name === "Creative Production Intern");
    expect(intern?.draft).toMatchObject({ type: "internship", geo: { countries: ["AU"], cities: ["Sydney"], remote: "hybrid" } });
    expect(intern?.draft.apply.url).toMatch(/\/apply$/);
    const remote = jobs.find((j) => j.draft.name === "Professional Services Operations Coordinator");
    expect(remote?.draft).toMatchObject({ type: "remote_job", geo: { countries: ["US"], remote: "remote" } });
    expect(remote?.draft.benefits?.money).toEqual({ kind: "salary", min: 78026, max: 98000, currency: "USD", period: "year" });
    expect(remote?.draft.eligibility?.minYears).toBe(3);
    const contract = jobs.find((j) => j.draft.name.startsWith("Software Engineer"));
    expect(contract?.draft.type).toBe("job");
    expect(contract?.draft.tags).toContain("contract");
    const ae = jobs.find((j) => j.draft.name === "Account Executive");
    expect(ae?.draft.geo?.cities).toEqual(["Sydney", "Melbourne"]);
    expect(ae?.draft.summary).toMatch(/^Manage and drive the full sales cycle/);
  });
  it("falls back to the EU API when the global one does not know the site", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 404 }, { status: 200, body: [] });
    const r = await fetchLeverBoard("euco", { fetchImpl, sleepImpl: noSleep });
    expect(r.eu).toBe(true);
    expect(calls[1]).toBe("https://api.eu.lever.co/v0/postings/euco?mode=json");
  });
});

describe("Ashby", () => {
  const ctx = boardContext({ provider: "ashby", token: "deepl", company: "DeepL", industries: ["ai"] });
  it("maps addresses, workplace type, secondary locations and compensation", async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 200, body: fixture("ashby") });
    const r = await fetchAshbyBoard("deepl", { fetchImpl, sleepImpl: noSleep });
    expect(calls[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/deepl?includeCompensation=true");
    const jobs = r.inputs.map((i) => buildJob(i, ctx, NOW));
    const vp = jobs.find((j) => j.draft.name === "VP of Sales, AMER");
    expect(vp?.draft).toMatchObject({ type: "job", geo: { countries: ["US"], remote: "hybrid" }, functions: ["sales"] });
    expect(vp?.draft.geo?.cities).toEqual(expect.arrayContaining(["Austin", "San Francisco"]));
    expect(vp?.draft.benefits?.money).toMatchObject({ kind: "salary", min: 212500, currency: "USD", period: "year" });
    expect(vp?.draft.summary).toMatch(/^We're looking for a VP of Sales/);
    const ml = jobs.find((j) => j.draft.name.startsWith("Senior Machine Learning"));
    expect(ml?.draft.geo?.countries).toEqual(["GB", "NL", "DE"]);
    expect(ml?.draft.tags).toEqual(expect.arrayContaining(["senior", "manager", "machine learning"]));
    const vienna = jobs.find((j) => j.draft.name.includes("Österreich"));
    expect(vienna?.draft.geo).toMatchObject({ countries: ["AT"], cities: ["Vienna"] });
    expect(vienna?.draft.slug).toMatch(/^enterprise-account-executive-in-osterreich-deepl-/);
  });
  it("hides unlisted postings", async () => {
    const body = fixture("ashby");
    body.jobs[0].isListed = false;
    const { fetchImpl } = fakeFetch({ status: 200, body });
    const r = await fetchAshbyBoard("deepl", { fetchImpl, sleepImpl: noSleep });
    expect(r.inputs).toHaveLength(body.jobs.length - 1);
  });
  it("salary ranges need one currency and one interval", () => {
    const base = ashbyJobSchema.parse(fixture("ashby").jobs[0]);
    expect(ashbySalary(base)).toMatchObject({ currency: "USD", period: "year" });
    const mixed = ashbyJobSchema.parse({
      ...fixture("ashby").jobs[0],
      compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 1, maxValue: 2 }, { compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 1, maxValue: 2 }] },
    });
    expect(ashbySalary(mixed)).toBeNull();
  });
});

describe("posting helpers", () => {
  const input = (over: Partial<JobInput>): JobInput => ({
    provider: "greenhouse", postingId: "1", title: "Engineer", url: "https://x.test/1", applyUrl: null, html: null, text: null, departments: [], employmentType: null,
    locations: [], countryHints: [], workplaceType: null, language: null, salary: null, deadline: null, publishedAt: null, updatedAt: null, ...over,
  });
  it("keeps the newest postings first for the per-board cap", () => {
    const sorted = newestFirst([input({ postingId: "a", publishedAt: "2026-01-01" }), input({ postingId: "b", publishedAt: "2026-09-01" }), input({ postingId: "c", publishedAt: null })]);
    expect(sorted.map((s) => s.postingId)).toEqual(["b", "a", "c"]);
  });
  it("visa sponsorship only when the posting says so", () => {
    expect(visaSponsorship("We are unable to sponsor visas for this role.")).toBe(false);
    expect(visaSponsorship("Candidates must be authorized to work without sponsorship.")).toBe(false);
    expect(visaSponsorship("Visa sponsorship is available for this position.")).toBe(true);
    expect(visaSponsorship("A great team.")).toBeNull();
  });
  it("a past deadline makes the posting expired; no description gets a factual summary", () => {
    const m = buildJob(input({ deadline: "2026-01-01T00:00:00Z", locations: ["Berlin, Germany"] }), boardContext({ provider: "greenhouse", token: "x", company: "Acme", industries: [] }), NOW);
    expect(m.draft.status).toBe("expired");
    expect(m.draft.rolling).toBe(false);
    expect(m.draft.summary).toBe("Engineer at Acme in Berlin.");
  });
});

describe("board list", () => {
  it("validates rows, drops duplicates and normalises the HQ", () => {
    const r = parseBoards([
      { provider: "greenhouse", token: "stripe", company: "Stripe", industries: ["fintech"], hq: "us", jobCount: 700 },
      { provider: "greenhouse", token: "Stripe", company: "Stripe again" },
      { provider: "workday", token: "x", company: "X" },
      { provider: "ashby", token: "", company: "Empty" },
      { provider: "lever", token: "deputy", company: "Deputy", hq: "" },
    ]);
    expect(r.boards.map((b) => `${b.provider}:${b.token}:${b.hq}`)).toEqual(["greenhouse:stripe:US", "lever:deputy:null"]);
    expect(r.invalid.map((i) => i.index)).toEqual([2, 3]);
  });
  it("the real board list parses (when present in this checkout)", () => {
    const file = path.join(process.cwd(), "content", "seed", "ats-boards.json");
    if (!fs.existsSync(file)) return; // the public mirror ships without seed data
    const r = parseBoards(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(r.boards.length).toBeGreaterThan(100);
    expect(r.invalid).toEqual([]);
  });
});
