"use client";

import { useState } from "react";
import type { ChecklistTool } from "@/content/tools/types";
import { CopyButton, useToolEvents } from "./shared";

const storageKey = (id: string) => `wm-tool:${id}`;

function readTicks(id: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Plain-text export: section headings and "- [x]" / "- [ ]" lines. */
export function checklistText(tool: ChecklistTool, ticked: Set<string>): string {
  const lines: string[] = [tool.title, ""];
  tool.sections.forEach((s, si) => {
    lines.push(s.title);
    s.items.forEach((it, ii) => lines.push(`- [${ticked.has(`${si}:${ii}`) ? "x" : " "}] ${it.text}`));
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function ChecklistView({ tool }: { tool: ChecklistTool }) {
  // The view mounts only after hydration (ToolRunner shows a skeleton before), so the saved ticks can seed the state directly.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(readTicks(tool.id)));
  const events = useToolEvents(tool);
  const total = tool.sections.reduce((n, s) => n + s.items.length, 0);
  const done = ticked.size;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const update = (next: Set<string>) => {
    setTicked(next);
    try {
      localStorage.setItem(storageKey(tool.id), JSON.stringify([...next]));
    } catch (e) {
      console.warn("[tool] checklist not saved", e);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.86rem] text-ink-3">
        <span>
          <span className="font-semibold tabular-nums text-ink">
            {done} of {total}
          </span>{" "}
          done
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-pane-3" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Checklist progress">
        <div className={`h-full rounded-full transition-[width] duration-300 ${done === total ? "bg-ok" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-5 space-y-5">
        {tool.sections.map((s, si) => (
          <fieldset key={s.title} className="pane-inset px-4 py-4 sm:px-5">
            <legend className="eyebrow px-1">{s.title}</legend>
            <ul className="mt-1 space-y-1">
              {s.items.map((it, ii) => {
                const key = `${si}:${ii}`;
                const on = ticked.has(key);
                return (
                  <li key={key}>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-pane-3/60">
                      <input
                        type="checkbox"
                        className="mt-[0.3em] h-5 w-5 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
                        checked={on}
                        onChange={() => {
                          events.used();
                          const next = new Set(ticked);
                          if (on) next.delete(key);
                          else next.add(key);
                          if (next.size === total) events.result({ complete: true });
                          update(next);
                        }}
                      />
                      <span className="min-w-0">
                        <span className={`block text-[0.98rem] leading-relaxed ${on ? "text-ink-4 line-through" : "text-ink"}`}>{it.text}</span>
                        {it.note ? <span className="block text-[0.84rem] leading-relaxed text-ink-4">{it.note}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <CopyButton text={checklistText(tool, ticked)} label="Copy as text" className="btn btn-ghost btn-sm" onCopied={() => events.result({ copied: true })} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>
          Print
        </button>
        {done ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => update(new Set())}>
            Reset
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-[0.8rem] text-ink-4">Ticks are saved in this browser only.</p>
    </div>
  );
}
