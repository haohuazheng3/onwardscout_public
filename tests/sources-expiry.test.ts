import { describe, expect, it } from "vitest";
import { DEADLINE_GRACE_MS, curatedStatus, isPastDeadline, keptRefs, pushRun, readSeenRuns, unseenRefs, type SeenRun } from "@/lib/sources/expiry";
import { classifyStatus, looksLikeSoft404, movedToHome } from "@/lib/sources/crawl";

const d = (s: string) => new Date(s);

describe("deadlines", () => {
  const deadline = d("2026-11-02T23:59:59Z");
  it("an opportunity is open through its deadline day everywhere (12 h grace)", () => {
    expect(isPastDeadline(deadline, d("2026-11-02T20:00:00Z"))).toBe(false);
    expect(isPastDeadline(deadline, d("2026-11-03T11:00:00Z"))).toBe(false);
    expect(isPastDeadline(deadline, new Date(deadline.getTime() + DEADLINE_GRACE_MS + 1000))).toBe(true);
    expect(isPastDeadline(null, d("2030-01-01"))).toBe(false);
  });
  it("curated status: expired after a (non-rolling) deadline, else active when verified", () => {
    const now = d("2026-12-01T00:00:00Z");
    expect(curatedStatus({ verified: true, deadline, rolling: false, now })).toBe("expired");
    expect(curatedStatus({ verified: true, deadline, rolling: true, now })).toBe("active");
    expect(curatedStatus({ verified: false, deadline: null, rolling: false, now })).toBe("unverified");
    expect(curatedStatus({ verified: true, deadline: d("2027-01-01T23:59:59Z"), rolling: false, now })).toBe("active");
  });
});

describe("jobs not seen in the last two complete runs", () => {
  const run = (at: string, refs: string[]): SeenRun => ({ at, refs });
  it("keeps the newest runs only", () => {
    let h: SeenRun[] = [];
    h = pushRun(h, run("1", ["a"]));
    h = pushRun(h, run("2", ["b"]));
    h = pushRun(h, run("3", ["c"]));
    expect(h.map((r) => r.at)).toEqual(["3", "2"]);
  });
  it("nothing expires until two runs are on record", () => {
    expect(unseenRefs(["a", "b"], [run("1", ["a"])])).toEqual([]);
  });
  it("a posting missing from one run survives; missing from two expires", () => {
    const h = [run("2", ["a"]), run("1", ["a", "b"])];
    expect(unseenRefs(["a", "b"], h)).toEqual([]);
    const h2 = pushRun(h, run("3", ["a"]));
    expect(unseenRefs(["a", "b"], h2)).toEqual(["b"]);
    expect(keptRefs(h2).sort()).toEqual(["a"]);
  });
  it("an empty board twice in a row closes everything", () => {
    expect(keptRefs([run("2", []), run("1", [])])).toEqual([]);
    expect(unseenRefs(["a"], [run("2", []), run("1", [])])).toEqual(["a"]);
  });
  it("reads the history stored on the source row defensively", () => {
    expect(readSeenRuns({ extra: { seenRuns: [{ at: "x", refs: ["a", 1] }, { nope: true }] } })).toEqual([{ at: "x", refs: ["a"] }]);
    expect(readSeenRuns(null)).toEqual([]);
    expect(readSeenRuns({ extra: { seenRuns: "bad" } })).toEqual([]);
  });
});

describe("program page checks", () => {
  it("only 404/410 mean gone; walls and failures are never a verdict", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(404)).toBe("gone");
    expect(classifyStatus(410)).toBe("gone");
    expect(classifyStatus(403)).toBe("blocked");
    expect(classifyStatus(429)).toBe("blocked");
    expect(classifyStatus(503)).toBe("error");
    expect(classifyStatus(null)).toBe("error");
  });
  it("recognises a not-found page served with 200", () => {
    expect(looksLikeSoft404("Page not found | Acme", "Sorry, we could not find that page.")).toBe(true);
    expect(looksLikeSoft404("Acme Fellowship 2027", "Apply now")).toBe(false);
    expect(looksLikeSoft404("404", "x".repeat(5000))).toBe(false);
  });
  it("notices deep links that now land on the home page", () => {
    expect(movedToHome("https://x.org/programs/fellowship", "https://x.org/")).toBe(true);
    expect(movedToHome("https://x.org/programs/fellowship", "https://x.org/en/")).toBe(true);
    expect(movedToHome("https://x.org/", "https://x.org/en")).toBe(false);
    expect(movedToHome("https://x.org/a", "https://x.org/b")).toBe(false);
    expect(movedToHome("https://x.org/a", null)).toBe(false);
  });
});
