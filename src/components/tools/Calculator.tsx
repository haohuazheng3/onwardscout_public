"use client";

import { useMemo, useState } from "react";
import type { CalculatorTool } from "@/content/tools/types";
import { compileFormula, formatValue, type Scope } from "./formulas";
import { InputGrid, formulaScope, initialValues, useToolEvents, type Values } from "./shared";

/** Outputs in order, each one able to read the ones before it; a failing formula yields NaN ("—"). */
export function computeOutputs(outputs: { id: string; fn: { evaluate(scope: Scope): number } }[], scope: Scope): { values: Record<string, number>; scope: Scope } {
  const values: Record<string, number> = {};
  const s: Scope = { ...scope };
  for (const o of outputs) {
    let v = NaN;
    try {
      v = o.fn.evaluate(s);
    } catch (e) {
      console.warn("[tool] formula failed", o.id, e);
    }
    values[o.id] = v;
    s[o.id] = v;
  }
  return { values, scope: s };
}

/** Test/script helper: run a calculator's outputs against a scope of input numbers. */
export function runCalculator(tool: CalculatorTool, scope: Scope): Record<string, number> {
  return computeOutputs(
    tool.outputs.map((o) => ({ id: o.id, fn: compileFormula(o.formula) })),
    scope,
  ).values;
}

export function CalculatorView({ tool }: { tool: CalculatorTool }) {
  const [values, setValues] = useState<Values>(() => initialValues(tool.inputs));
  const events = useToolEvents(tool);
  const compiled = useMemo(
    () => ({
      outputs: tool.outputs.map((o) => ({ ...o, fn: compileFormula(o.formula) })),
      columns: (tool.table?.columns ?? []).map((c) => ({ ...c, fn: compileFormula(c.formula) })),
    }),
    [tool],
  );

  const scope = useMemo(() => formulaScope(tool.inputs, values), [tool.inputs, values]);
  const results = useMemo(() => computeOutputs(compiled.outputs, scope), [compiled, scope]);

  const primaryId = (tool.outputs.find((o) => o.primary) ?? tool.outputs[0]).id;
  const primary = tool.outputs.find((o) => o.id === primaryId)!;
  const others = tool.outputs.filter((o) => o.id !== primaryId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <InputGrid
        inputs={tool.inputs}
        values={values}
        onChange={(id, v) => {
          events.result({ input: id });
          setValues((prev) => ({ ...prev, [id]: v }));
        }}
      />
      <div className="pane-inset min-w-0 px-5 py-5" aria-live="polite">
        <p className="eyebrow">{primary.label}</p>
        <p className="font-display mt-2 text-[2.6rem] font-semibold leading-none tabular-nums text-accent-text" style={{ fontVariationSettings: '"SOFT" 100, "opsz" 72' }}>
          {formatValue(results.values[primary.id], primary.format)}
        </p>
        {primary.note ? <p className="mt-2 text-[0.84rem] leading-snug text-ink-4">{primary.note}</p> : null}
        {others.length ? (
          <dl className="mt-4 space-y-2.5 border-t border-line pt-4">
            {others.map((o) => (
              <div key={o.id} className="flex items-baseline justify-between gap-3">
                <dt className="text-[0.9rem] text-ink-3">
                  {o.label}
                  {o.note ? <span className="block text-[0.78rem] text-ink-4">{o.note}</span> : null}
                </dt>
                <dd className="shrink-0 text-[1.05rem] font-semibold tabular-nums text-ink">{formatValue(results.values[o.id], o.format)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {tool.table ? (
        <div className="min-w-0 overflow-x-auto rounded-[20px] shadow-[inset_0_0_0_1px_var(--line)] lg:col-span-2">
          <table className="w-full whitespace-nowrap text-[0.93rem]">
            {tool.table.label ? <caption className="px-4 pt-3 text-left text-[0.82rem] text-ink-4">{tool.table.label}</caption> : null}
            <thead className="bg-pane-2">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-ink">
                  {tool.table.rowLabel}
                </th>
                {tool.table.columns.map((c) => (
                  <th key={c.label} scope="col" className="px-4 py-3 text-right font-semibold text-ink">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tool.table.rows.map((row) => {
                const rowScope: Scope = { ...results.scope, [tool.table!.rowVar]: row };
                return (
                  <tr key={row} className="border-t border-line">
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold tabular-nums text-ink-2">
                      {formatValue(row, tool.table!.rowFormat)}
                    </th>
                    {compiled.columns.map((c) => {
                      let v = NaN;
                      try {
                        v = c.fn.evaluate(rowScope);
                      } catch (e) {
                        console.warn("[tool] table formula failed", c.label, e);
                      }
                      return (
                        <td key={c.label} className="px-4 py-2.5 text-right tabular-nums text-ink-2">
                          {formatValue(v, c.format)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {tool.note ? <p className="text-[0.84rem] leading-relaxed text-ink-4 lg:col-span-2">{tool.note}</p> : null}
    </div>
  );
}
