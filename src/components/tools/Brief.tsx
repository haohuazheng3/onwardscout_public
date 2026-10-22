"use client";

import { useMemo, useState } from "react";
import type { BriefTool } from "@/content/tools/types";
import { hashString, renderTemplate } from "./templating";
import { CopyButton, InputGrid, initialValues, missingRequired, templateValues, useToolEvents, whenMatches, type Values } from "./shared";

export interface BriefDoc {
  title: string;
  sections: { heading: string; blocks: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] }[];
}

/** Blank lines separate paragraphs; consecutive "- " lines form one bullet list. */
function toBlocks(text: string): BriefDoc["sections"][number]["blocks"] {
  const blocks: BriefDoc["sections"][number]["blocks"] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    let items: string[] = [];
    let prose: string[] = [];
    const flush = () => {
      if (prose.length) blocks.push({ kind: "p", text: prose.join(" ") });
      if (items.length) blocks.push({ kind: "ul", items });
      prose = [];
      items = [];
    };
    for (const l of lines) {
      const bullet = /^[-*•]\s+(.*)$/.exec(l);
      if (bullet) {
        if (prose.length) flush();
        items.push(bullet[1]);
      } else {
        if (items.length) flush();
        prose.push(l);
      }
    }
    flush();
  }
  return blocks;
}

export function buildBrief(tool: BriefTool, values: Values): BriefDoc {
  const tv = templateValues(tool.inputs, values);
  const seed = hashString(JSON.stringify(values));
  const title = renderTemplate(tool.docTitle ?? tool.title, tv, { seed }).text || tool.title;
  const sections = tool.sections
    .filter((s) => whenMatches(s.when, values))
    .map((s, i) => ({
      heading: renderTemplate(s.heading, tv, { seed: seed + i }).text,
      blocks: toBlocks(renderTemplate(s.template, tv, { seed: seed + 100 + i }).text),
    }))
    .filter((s) => s.blocks.length);
  return { title, sections };
}

export function briefMarkdown(doc: BriefDoc): string {
  const out: string[] = [`# ${doc.title}`, ""];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, "");
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(b.text, "");
      else out.push(...b.items.map((i) => `- ${i}`), "");
    }
  }
  return out.join("\n").trim();
}

export function BriefView({ tool }: { tool: BriefTool }) {
  const [values, setValues] = useState<Values>(() => initialValues(tool.inputs));
  const events = useToolEvents(tool);
  const missing = missingRequired(tool.inputs, values);
  const doc = useMemo(() => buildBrief(tool, values), [tool, values]);
  const ready = missing.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <InputGrid
        inputs={tool.inputs}
        values={values}
        onChange={(id, v) => {
          events.result({ input: id });
          setValues((prev) => ({ ...prev, [id]: v }));
        }}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Your brief</p>
          {ready ? <CopyButton text={briefMarkdown(doc)} label="Copy as Markdown" className="btn btn-ghost btn-sm" onCopied={() => events.result({ copied: true })} /> : null}
        </div>
        <div className="pane-inset mt-2 px-5 py-5" aria-live="polite">
          {ready ? (
            <article className="prose-ui">
              <p className="font-display text-[1.3rem] font-semibold leading-snug text-ink" style={{ fontVariationSettings: '"SOFT" 100, "opsz" 36' }}>
                {doc.title}
              </p>
              {doc.sections.map((s) => (
                <section key={s.heading}>
                  <h3 className="!mt-5 text-[0.98rem] font-semibold text-ink">{s.heading}</h3>
                  {s.blocks.map((b, i) =>
                    b.kind === "p" ? (
                      <p key={i} className="!mt-1.5 text-[0.95rem] leading-relaxed text-ink-2">
                        {b.text}
                      </p>
                    ) : (
                      <ul key={i} className="!mt-1.5 list-disc space-y-1 pl-5 text-[0.95rem] leading-relaxed text-ink-2">
                        {b.items.map((it, j) => (
                          <li key={j}>{it}</li>
                        ))}
                      </ul>
                    ),
                  )}
                </section>
              ))}
            </article>
          ) : (
            <p className="text-[0.92rem] text-ink-4">Fill in {missing.map((m) => m.label).join(", ")} to see the brief.</p>
          )}
        </div>
      </div>
    </div>
  );
}
