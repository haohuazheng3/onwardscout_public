"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { CheckerLimit, CheckerRule, CheckerTool, Severity } from "@/content/tools/types";
import { countWords } from "./templating";
import { useToolEvents } from "./shared";

export interface CheckerFinding {
  rule: string;
  label: string;
  severity: Severity;
  message: string;
  suggestion?: string;
  match: string;
  index: number;
}

const SEVERITY_ORDER: Severity[] = ["fatal", "warn", "info"];

const SEVERITY_UI: Record<Severity, { title: string; tag: string; mark: string; tone: string }> = {
  fatal: { title: "Fix before sending", tag: "tag-bad", mark: "bg-bad-soft", tone: "text-bad" },
  warn: { title: "Check", tag: "tag-accent", mark: "bg-accent-soft", tone: "text-accent-text" },
  info: { title: "Good to know", tag: "tag-pine", mark: "bg-pane-3", tone: "text-ink-3" },
};

/** Every match of every rule (regexes from the tool definition), in text order. */
export function runChecker(tool: CheckerTool, text: string): CheckerFinding[] {
  const out: CheckerFinding[] = [];
  for (const set of tool.ruleSets) {
    const rule: CheckerRule = set;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, `g${rule.flags ?? ""}`);
    } catch (e) {
      console.warn("[tool] checker rule failed", rule.id, e);
      continue;
    }
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      out.push({ rule: rule.id, label: rule.label, severity: rule.severity, message: rule.message, suggestion: rule.suggestion, match: m[0], index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function sentenceCount(text: string): number {
  const parts = text
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length;
}

/** Flesch–Kincaid grade level (US school grade) from word, sentence and syllable counts. */
export function readingGrade(text: string): number {
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (!words.length) return NaN;
  const sentences = Math.max(1, sentenceCount(text));
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59) * 10) / 10;
}

function Highlighted({ text, findings }: { text: string; findings: CheckerFinding[] }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const f of findings) {
    if (f.index < cursor) continue;
    if (f.index > cursor) nodes.push(text.slice(cursor, f.index));
    nodes.push(
      <mark key={`${f.rule}:${f.index}`} className={`rounded px-0.5 text-ink ${SEVERITY_UI[f.severity].mark}`} title={f.message}>
        {text.slice(f.index, f.index + f.match.length)}
      </mark>,
    );
    cursor = f.index + f.match.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <p className="whitespace-pre-wrap text-[0.98rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{nodes}</p>;
}

/**
 * Paragraphs = blocks of six or more words, so a greeting or sign-off on its own is not counted. Blocks are
 * separated by blank lines; text pasted with single line breaks only (Word, Google Docs) counts each line.
 */
export function paragraphCount(text: string): number {
  const blocks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n/) : text.split(/\n/);
  return blocks.filter((p) => countWords(p) >= 6).length;
}

export type LimitVerdict = { limit: CheckerLimit; value: number; state: "empty" | "short" | "ok" | "over"; text: string };

export function limitVerdicts(limits: readonly CheckerLimit[], text: string): LimitVerdict[] {
  const words = countWords(text);
  const chars = text.replace(/\n/g, "").length;
  const paras = paragraphCount(text);
  return limits.map((limit) => {
    const value = limit.measure === "words" ? words : limit.measure === "characters" ? chars : paras;
    const unit = limit.measure === "words" ? "words" : limit.measure === "characters" ? "characters" : "paragraphs";
    const range = limit.min !== undefined ? `${limit.min.toLocaleString("en-US")}–${limit.max.toLocaleString("en-US")} ${unit}` : `up to ${limit.max.toLocaleString("en-US")} ${unit}`;
    if (!text.trim()) return { limit, value, state: "empty", text: `Target: ${range}.` };
    if (value > limit.max) return { limit, value, state: "over", text: `${(value - limit.max).toLocaleString("en-US")} ${unit} over (${range}).` };
    if (limit.min !== undefined && value < limit.min) return { limit, value, state: "short", text: `${(limit.min - value).toLocaleString("en-US")} ${unit} short of the usual minimum (${range}).` };
    return { limit, value, state: "ok", text: `Within ${range}.` };
  });
}

const LIMIT_UI = { empty: "tag", short: "tag tag-accent", ok: "tag tag-ok", over: "tag tag-bad" } as const;
const LIMIT_WORD = { empty: "Target", short: "Short", ok: "Fits", over: "Too long" } as const;

/** 14.6 s under a minute, "3 min 05 s" from a minute up. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}

export function CheckerView({ tool }: { tool: CheckerTool }) {
  const [text, setText] = useState(tool.input.default ?? "");
  const id = useId();
  const events = useToolEvents(tool);
  const findings = useMemo(() => runChecker(tool, text), [tool, text]);
  const hasText = text.trim().length > 0;
  const words = countWords(text);

  const stats = (tool.stats ?? []).map((s) => {
    if (s === "words") return { label: "Words", value: String(words) };
    if (s === "sentences") return { label: "Sentences", value: String(hasText ? sentenceCount(text) : 0) };
    if (s === "readingLevel") {
      const g = readingGrade(text);
      return { label: "Reading level", value: Number.isFinite(g) ? `Grade ${g}` : "—" };
    }
    if (s === "characters") return { label: "Characters", value: text.replace(/\n/g, "").length.toLocaleString("en-US") };
    if (s.startsWith("read@")) {
      const wpm = Number(s.slice("read@".length));
      return { label: `Read at ${wpm} words/min`, value: duration((words / wpm) * 60) };
    }
    const wps = Number(s.slice("seconds@".length));
    return { label: `Spoken at ${wps} words/s`, value: duration(words / wps) };
  });

  const groups = SEVERITY_ORDER.map((sev) => ({ sev, items: findings.filter((f) => f.severity === sev) })).filter((g) => g.items.length);

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {tool.input.label}
      </label>
      <textarea
        id={id}
        className="input !min-h-0"
        rows={tool.input.rows ?? 6}
        maxLength={tool.input.maxLength}
        placeholder={tool.input.placeholder}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim().length >= 20) events.result({ words: countWords(next) });
          else events.used();
        }}
      />
      {stats.length ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.86rem] text-ink-3">
          {stats.map((s) => (
            <div key={s.label} className="flex gap-1.5">
              <dt>{s.label}:</dt>
              <dd className="font-semibold tabular-nums text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {tool.limits?.length ? (
        <ul className="mt-4 grid gap-2" aria-live="polite" aria-label="Length check">
          {limitVerdicts(tool.limits, text).map((v) => (
            <li key={`${v.limit.measure}:${v.limit.label}`} className="pane-inset flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[0.92rem]">
              <span className={LIMIT_UI[v.state]}>{LIMIT_WORD[v.state]}</span>
              <span className="font-semibold text-ink">{v.limit.label}</span>
              <span className="tabular-nums text-ink-2">
                {v.value.toLocaleString("en-US")} {v.limit.measure}
              </span>
              <span className="text-ink-3">{v.text}</span>
              {v.limit.note ? <span className="w-full text-[0.82rem] text-ink-4">{v.limit.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5" aria-live="polite">
        {!hasText ? (
          <p className="text-[0.9rem] text-ink-4">Paste or type the text above; the check runs as you type.</p>
        ) : !findings.length && !tool.ruleSets.length ? null : !findings.length ? (
          <div className="pane-inset relative overflow-hidden px-5 py-4 before:absolute before:inset-y-4 before:left-0 before:w-[3px] before:rounded-r-full before:bg-ok">
            <p className="font-semibold text-ok">0 issues</p>
            <p className="mt-1 text-[0.95rem] text-ink-2">{tool.successText ?? "No issues found."}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {groups.map((g) => (
                <span key={g.sev} className={`tag ${SEVERITY_UI[g.sev].tag}`}>
                  {g.items.length} {SEVERITY_UI[g.sev].title.toLowerCase()}
                </span>
              ))}
            </div>
            <div className="pane-inset mt-3 px-4 py-4 sm:px-5">
              <Highlighted text={text} findings={findings} />
            </div>
            {groups.map((g) => (
              <section key={g.sev} className="mt-4" aria-label={SEVERITY_UI[g.sev].title}>
                <p className={`eyebrow ${SEVERITY_UI[g.sev].tone}`}>
                  {SEVERITY_UI[g.sev].title} · {g.items.length}
                </p>
                <ul className="mt-2 space-y-2">
                  {g.items.map((f) => (
                    <li key={`${f.rule}:${f.index}`} className="pane-inset px-4 py-3 text-[0.92rem] leading-relaxed">
                      <p className="text-ink">
                        <span className="font-semibold">“{f.match}”</span>
                        <span className="text-ink-4"> · {f.label}</span>
                      </p>
                      <p className="mt-0.5 text-ink-3">{f.message}</p>
                      {f.suggestion ? <p className="mt-0.5 text-ink-2">Try: {f.suggestion}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
