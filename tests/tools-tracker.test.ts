import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FinderItem } from "@/content/tools/types";
import { isoToDay, todayDays } from "@/components/tools/formulas";
import { filterItems, hiddenPicks } from "@/components/tools/Finder";
import { decodeCsv, normalizeLink, parseCsv, rowsFromCsv, rowsFromStorage, rowsFromStorageEvent, toCsv, type TrackerRow } from "@/components/tools/Tracker";

// The tool views import the consent banner (next-intl navigation) and next/link; only pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* Regressions for the job application tracker (CSV import/export, links, saved rows) and the
 * finder tools (picks hidden by filters, grant type tags). */

// The tool definitions live in the private repository only; the public mirror uses the same statuses and skips the finder data.
const hasTools = fs.existsSync(path.join(process.cwd(), "content/tools", "job-application-tracker.json"));
const tool = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "content/tools", `${id}.json`), "utf8"));
const STATUSES: string[] = hasTools ? tool("job-application-tracker").statuses : ["Applied", "Screen", "Interview", "Final round", "Offer", "Rejected", "No response", "Withdrawn"];
const brief = (rows: TrackerRow[]) => rows.map((r) => ({ company: r.company, role: r.role, applied: r.applied, status: r.status }));

describe("tracker CSV headers", () => {
  it("finds Company name / Job title / Date applied columns and never imports the header row", () => {
    const r = rowsFromCsv("Date Applied,Company Name,Position,Status,Notes\n2026-09-01,Acme,Analyst,Interview,met Sam\n2026-09-03,Beta,PM,Rejected,\n", STATUSES);
    expect(r.error).toBeUndefined();
    expect(r.unreadableDates).toBe(0);
    expect(brief(r.rows)).toEqual([
      { company: "Acme", role: "Analyst", applied: isoToDay("2026-09-01"), status: "Interview" },
      { company: "Beta", role: "PM", applied: isoToDay("2026-09-03"), status: "Rejected" },
    ]);
    expect(r.rows[0].notes).toBe("met Sam");
  });
  it("takes the role from Job title, not from the column after Company", () => {
    const r = rowsFromCsv("Company,Location,Job Title,Date Applied,Status\nAcme,Berlin,Analyst,2026-09-01,Interview\n", STATUSES);
    expect(brief(r.rows)).toEqual([{ company: "Acme", role: "Analyst", applied: isoToDay("2026-09-01"), status: "Interview" }]);
  });
  it("reads Employer name / Application date / Stage", () => {
    const r = rowsFromCsv("Employer Name,Job Title,Application Date,Stage\nAcme,Analyst,2026-09-01,Offer\n", STATUSES);
    expect(r.unreadableDates).toBe(0);
    expect(brief(r.rows)).toEqual([{ company: "Acme", role: "Analyst", applied: isoToDay("2026-09-01"), status: "Offer" }]);
  });
  it("refuses a file whose header has no Company column instead of importing junk rows", () => {
    const r = rowsFromCsv("Firm,Job Title,Date Applied\nAcme,Analyst,2026-09-01\n", STATUSES);
    expect(r.rows).toEqual([]);
    expect(r.error).toMatch(/Company/);
  });
  it("still reads a headerless file as company, role, even when a cell says Applied", () => {
    expect(rowsFromCsv("Acme,Analyst,2026-09-01,Applied\nBeta,PM,2026-09-02,Interview\n", STATUSES).rows.map((x) => x.company)).toEqual(["Acme", "Beta"]);
    const r = rowsFromCsv("Acme,Analyst,,Applied\n", STATUSES);
    expect(r.error).toBeUndefined();
    expect(r.rows.map((x) => [x.company, x.role])).toEqual([["Acme", "Analyst"]]);
  });
});

describe("tracker CSV statuses", () => {
  it("maps other trackers' words and keeps an unknown status in notes, counted", () => {
    const r = rowsFromCsv(
      "Company,Role,Applied,Status,Notes\nA,R,2026-09-01,Interviewing,\nB,R,2026-09-02,Phone Screen,\nC,R,2026-09-03,Ghosted,\nD,R,2026-09-04,Not selected,\nE,R,2026-09-05,Offer accepted,\nF,R,2026-09-05,On hold,call back in May\n",
      STATUSES,
    );
    expect(r.rows.map((x) => x.status)).toEqual(["Interview", "Screen", "No response", "Rejected", "Offer", "Applied"]);
    expect(r.unknownStatuses).toBe(1);
    expect(r.rows[5].notes).toBe("Status in file: On hold · call back in May");
    expect(r.rows[0].notes).toBe("");
  });
  it("uses a synonym only when the tool has that status", () => {
    const r = rowsFromCsv("Company,Role,Status\nX,Y,Ghosted", ["Applied", "Offer"]);
    expect(r.rows[0].status).toBe("Applied");
    expect(r.unknownStatuses).toBe(1);
    expect(r.rows[0].notes).toBe("Status in file: Ghosted");
  });
});

describe("tracker CSV delimiters and encoding", () => {
  it("reads semicolon (European Excel) and tab-separated files", () => {
    const semi = rowsFromCsv("Company;Role;Applied;Status\r\nAcme;Data analyst;2026-09-01;Interview\r\nBeta;PM;2026-09-02;Rejected\r\n", STATUSES);
    expect(semi.unreadableDates).toBe(0);
    expect(brief(semi.rows)).toEqual([
      { company: "Acme", role: "Data analyst", applied: isoToDay("2026-09-01"), status: "Interview" },
      { company: "Beta", role: "PM", applied: isoToDay("2026-09-02"), status: "Rejected" },
    ]);
    const tsv = rowsFromCsv("Company\tRole\tApplied\tStatus\nAcme\tAnalyst\t2026-09-01\tInterview\n", STATUSES);
    expect(brief(tsv.rows)).toEqual([{ company: "Acme", role: "Analyst", applied: isoToDay("2026-09-01"), status: "Interview" }]);
  });
  it("keeps commas as the delimiter when a quoted header cell holds a semicolon", () => {
    expect(parseCsv('"a;b",c\nd,e')).toEqual([["a;b", "c"], ["d", "e"]]);
  });
  it("decodes UTF-8 (with or without BOM) and falls back to Windows-1252", () => {
    expect(decodeCsv(new Uint8Array([0x4e, 0x65, 0x73, 0x74, 0x6c, 0xe9]))).toBe("Nestlé");
    expect(decodeCsv(new Uint8Array([0x57, 0x6f, 0x6d, 0x65, 0x6e, 0x92, 0x73]))).toBe("Women’s");
    expect(decodeCsv(new TextEncoder().encode("﻿Company\nNestlé"))).toBe("Company\nNestlé");
  });
  it("round-trips an export with a BOM and accented names", () => {
    const rows: TrackerRow[] = [{ id: "1", company: "Nestlé", role: "Ingénieur", applied: isoToDay("2026-10-12"), status: "Interview", next: "", link: "", notes: "" }];
    const r = rowsFromCsv(decodeCsv(new TextEncoder().encode("﻿" + toCsv(rows))), STATUSES);
    expect(r.unreadableDates).toBe(0);
    expect(brief(r.rows)).toEqual(brief(rows));
  });
});

describe("tracker CSV dates", () => {
  it("reads an Excel column of US dates when one date settles the order", () => {
    const r = rowsFromCsv("﻿Company,Role,Applied,Status\r\nAcme,Analyst,10/15/2026,Interview\r\nBeta,PM,9/2/2026,Applied\r\n", STATUSES);
    expect(r.unreadableDates).toBe(0);
    expect(r.rows.map((x) => x.applied)).toEqual([isoToDay("2026-10-15"), isoToDay("2026-09-02")]);
  });
  it("reads an Excel column of day-first dates", () => {
    const r = rowsFromCsv("Company,Role,Applied\nAcme,Analyst,15/10/2026\nBeta,PM,02/09/2026\n", STATUSES);
    expect(r.unreadableDates).toBe(0);
    expect(r.rows.map((x) => x.applied)).toEqual([isoToDay("2026-10-15"), isoToDay("2026-09-02")]);
  });
  it("counts a wholly ambiguous column and impossible dates instead of guessing or rolling over", () => {
    const today = todayDays();
    const amb = rowsFromCsv("Company,Role,Applied\nAcme,Analyst,10/12/2026\nBeta,PM,02/09/2026\n", STATUSES);
    expect(amb.unreadableDates).toBe(2);
    expect(amb.rows.map((x) => x.applied)).toEqual([today, today]);
    const bad = rowsFromCsv("Company,Role,Applied\nAcme,Analyst,2026-02-30\nB,R,2026-10\n", STATUSES);
    expect(bad.unreadableDates).toBe(2);
    expect(bad.rows.map((x) => x.applied)).toEqual([today, today]);
  });
});

describe("tracker links", () => {
  it("makes a link without a scheme absolute and drops what is not a web link", () => {
    expect(normalizeLink("acme.com/jobs/123")).toBe("https://acme.com/jobs/123");
    expect(normalizeLink("www.linkedin.com/jobs/view/1")).toBe("https://www.linkedin.com/jobs/view/1");
    expect(normalizeLink("acme.com:8080/jobs")).toBe("https://acme.com:8080/jobs");
    expect(normalizeLink("//boards.example.com/a")).toBe("https://boards.example.com/a");
    expect(normalizeLink("https://example.com/job?a=1,2")).toBe("https://example.com/job?a=1,2");
    expect(normalizeLink("javascript:alert(1)")).toBe("");
    expect(normalizeLink("mailto:hr@acme.com")).toBe("");
    expect(normalizeLink("n/a")).toBe("");
    expect(normalizeLink("")).toBe("");
  });
  it("normalizes links on import", () => {
    expect(rowsFromCsv("Company,Role,Link\nAcme,Analyst,www.acme.com/jobs/1\n", STATUSES).rows[0].link).toBe("https://www.acme.com/jobs/1");
  });
});

describe("tracker saved rows", () => {
  const saved = (applied: unknown) => JSON.stringify([{ id: "a", company: "X", role: "R", applied, status: "Applied", next: "", link: "", notes: "" }, null, { foo: 1 }]);
  it("repairs a lost date (a five-digit year saved as null) and drops malformed entries", () => {
    expect(isoToDay("20266-10-15")).toBeNaN();
    const rows = rowsFromStorage(saved(null));
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ id: "a", company: "X", applied: todayDays() });
    expect(rowsFromStorage(saved(20740))![0].applied).toBe(20740);
    expect(rowsFromStorage(null)).toBeNull();
  });
  it("takes the rows another tab saved, and ignores other keys and unreadable values", () => {
    const key = "os-tool:job-application-tracker";
    expect(rowsFromStorageEvent({ key, newValue: saved(20740) }, key)!.map((r) => r.company)).toEqual(["X"]);
    expect(rowsFromStorageEvent({ key: "other", newValue: saved(20740) }, key)).toBeUndefined();
    expect(rowsFromStorageEvent({ key, newValue: "{not json" }, key)).toBeUndefined();
    expect(rowsFromStorageEvent({ key: null, newValue: null }, key)).toBeNull();
  });
});

describe.skipIf(!hasTools)("finder picks and tags", () => {
  it("lists picks the current filters hide, so they can still be unticked", () => {
    const iq = tool("interview-questions-picker");
    const items = iq.items as FinderItem[];
    const screen = filterItems(items, { stage: ["screen"], topic: [] });
    const picked = screen.slice(0, 5).map((x) => x.title);
    const final = filterItems(items, { stage: ["final"], topic: [] });
    const hidden = hiddenPicks(items, picked, final);
    expect(hidden.length).toBe(picked.filter((t) => !final.some((x) => x.title === t)).length);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((x) => picked.includes(x.title) && !final.includes(x))).toBe(true);
    expect(hiddenPicks(items, picked, screen)).toEqual([]);
  });
  it("tags grants by what their own description says", () => {
    const items = tool("artist-grants-finder").items as FinderItem[];
    const titles = (type: string) => filterItems(items, { type: [type], access: [], stage: [], medium: [] }).map((x) => x.title);
    expect(titles("unrestricted")).toContain("Creative Capital Award");
    expect(titles("project")).toContain("Creative Capital Award");
    expect(titles("fellowship")).toContain("NYSCA/NYFA Artist Fellowship");
    expect(titles("unrestricted")).toContain("NYSCA/NYFA Artist Fellowship");
  });
  it("review fixes: specific headers first, header detection, UTF-16 text, email is not a link", () => {
    const S = ["Applied", "Screen", "Interview", "Offer", "Rejected", "Withdrawn", "No response"];
    const a = rowsFromCsv("Company,Role,Applied?,Date Applied,Status\nAcme,Analyst,Yes,2026-09-01,Interview\n", S);
    expect(a.rows[0].applied).toBe(isoToDay("2026-09-01"));
    expect(rowsFromCsv("Company,Job Position,Date Applied,Status\nAcme,Analyst,2026-09-01,Interview\n", S).rows[0].role).toBe("Analyst");
    expect(rowsFromCsv("Acme,Analyst,,Interview,Follow up\n", S).rows).toHaveLength(1);
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("Company\tRole\r\nNestlé\tAnalyst").flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(decodeCsv(utf16)).toContain("Nestlé");
    expect(normalizeLink("hr@acme.com")).toBe("");
    expect(normalizeLink("acme.com/jobs/123")).toBe("https://acme.com/jobs/123");
  });
});
