"use client";

import { useMemo, useState } from "react";
import type { FinderItem, FinderTool } from "@/content/tools/types";
import { CopyButton, useToolEvents } from "./shared";

/*
 * Facet filters over a curated list (grants by medium and stage, interview questions by
 * round and role). An item without a tag for a facet matches every option of that facet.
 * With `pick`, the visitor ticks up to N items and copies them as a numbered list.
 */

export type FinderSelection = Record<string, string[]>;

export function filterItems(items: readonly FinderItem[], sel: FinderSelection): FinderItem[] {
  return items.filter((it) =>
    Object.entries(sel).every(([facet, picked]) => {
      if (!picked.length) return true;
      const tags = it.tags[facet];
      return !tags || tags.some((t) => picked.includes(t));
    }),
  );
}

/** Picked items the current filters hide: listed apart so they stay visible and can be unticked. */
export function hiddenPicks(items: readonly FinderItem[], picked: readonly string[], shown: readonly FinderItem[]): FinderItem[] {
  return items.filter((it) => picked.includes(it.title) && !shown.includes(it));
}

export function FinderView({ tool }: { tool: FinderTool }) {
  const [sel, setSel] = useState<FinderSelection>(() => Object.fromEntries(tool.facets.map((f) => [f.id, []])));
  const [picked, setPicked] = useState<string[]>([]);
  const events = useToolEvents(tool);
  const shown = useMemo(() => filterItems(tool.items, sel), [tool.items, sel]);
  const pickedItems = tool.items.filter((it) => picked.includes(it.title));
  const hidden = hiddenPicks(tool.items, picked, shown);

  const toggle = (facet: string, value: string, multi: boolean) => {
    setSel((prev) => {
      const cur = prev[facet] ?? [];
      const next = value === "" ? [] : multi ? (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]) : cur[0] === value ? [] : [value];
      events.result({ facet, value });
      return { ...prev, [facet]: next };
    });
  };

  return (
    <div>
      <div className="grid gap-4">
        {tool.facets.map((f) => {
          const cur = sel[f.id] ?? [];
          return (
            <fieldset key={f.id} className="min-w-0">
              <legend className="field-label">{f.label}</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="chip" data-selected={!cur.length ? "true" : undefined} aria-pressed={!cur.length} onClick={() => toggle(f.id, "", Boolean(f.multi))}>
                  Any
                </button>
                {f.options.map((o) => {
                  const on = cur.includes(o.value);
                  return (
                    <button key={o.value} type="button" className="chip" data-selected={on ? "true" : undefined} aria-pressed={on} onClick={() => toggle(f.id, o.value, Boolean(f.multi))}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3" aria-live="polite">
        <p className="text-[0.95rem] text-ink-2">
          <span className="font-semibold tabular-nums text-ink">{shown.length}</span> of {tool.items.length} match
        </p>
        {tool.pick ? (
          <>
            <span className="tag tag-pine tabular-nums">
              {picked.length} / {tool.pick} picked
            </span>
            {pickedItems.length ? <CopyButton text={pickedItems.map((it, i) => `${i + 1}. ${it.title}`).join("\n")} label={`Copy my ${pickedItems.length}`} className="btn btn-primary btn-sm" onCopied={() => events.result({ copied: pickedItems.length })} /> : null}
          </>
        ) : null}
      </div>
      {tool.note ? <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-4">{tool.note}</p> : null}
      {tool.pick && hidden.length ? (
        <div className="mt-3">
          <p className="text-[0.86rem] text-ink-4">
            {hidden.length} of your picks {hidden.length === 1 ? "is" : "are"} hidden by the filters:
          </p>
          <ul className="mt-1 grid gap-1">
            {hidden.map((it) => (
              <li key={it.title}>
                <label className="flex items-start gap-2 text-[0.9rem] text-ink-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]" checked onChange={() => setPicked((p) => p.filter((t) => t !== it.title))} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{it.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shown.length ? (
        <ul className="mt-3 grid gap-2">
          {shown.map((it) => {
            const on = picked.includes(it.title);
            const full = tool.pick !== undefined && picked.length >= tool.pick;
            return (
              <li key={it.title} className="pane-inset min-w-0 px-4 py-3">
                <div className="flex items-start gap-3">
                  {tool.pick ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                      aria-label={`Pick: ${it.title}`}
                      checked={on}
                      disabled={!on && full}
                      onChange={() => setPicked((p) => (on ? p.filter((t) => t !== it.title) : [...p, it.title]))}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-[1rem] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                      {it.href ? (
                        <a href={it.href} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-4 hover:decoration-accent">
                          {it.title}
                        </a>
                      ) : (
                        it.title
                      )}
                    </p>
                    {it.meta ? <p className="mt-0.5 text-[0.84rem] text-ink-4">{it.meta}</p> : null}
                    <p className="mt-1 text-[0.94rem] leading-relaxed text-ink-3">{it.body}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[0.92rem] text-ink-3">{tool.emptyText ?? "Nothing matches every filter; widen one of them."}</p>
      )}
    </div>
  );
}
