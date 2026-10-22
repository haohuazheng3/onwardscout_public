"use client";

import { useState } from "react";
import type { DecisionTool } from "@/content/tools/types";
import { OptionList, ResultPane, ToolCtaButton, useToolEvents } from "./shared";

export function DecisionView({ tool }: { tool: DecisionTool }) {
  const start = tool.start ?? Object.keys(tool.nodes)[0];
  const [path, setPath] = useState<string[]>([start]);
  const [leafId, setLeafId] = useState<string | null>(null);
  const events = useToolEvents(tool);
  const leaf = leafId ? tool.leaves[leafId] : null;

  const restart = () => {
    setPath([start]);
    setLeafId(null);
  };

  if (leaf) {
    return (
      <ResultPane eyebrow="Our read" title={leaf.title}>
        <p className="mt-3 whitespace-pre-line text-[1rem] leading-relaxed text-ink-2">{leaf.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ToolCtaButton tool={tool} href={leaf.cta?.href} label={leaf.cta?.label} onClick={events.cta} />
          <button type="button" className="btn btn-quiet btn-sm" onClick={restart}>
            Start over
          </button>
        </div>
      </ResultPane>
    );
  }

  const node = tool.nodes[path[path.length - 1]];
  return (
    <div>
      <p className="text-[0.8rem] text-ink-4">Step {path.length}</p>
      <p className="mt-2 text-[1.1rem] font-semibold leading-snug text-ink">{node.question}</p>
      {node.help ? <p className="mt-1 text-[0.9rem] text-ink-4">{node.help}</p> : null}
      <div className="mt-4">
        <OptionList
          options={node.options.map((o) => o.label)}
          onPick={(i) => {
            events.used();
            const next = node.options[i].next;
            if (next in tool.leaves) {
              setLeafId(next);
              events.result({ leaf: next });
            } else setPath([...path, next]);
          }}
        />
      </div>
      {path.length > 1 ? (
        <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={() => setPath(path.slice(0, -1))}>
          ← Back
        </button>
      ) : null}
    </div>
  );
}
