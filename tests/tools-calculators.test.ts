import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { validateTool, type CalculatorTool } from "@/content/tools/types";
import { formatValue, isoToDay } from "@/components/tools/formulas";
import { CalculatorView, runCalculator } from "@/components/tools/Calculator";
import { formulaScope, type Values } from "@/components/tools/shared";

// The calculator view imports the consent banner (next-intl navigation) and next/link; only pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* Regression tests for the calculator engine and the calculator definitions: inputs shown on a
 * condition, the follow-up date never moves earlier because of a closing date,
 * and the daily application target is the weekly need spread over the applying days. */

function calculator(def: Record<string, unknown>): CalculatorTool {
  const tool = validateTool({ id: "test-calculator", kind: "calculator", title: "Test", lede: "Test calculator.", ...def }, "test");
  if (tool.kind !== "calculator") throw new Error("not a calculator");
  return tool;
}

const day = (iso: string) => isoToDay(iso);

describe("inputs shown on a condition", () => {
  const tool = calculator({
    inputs: [
      { id: "start", type: "date", label: "Start" },
      { id: "mode", type: "select", label: "Mode", options: [{ value: "0", label: "Start only" }, { value: "1", label: "Start and end" }], default: "0" },
      { id: "end", type: "date", label: "End", when: { input: "mode", is: "1" } },
    ],
    outputs: [{ id: "due", label: "Due", formula: "if(mode == 1, max(start, end), start) + 7", format: "date" }],
  });

  it("renders the field only while its condition holds", () => {
    const html = renderToStaticMarkup(createElement(CalculatorView, { tool }));
    expect(html).toContain(">Start<");
    expect(html).not.toContain(">End<");
    expect(html.match(/type="date"/g)).toHaveLength(1);
  });

  it("rejects a condition on an unknown input or on the input itself", () => {
    expect(() => calculator({ inputs: [{ id: "a", type: "date", label: "A", when: { input: "zzz", is: "1" } }], outputs: [{ id: "o", label: "O", formula: "a", format: "date" }] })).toThrow(/does not exist/);
    expect(() => calculator({ inputs: [{ id: "a", type: "number", label: "A", when: { input: "a", is: "1" } }], outputs: [{ id: "o", label: "O", formula: "a", format: "int" }] })).toThrow(/itself/);
  });
});

/* ---------------------------------------------------------------- the definitions */

// The definitions live in the private repository only; the public mirror runs the engine tests above.
const dir = path.join(process.cwd(), "content", "tools");
const hasTools = fs.existsSync(dir);
const load = (id: string): CalculatorTool => {
  const tool = validateTool(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")), id);
  if (tool.kind !== "calculator") throw new Error(`${id} is not a calculator`);
  return tool;
};

describe.skipIf(!hasTools)("application-follow-up-calculator", () => {
  const tool = hasTools ? load("application-follow-up-calculator") : (null as never);
  const run = (v: { applied: string; closing: "0" | "1"; closes: string; contact?: "0" | "1" }) => {
    const values: Values = { applied: day(v.applied), closing: v.closing, closes: day(v.closes), contact: v.contact ?? "1" };
    const scope = formulaScope(tool.inputs, values);
    const out = runCalculator(tool, scope);
    return { out, scope, dates: Object.fromEntries(Object.entries(out).map(([k, x]) => [k, formatValue(x, "date")])) };
  };

  it("ignores the closing date while 'No closing date' is picked and uses it once 'Yes' is", () => {
    expect(run({ applied: "2026-10-12", closing: "0", closes: "2026-10-30" }).dates.first).toBe("Mon 19 Oct 2026");
    expect(run({ applied: "2026-10-12", closing: "1", closes: "2026-10-30" }).dates.first).toBe("Wed 4 Nov 2026");
  });

  it("renders without the closing date field until 'Yes, it closes on a set day' is picked", () => {
    const html = renderToStaticMarkup(createElement(CalculatorView, { tool }));
    expect(html).toContain("Date you applied");
    expect(html).not.toContain(">Closing date<");
    expect(html.match(/type="date"/g)).toHaveLength(1);
  });

  it("a closing date only ever pushes the follow-up later", () => {
    const none = run({ applied: "2026-10-12", closing: "0", closes: "2026-10-12" }).dates;
    expect([none.first, none.second, none.moveOn]).toEqual(["Mon 19 Oct 2026", "Mon 26 Oct 2026", "Mon 2 Nov 2026"]);
    for (const closes of ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]) {
      const d = run({ applied: "2026-10-12", closing: "1", closes }).dates;
      expect([d.first, d.second, d.moveOn], closes).toEqual(["Mon 19 Oct 2026", "Mon 26 Oct 2026", "Mon 2 Nov 2026"]);
    }
    expect(run({ applied: "2026-10-12", closing: "1", closes: "2026-10-15" }).dates.first).toBe("Tue 20 Oct 2026");
    expect(run({ applied: "2026-10-12", closing: "1", closes: "2026-10-30" }).dates.first).toBe("Wed 4 Nov 2026");
  });

  it("never earlier than without a closing date, and never earlier for a later closing date", () => {
    for (const applied of ["2026-10-12", "2026-10-16", "2026-10-17"]) {
      const without = run({ applied, closing: "0", closes: applied }).out.first;
      let prev = -Infinity;
      for (let off = -20; off <= 30; off++) {
        const closes = new Date(Date.UTC(2026, 9, 12 + off)).toISOString().slice(0, 10);
        const first = run({ applied, closing: "1", closes }).out.first;
        expect(first, `${applied} / ${closes}`).toBeGreaterThanOrEqual(without);
        expect(first, `${applied} / ${closes}`).toBeGreaterThanOrEqual(prev);
        prev = first;
      }
    }
  });
});

describe.skipIf(!hasTools)("applications-per-day-calculator", () => {
  const tool = hasTools ? load("applications-per-day-calculator") : (null as never);
  const run = (v: Partial<{ offers: number; weeks: number; response: number; offerRate: number; days: string }>) => {
    const values: Values = { offers: 2, weeks: 8, response: 5, offerRate: 20, days: "5", ...v };
    const out = runCalculator(tool, formulaScope(tool.inputs, values));
    const fmt = (id: string) => formatValue(out[id], tool.outputs.find((o) => o.id === id)!.format);
    return { out, perDay: fmt("perDay"), perWeek: fmt("perWeek"), hours: fmt("hours") };
  };

  it("spreads the weekly need over the applying days instead of rounding up twice", () => {
    expect(run({ offers: 1, weeks: 26, response: 10, offerRate: 25, days: "5" })).toMatchObject({ perWeek: "2", perDay: "0.4", hours: "1" });
    expect(run({ offers: 1, weeks: 52, response: 10, offerRate: 50, days: "3" })).toMatchObject({ perWeek: "1", perDay: "0.3" });
    expect(run({ weeks: 12 })).toMatchObject({ perWeek: "17", perDay: "3.4" });
  });

  it("keeps the defaults the article quotes and agrees with the per-week figure", () => {
    expect(run({}).perDay).toBe("5");
    expect(run({ days: "7" }).perDay).toBe("3.6");
    expect(run({ days: "3" }).perDay).toBe("8.3");
    for (const weeks of [1, 4, 8, 12, 26, 52]) {
      for (const days of ["3", "5", "7"]) {
        const { out } = run({ weeks, days });
        expect(Math.abs(out.perDay * Number(days) - out.perWeek), `${weeks}w ${days}d`).toBeLessThanOrEqual(0.05 * Number(days) + 1e-9);
      }
    }
  });
});
