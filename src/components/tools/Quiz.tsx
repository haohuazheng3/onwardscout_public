"use client";

import { useMemo, useState } from "react";
import type { QuizResult, QuizTool } from "@/content/tools/types";
import { CopyButton, OptionList, Progress, ResultPane, ToolCtaButton, copyText, useToolEvents } from "./shared";

/** Points mode: the total picks the range. Bucket mode: the most frequent bucket wins, ties go to the result listed first. */
export function scoreQuiz(tool: QuizTool, answers: number[]): QuizResult | null {
  const chosen = answers.map((a, qi) => tool.questions[qi]?.options[a]).filter(Boolean);
  if (chosen.length !== tool.questions.length) return null;
  const bucketMode = chosen.some((o) => o.bucket !== undefined);
  if (bucketMode) {
    const counts = new Map<string, number>();
    for (const o of chosen) if (o.bucket) counts.set(o.bucket, (counts.get(o.bucket) ?? 0) + 1);
    const top = Math.max(...counts.values());
    return tool.results.find((r) => r.bucket && counts.get(r.bucket) === top) ?? null;
  }
  const total = chosen.reduce((s, o) => s + (o.points ?? 0), 0);
  return tool.results.find((r) => r.range && total >= r.range[0] && total <= r.range[1]) ?? null;
}

export function QuizView({ tool, pageUrl }: { tool: QuizTool; pageUrl: string }) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [at, setAt] = useState(0);
  const [shared, setShared] = useState<"idle" | "done">("idle");
  const events = useToolEvents(tool);
  const done = at >= tool.questions.length;
  const result = useMemo(() => (done ? scoreQuiz(tool, answers) : null), [done, tool, answers]);

  const restart = () => {
    setAnswers([]);
    setAt(0);
    setShared("idle");
  };

  if (done && result) {
    const shareText = `${result.title} — my result on “${tool.title}”\n${pageUrl}`;
    return (
      <ResultPane eyebrow="Your result" title={result.title}>
        <p className="mt-3 whitespace-pre-line text-[1rem] leading-relaxed text-ink-2">{result.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ToolCtaButton tool={tool} href={result.cta?.href} label={result.cta?.label} onClick={events.cta} />
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await navigator.share({ title: tool.title, text: shareText, url: pageUrl });
                  setShared("done");
                } catch (e) {
                  if ((e as Error).name !== "AbortError") {
                    const ok = await copyText(shareText);
                    if (ok) setShared("done");
                  }
                }
              }}
            >
              {shared === "done" ? "Shared" : "Share"}
            </button>
          ) : (
            <CopyButton text={shareText} label="Copy result" className="btn btn-ghost btn-sm" />
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={restart}>
            Start over
          </button>
        </div>
        {tool.method ? (
          <details className="mt-4 text-[0.88rem] text-ink-3">
            <summary className="cursor-pointer select-none font-semibold hover:text-ink">How this result is worked out</summary>
            <p className="mt-2 leading-relaxed">{tool.method}</p>
          </details>
        ) : null}
      </ResultPane>
    );
  }

  if (done && !result) {
    return (
      <ResultPane tone="quiet" eyebrow="Your result" title="No result matches these answers">
        <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={restart}>
          Start over
        </button>
      </ResultPane>
    );
  }

  const q = tool.questions[at];
  return (
    <div>
      <Progress at={at} of={tool.questions.length} />
      <p className="mt-4 text-[1.1rem] font-semibold leading-snug text-ink">{q.q}</p>
      {q.help ? <p className="mt-1 text-[0.9rem] text-ink-4">{q.help}</p> : null}
      <div className="mt-4">
        <OptionList
          options={q.options.map((o) => o.label)}
          selected={answers[at]}
          onPick={(i) => {
            events.used();
            const next = [...answers.slice(0, at), i];
            setAnswers(next);
            setAt(at + 1);
            if (at + 1 === tool.questions.length) {
              const r = scoreQuiz(tool, next);
              events.result({ result: r?.bucket ?? r?.title ?? "none" });
            }
          }}
        />
      </div>
      {at > 0 ? (
        <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={() => setAt(at - 1)}>
          ← Back
        </button>
      ) : null}
    </div>
  );
}
