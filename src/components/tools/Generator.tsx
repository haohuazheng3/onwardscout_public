"use client";

import { useMemo, useState } from "react";
import { DEFAULT_VARIANT_COUNT, type GeneratorTool } from "@/content/tools/types";
import { countWords, hashString, midSentenceIds, placeholderIds, renderTemplate, seededShuffle } from "./templating";
import { CopyButton, InputGrid, initialValues, missingRequired, templateValues, useToolEvents, whenMatches, type Values } from "./shared";

interface Variant {
  key: string;
  group: string;
  text: string;
  missing: string[];
  words: number;
}

/**
 * Deterministic pick: groups that apply are shuffled by the seed, each group's templates are
 * shuffled by the seed too, then variants are taken round-robin so the N shown span the
 * groups. The same inputs and seed always give the same list.
 */
export function pickVariants(tool: GeneratorTool, values: Values, seed: number): { group: string; template: string; key: string }[] {
  const groups = tool.variants.map((g, gi) => ({ g, gi })).filter(({ g }) => whenMatches(g.when, values));
  const order = seededShuffle(groups, seed);
  const queues = order.map(({ g, gi }) => seededShuffle(g.templates.map((template, ti) => ({ group: g.label, template, key: `${gi}:${ti}` })), seed * 31 + gi));
  const want = tool.count ?? DEFAULT_VARIANT_COUNT;
  const out: { group: string; template: string; key: string }[] = [];
  let round = 0;
  while (out.length < want && queues.some((q) => q.length > round)) {
    for (const q of queues) {
      if (out.length >= want) break;
      if (q[round]) out.push(q[round]);
    }
    round++;
  }
  return out;
}

export function GeneratorView({ tool }: { tool: GeneratorTool }) {
  const [values, setValues] = useState<Values>(() => initialValues(tool.inputs));
  const [seed, setSeed] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const events = useToolEvents(tool);
  const midSentence = useMemo(() => midSentenceIds(tool.variants.flatMap((g) => g.templates)), [tool]);
  const started = seed > 0;

  const variants = useMemo<Variant[]>(() => {
    if (!started) return [];
    const tv = templateValues(tool.inputs, values);
    return pickVariants(tool, values, seed).map((p) => {
      const r = renderTemplate(p.template, tv, { seed: hashString(`${seed}:${p.key}:${p.template}`) });
      // Required fields, and optional ones that ship with a default (clearing those leaves a gap), are worth flagging.
      const required = new Set(tool.inputs.filter((i) => (i.type === "text" || i.type === "textarea") && (i.required || !!i.default?.trim())).map((i) => i.id));
      return { key: p.key, group: p.group, text: r.text, missing: r.missing.filter((id) => required.has(id)), words: countWords(r.text) };
    });
  }, [tool, values, seed, started]);

  const budget = useMemo(() => {
    if (!tool.lengthBudget) return null;
    const inp = tool.inputs.find((i) => i.id === tool.lengthBudget!.secondsInputId);
    const raw = values[tool.lengthBudget.secondsInputId];
    const seconds = inp?.type === "select" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return { seconds, words: Math.round(seconds * tool.lengthBudget.wordsPerSecond) };
  }, [tool, values]);

  const labelOf = (id: string) => tool.inputs.find((i) => i.id === id)?.label ?? id;

  const generate = () => {
    events.used();
    // A cleared date field that the chosen templates use counts as missing too ("my start date is." otherwise).
    const used = new Set(tool.variants.filter((g) => whenMatches(g.when, values)).flatMap((g) => g.templates.flatMap((t) => placeholderIds(t))));
    const emptyDates = tool.inputs.filter((i) => i.type === "date" && used.has(i.id) && !(typeof values[i.id] === "number" && Number.isFinite(values[i.id] as number)));
    const missing = [...missingRequired(tool.inputs, values), ...emptyDates];
    if (missing.length) {
      setHint(`Fill in ${missing.map((m) => m.label).join(", ")} first.`);
      return;
    }
    setHint(null);
    setSeed((s) => s + 1);
    events.result({ again: started });
  };

  const all = variants.map((v) => v.text).join("\n\n");

  return (
    <div>
      <InputGrid
        inputs={tool.inputs}
        midSentence={midSentence}
        values={values}
        onChange={(id, v) => {
          events.used();
          setValues((prev) => ({ ...prev, [id]: v }));
          if (hint) setHint(null);
        }}
      />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={generate}>
          {started ? (tool.againLabel ?? "Generate again") : (tool.generateLabel ?? "Generate")}
        </button>
        {started && variants.length ? <CopyButton text={all} label="Copy all" className="btn btn-ghost" /> : null}
        {hint ? (
          <p className="text-[0.9rem] text-bad" role="status">
            {hint}
          </p>
        ) : null}
      </div>

      {started ? (
        <ol className="mt-5 grid gap-3" aria-live="polite" aria-label="Generated variants">
          {variants.map((v, i) => {
            const over = budget ? v.words > budget.words : false;
            return (
              <li key={`${seed}:${v.key}`} className="pane-inset min-w-0 px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.8rem] font-semibold tabular-nums text-accent-text">
                    {i + 1}
                  </span>
                  <p className="min-w-0 flex-1 whitespace-pre-line text-[1.02rem] leading-relaxed text-ink [overflow-wrap:anywhere]">{v.text || "—"}</p>
                  <CopyButton text={v.text} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-10 text-[0.8rem] text-ink-4">
                  <span className="tag">{v.group}</span>
                  {tool.charLimit ? (
                    <span className={`tag ${v.text.length > tool.charLimit ? "tag-bad" : "tag-ok"}`}>
                      {v.text.length} / {tool.charLimit} characters
                    </span>
                  ) : null}
                  {budget ? (
                    <span className={`tag ${over ? "tag-bad" : "tag-ok"}`}>
                      {v.words} / {budget.words} words · {budget.seconds} s
                    </span>
                  ) : (
                    <span className="tabular-nums">{v.words} words</span>
                  )}
                </div>
                {v.missing.length ? <p className="mt-2 pl-10 text-[0.82rem] text-ink-4">Empty in this variant: {v.missing.map(labelOf).join(", ")}.</p> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {started && !variants.length ? <p className="mt-4 text-[0.92rem] text-ink-3">No templates apply to these choices yet.</p> : null}
    </div>
  );
}
