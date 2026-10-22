import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateTool, type FinderItem, type InputDef, type Tool } from "@/content/tools/types";
import { FILTERS, placeholderIds, renderTemplate, unknownFilters } from "@/components/tools/templating";
import { compileFormula, evaluateFormula, formatDayLong, formatValue, formulaIdentifiers, isoToDay, parseFormula } from "@/components/tools/formulas";
import { extractKeywords, matchKeywords } from "@/components/tools/Keywords";
import { filterItems } from "@/components/tools/Finder";
import { parseCsv, rowsFromCsv, toCsv, type TrackerRow } from "@/components/tools/Tracker";
import { limitVerdicts, runChecker } from "@/components/tools/Checker";
import { formulaScope, templateValues, type Values } from "@/components/tools/shared";

// The tool views import the consent banner (next-intl navigation) and next/link; only pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* The free tools on the blog's A-level pages: template filters, the formula engine's date
 * functions, keyword extraction, finder filters, tracker CSV and checker limits, plus a
 * sweep over every definition in content/tools so a broken template never ships. */

describe("template filters", () => {
  it("uncap lowers the first letter but keeps I, acronyms and mixed-case names", () => {
    expect(FILTERS.uncap("At my last job")).toBe("at my last job");
    expect(FILTERS.uncap("I led the team")).toBe("I led the team");
    expect(FILTERS.uncap("I'm a designer")).toBe("I'm a designer");
    expect(FILTERS.uncap("SEO lead")).toBe("SEO lead");
    expect(FILTERS.uncap("McKinsey alumni")).toBe("McKinsey alumni");
  });
  it("usd formats numbers with separators and leaves text alone", () => {
    expect(FILTERS.usd(25000)).toBe("$25,000");
    expect(FILTERS.usd("1,500,000")).toBe("$1,500,000");
    expect(FILTERS.usd("$8000")).toBe("$8,000");
    expect(FILTERS.usd("")).toBe("");
    expect(FILTERS.usd("about 5k")).toBe("about 5k");
  });
  it("a picks the article by sound", () => {
    expect(FILTERS.a("operations manager")).toBe("an operations manager");
    expect(FILTERS.a("product designer")).toBe("a product designer");
  });
  it("renders placeholders and reports empty ones", () => {
    const r = renderTemplate("Dear {{name}}, thank you for the {{role|lower}} interview.", { name: "Ms. Lee", role: "Data Analyst" });
    expect(r.text).toBe("Dear Ms. Lee, thank you for the data analyst interview.");
    expect(renderTemplate("Hi {{name}}", { name: "" }).missing).toContain("name");
  });
});

describe("formula date functions", () => {
  const d = (iso: string) => isoToDay(iso);
  it("weekday counts Monday as 0 and knows 1970-01-01 was a Thursday", () => {
    expect(evaluateFormula("weekday(0)")).toBe(3);
    expect(evaluateFormula("weekday(x)", { x: d("2026-10-22") })).toBe(3);
    expect(evaluateFormula("weekday(x)", { x: d("2026-10-26") })).toBe(0);
  });
  it("isWeekend flags Saturday and Sunday only", () => {
    expect(evaluateFormula("isWeekend(x)", { x: d("2026-10-24") })).toBe(1);
    expect(evaluateFormula("isWeekend(x)", { x: d("2026-10-25") })).toBe(1);
    expect(evaluateFormula("isWeekend(x)", { x: d("2026-10-23") })).toBe(0);
  });
  it("addWorkdays skips weekends in both directions", () => {
    expect(evaluateFormula("addWorkdays(x, 1)", { x: d("2026-10-23") })).toBe(d("2026-10-26"));
    expect(evaluateFormula("addWorkdays(x, 7)", { x: d("2026-10-19") })).toBe(d("2026-10-28"));
    expect(evaluateFormula("addWorkdays(x, -1)", { x: d("2026-10-26") })).toBe(d("2026-10-23"));
  });
  it("log1mc gives the at-least-one-success count", () => {
    expect(evaluateFormula("ceil(log1mc(0.9) / log1mc(0.25))")).toBe(9);
    expect(Number.isNaN(evaluateFormula("log1mc(1)"))).toBe(true);
  });
  it("trials finds the exact binomial list length for at least k offers", () => {
    expect(evaluateFormula("trials(1, 0.2, 0.9)")).toBe(11);
    expect(evaluateFormula("trials(2, 0.2, 0.9)")).toBe(18);
    expect(evaluateFormula("trials(2, 0.05, 0.8)")).toBe(59);
    expect(evaluateFormula("trials(1, 0.5, 0.95)")).toBe(5);
    expect(Number.isNaN(evaluateFormula("trials(1, 0, 0.9)"))).toBe(true);
    expect(Number.isNaN(evaluateFormula("trials(1, 0.2, 1)"))).toBe(true);
  });
  it("formats dates the way a letter reads them", () => {
    expect(formatDayLong(d("2026-10-19"))).toBe("Monday, October 19");
    expect(formatValue(d("2026-10-28"), "date")).toContain("28 Oct 2026");
  });
});

describe("keyword extraction", () => {
  const jd = `Data Analyst, Customer Insights
We are looking for a data analyst to build dashboards in Tableau.
Requirements: 3+ years of SQL, experience with Tableau dashboards, A/B testing and stakeholder management.
You will present findings and run analysis on customer segmentation. SQL is used daily.`;
  it("finds the repeated tools and skills and singularizes plurals", () => {
    const phrases = extractKeywords(jd, 12).map((k) => k.phrase);
    expect(phrases).toEqual(expect.arrayContaining(["sql", "tableau"]));
    expect(phrases.some((p) => p.includes("dashboard"))).toBe(true);
    expect(phrases).not.toContain("analysi");
    expect(phrases.every((p) => /[a-z]/.test(p))).toBe(true);
  });
  it("marks what the résumé already uses", () => {
    const hits = matchKeywords(jd, "Built Tableau dashboards for the sales team.", 12);
    expect(hits.find((h) => h.phrase === "tableau")?.present).toBe(true);
    expect(hits.find((h) => h.phrase === "sql")?.present).toBe(false);
  });
});

describe("finder filters", () => {
  const items: FinderItem[] = [
    { title: "A", body: "", tags: { type: ["unrestricted"], access: ["open"] } },
    { title: "B", body: "", tags: { type: ["project"], access: ["nomination"] } },
    { title: "C", body: "", tags: { type: ["emergency"] } },
  ];
  it("keeps items matching every picked facet and treats untagged facets as any", () => {
    expect(filterItems(items, { type: [], access: [] }).map((i) => i.title)).toEqual(["A", "B", "C"]);
    expect(filterItems(items, { type: [], access: ["open"] }).map((i) => i.title)).toEqual(["A", "C"]);
    expect(filterItems(items, { type: ["project", "unrestricted"], access: ["nomination"] }).map((i) => i.title)).toEqual(["B"]);
  });
});

describe("tracker CSV", () => {
  const rows: TrackerRow[] = [
    { id: "1", company: "Acme, Inc.", role: 'Analyst "II"', applied: isoToDay("2026-10-12"), status: "Interview", next: "Send thank-you", link: "https://example.com/job", notes: "Met Ana\nfollow up Friday" },
  ];
  it("round-trips commas, quotes and line breaks", () => {
    const back = rowsFromCsv(toCsv(rows), ["Applied", "Interview", "Offer"]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ company: "Acme, Inc.", role: 'Analyst "II"', applied: isoToDay("2026-10-12"), status: "Interview", notes: "Met Ana\nfollow up Friday" });
  });
  it("reads CRLF files and skips blank lines", () => {
    expect(parseCsv('a,b\r\n\r\n"c,d",e\r\n')).toEqual([["a", "b"], ["c,d", "e"]]);
  });
  it("falls back to the first status when a status is unknown", () => {
    expect(rowsFromCsv("Company,Role,Status\nX,Y,Ghosted", ["Applied", "Offer"])[0].status).toBe("Applied");
  });
});

describe("checker limits", () => {
  const limits = [{ measure: "words" as const, label: "Letter", min: 5, max: 10 }];
  it("reports empty, short, ok and over", () => {
    expect(limitVerdicts(limits, "")[0].state).toBe("empty");
    expect(limitVerdicts(limits, "one two three")[0].state).toBe("short");
    expect(limitVerdicts(limits, "one two three four five six")[0].state).toBe("ok");
    expect(limitVerdicts(limits, "w ".repeat(12))[0].state).toBe("over");
  });
});

/* ---------------------------------------------------------------- every tool definition */

// The definitions live in the private repository only; the public mirror runs the engine tests above.
const dir = path.join(process.cwd(), "content", "tools");
const hasTools = fs.existsSync(dir);
const tools: Tool[] = (hasTools ? fs.readdirSync(dir) : [])
  .filter((f) => f.endsWith(".json"))
  .map((f) => validateTool(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), f));

/** A plausible value for every input: defaults first, then the placeholder's example. */
function sampleValues(inputs: readonly InputDef[]): Values {
  const out: Values = {};
  for (const inp of inputs) {
    if (inp.type === "text" || inp.type === "textarea") out[inp.id] = inp.default || (inp.placeholder ?? "").replace(/^e\.g\.\s*/i, "") || "Sample";
    else if (inp.type === "select") out[inp.id] = inp.default ?? inp.options[0].value;
    else if (inp.type === "multiselect") out[inp.id] = inp.default?.length ? inp.default : inp.options.slice(0, 2).map((o) => o.value);
    else if (inp.type === "number") out[inp.id] = inp.default ?? 1;
    else if (inp.type === "toggle") out[inp.id] = inp.default ?? false;
    else out[inp.id] = isoToDay("2026-10-19") + (inp.defaultOffsetDays ?? 0);
  }
  return out;
}

describe.skipIf(!hasTools)("content/tools definitions", () => {
  it("has the 46 tools the A-level pages embed", () => {
    expect(tools.length).toBe(46);
  });

  for (const tool of tools) {
    if (tool.kind === "generator" || tool.kind === "brief") {
      it(`${tool.id}: every template renders cleanly with sample input`, () => {
        const tv = templateValues(tool.inputs, sampleValues(tool.inputs));
        const ids = new Set(tool.inputs.map((i) => i.id));
        const templates = tool.kind === "generator" ? tool.variants.flatMap((g) => g.templates) : tool.sections.flatMap((s) => [s.heading, s.template]);
        for (const t of templates) {
          expect(unknownFilters(t)).toEqual([]);
          for (const id of placeholderIds(t)) expect(ids.has(id), `${tool.id}: {{${id}}}`).toBe(true);
          const text = renderTemplate(t, tv, { seed: 7 }).text;
          expect(text).not.toMatch(/\{\{|\}\}|undefined|NaN|\[object/);
        }
      });
    }
    if (tool.kind === "calculator") {
      it(`${tool.id}: formulas reference known names and give a number for sample input`, () => {
        const known = new Set(tool.inputs.map((i) => i.id));
        const scope = formulaScope(tool.inputs as never, sampleValues(tool.inputs));
        for (const o of tool.outputs) {
          for (const id of formulaIdentifiers(parseFormula(o.formula))) expect(known.has(id), `${tool.id}.${o.id}: ${id}`).toBe(true);
          scope[o.id] = compileFormula(o.formula).evaluate(scope);
          known.add(o.id);
        }
        const primary = tool.outputs.find((o) => o.primary) ?? tool.outputs[0];
        expect(Number.isFinite(scope[primary.id]), `${tool.id}.${primary.id}`).toBe(true);
      });
    }
    if (tool.kind === "checker") {
      it(`${tool.id}: every rule is a valid pattern`, () => {
        expect(() => runChecker(tool, "I am writing to apply. To whom it may concern, I am passionate.")).not.toThrow();
      });
    }
  }
});
