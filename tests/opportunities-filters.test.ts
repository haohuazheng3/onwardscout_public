import { describe, expect, it } from "vitest";
import { OPPORTUNITY_TYPES } from "@/lib/core/opportunity-types";
import {
  DEFAULT_FILTERS,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  activeSheetFilters,
  filtersToQuery,
  hasNarrowingFilters,
  parseBoardFilters,
  parsePaging,
  sameFilters,
  tagWords,
} from "@/lib/opportunities/filters";
import { BOARD_GROUPS, boardGroupOfType, groupCounts, isBoardGroup, typesInBoardGroup } from "@/lib/opportunities/groups";

describe("parseBoardFilters", () => {
  it("returns the plain board for no parameters", () => {
    expect(parseBoardFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseBoardFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
    expect(parseBoardFilters({})).toEqual(DEFAULT_FILTERS);
  });

  it("reads every filter", () => {
    const f = parseBoardFilters(new URLSearchParams("view=later&group=funding&remote=remote&country=de&deadline=month&effort=quick&q=climate%20grants&goal=gol_k3v9q2m8"));
    expect(f).toEqual({
      view: "later",
      group: "funding",
      type: null,
      remote: "remote",
      country: "DE",
      deadline: "month",
      effort: "quick",
      q: "climate grants",
      goal: "gol_k3v9q2m8",
    });
  });

  it("drops invalid values instead of failing", () => {
    const f = parseBoardFilters({ view: "secret", group: "nope", remote: "mars", country: "Germany", deadline: "yesterday", effort: "0", goal: "x'; drop", q: "   " });
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it("takes the first of repeated parameters (Next searchParams arrays)", () => {
    expect(parseBoardFilters({ group: ["jobs", "creative"], q: ["a", "b"] })).toMatchObject({ group: "jobs", q: "a" });
  });

  it("cleans and limits the search text", () => {
    const f = parseBoardFilters({ q: `  data\n\tscience   fellowship ${"x".repeat(300)}` });
    expect(f.q?.startsWith("data science fellowship")).toBe(true);
    expect(f.q?.length).toBe(120);
  });

  it("keeps a type consistent with its chip", () => {
    expect(parseBoardFilters({ type: "grant" })).toMatchObject({ type: "grant", group: "funding" });
    expect(parseBoardFilters({ type: "hackathon", group: "stages" })).toMatchObject({ type: "hackathon", group: "stages" });
    expect(parseBoardFilters({ type: "grant", group: "jobs" })).toMatchObject({ type: null, group: "jobs" });
  });

  it("ignores the goal outside the person's picks", () => {
    expect(parseBoardFilters({ view: "all", goal: "gol_k3v9q2m8" }).goal).toBeNull();
    expect(parseBoardFilters({ view: "later", goal: "gol_k3v9q2m8" }).goal).toBe("gol_k3v9q2m8");
  });
});

describe("filtersToQuery", () => {
  it("omits defaults and keeps a stable order", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    expect(filtersToQuery({ ...DEFAULT_FILTERS, q: "ai", group: "jobs", view: "all" })).toBe("view=all&group=jobs&q=ai");
  });

  it("round-trips through the parser", () => {
    const f = parseBoardFilters({ view: "later", goal: "gol_abcd1234", group: "academic", type: "postdoc", remote: "hybrid", country: "GB", deadline: "open", effort: "long", q: "machine learning" });
    expect(parseBoardFilters(new URLSearchParams(filtersToQuery(f)))).toEqual(f);
    expect(sameFilters(f, parseBoardFilters(new URLSearchParams(filtersToQuery(f))))).toBe(true);
  });

  it("appends extra parameters (cursor, counts) and skips empty ones", () => {
    expect(filtersToQuery(DEFAULT_FILTERS, { counts: 1, cursor: 20, limit: null })).toBe("counts=1&cursor=20");
  });
});

describe("paging", () => {
  it("clamps cursor and limit", () => {
    expect(parsePaging(null)).toEqual({ offset: 0, limit: PAGE_SIZE });
    expect(parsePaging(new URLSearchParams("cursor=40&limit=10"))).toEqual({ offset: 40, limit: 10 });
    expect(parsePaging(new URLSearchParams("cursor=-5&limit=9999"))).toEqual({ offset: 0, limit: MAX_PAGE_SIZE });
    expect(parsePaging({ cursor: "abc", limit: "0" })).toEqual({ offset: 0, limit: PAGE_SIZE });
    expect(parsePaging({ cursor: "99999999" }).offset).toBe(10_000);
  });
});

describe("filter state helpers", () => {
  it("counts sheet filters and narrowing filters", () => {
    expect(activeSheetFilters(DEFAULT_FILTERS)).toBe(0);
    expect(activeSheetFilters({ ...DEFAULT_FILTERS, remote: "remote", effort: "quick", group: "jobs" })).toBe(2);
    expect(hasNarrowingFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, goal: "gol_abcd1234", view: "later" })).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, q: "x" })).toBe(true);
  });

  it("splits a search into tag words", () => {
    expect(tagWords(null)).toEqual([]);
    expect(tagWords('"machine learning" OR robotics -crypto')).toEqual(["machine learning or robotics -crypto", "machine", "learning", "robotics", "crypto"]);
    expect(tagWords("AI")).toEqual(["ai"]);
    expect(tagWords("a b c d e f g h i j k").length).toBeLessThanOrEqual(8);
  });
});

describe("board groups", () => {
  it("puts every opportunity type except practice in exactly one chip", () => {
    for (const t of OPPORTUNITY_TYPES) {
      const g = boardGroupOfType(t.id);
      if (t.id === "practice") expect(g).toBeNull();
      else expect(isBoardGroup(g)).toBe(true);
    }
    const all = BOARD_GROUPS.flatMap((g) => typesInBoardGroup(g));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(OPPORTUNITY_TYPES.length - 1);
  });

  it("files things you enter or appear at under events & stages", () => {
    for (const t of ["hackathon", "competition", "startup_competition", "pitch_event", "exhibition", "speaking", "podcast", "event"] as const) expect(boardGroupOfType(t)).toBe("stages");
    expect(boardGroupOfType("job")).toBe("jobs");
    expect(boardGroupOfType("investor")).toBe("funding");
    expect(boardGroupOfType("grant")).toBe("funding");
    expect(boardGroupOfType("postdoc")).toBe("academic");
    expect(boardGroupOfType("residency")).toBe("creative");
    expect(boardGroupOfType("community")).toBe("learning");
    expect(boardGroupOfType("visa_pathway")).toBe("learning");
    expect(boardGroupOfType("unknown")).toBeNull();
  });

  it("folds per-type counts into chip counts", () => {
    expect(groupCounts({ job: 3, internship: 2, grant: 4, hackathon: 1, practice: 1, bogus: 9 })).toEqual({ jobs: 5, funding: 4, stages: 1, academic: 0, creative: 0, learning: 0 });
  });
});
