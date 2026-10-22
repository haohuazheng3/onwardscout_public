"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { track } from "@/components/Consent";
import type { InputDef, NumericInputDef, Tool, When } from "@/content/tools/types";
import { toolCta } from "@/content/tools/types";
import { dayToIso, formatDayLong, isoToDay, todayDays, type Scope } from "./formulas";
import type { TemplateValues } from "./templating";

/*
 * Pieces every tool kind shares: hydration gate, analytics, clipboard, the input renderer
 * and the value conversions (what a template prints vs. what a formula reads).
 */

export type InputValue = string | number | boolean | string[] | null;
export type Values = Record<string, InputValue>;


/** false on the server and during hydration, true once React owns the DOM. */
export { useHydrated } from "@/components/use-hydrated";

/** FlowGlance events: `used` fires once per mount, `result` and `cta` whenever called. */
export function useToolEvents(tool: Pick<Tool, "id" | "kind">) {
  const used = useRef(false);
  const markUsed = useCallback(() => {
    if (used.current) return;
    used.current = true;
    track("tool_used", { tool: tool.id, kind: tool.kind });
  }, [tool.id, tool.kind]);
  const result = useCallback(
    (props?: Record<string, unknown>) => {
      markUsed();
      track("tool_result", { tool: tool.id, kind: tool.kind, ...(props ?? {}) });
    },
    [markUsed, tool.id, tool.kind],
  );
  const cta = useCallback((href: string) => track("tool_cta", { tool: tool.id, kind: tool.kind, href }), [tool.id, tool.kind]);
  return { used: markUsed, result, cta };
}

/** navigator.clipboard first, a hidden textarea + execCommand when the page is not a secure context. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn("[tool] clipboard API failed, falling back", e);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("data-os-private", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.warn("[tool] copy fallback failed", e);
    return false;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className = "btn btn-quiet btn-sm shrink-0",
  onCopied,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "done" : "failed");
        if (ok) onCopied?.();
        setTimeout(() => setState("idle"), 1600);
      }}
    >
      {state === "done" ? copiedLabel : state === "failed" ? "Select and copy" : label}
    </button>
  );
}

/* ---------- values ---------- */

export function initialValues(inputs: readonly InputDef[]): Values {
  const out: Values = {};
  for (const inp of inputs) {
    switch (inp.type) {
      case "text":
      case "textarea":
        out[inp.id] = inp.default ?? "";
        break;
      case "select":
        out[inp.id] = inp.default ?? inp.options[0].value;
        break;
      case "multiselect":
        out[inp.id] = inp.default ?? [];
        break;
      case "number":
        out[inp.id] = inp.default ?? null;
        break;
      case "toggle":
        out[inp.id] = inp.default ?? false;
        break;
      case "date":
        out[inp.id] = todayDays() + (inp.defaultOffsetDays ?? 0);
        break;
    }
  }
  return out;
}

/** What templates print: option labels for selects, "yes"/"no" for toggles. */
export function templateValues(inputs: readonly InputDef[], values: Values): TemplateValues {
  const out: TemplateValues = {};
  for (const inp of inputs) {
    const v = values[inp.id];
    if (inp.type === "select") out[inp.id] = inp.options.find((o) => o.value === v)?.label ?? "";
    else if (inp.type === "multiselect") {
      const picked = Array.isArray(v) ? v : [];
      out[inp.id] = inp.options.filter((o) => picked.includes(o.value)).map((o) => o.label);
    } else if (inp.type === "number") out[inp.id] = typeof v === "number" ? v : null;
    else if (inp.type === "toggle") out[inp.id] = Boolean(v);
    else if (inp.type === "date") out[inp.id] = typeof v === "number" && Number.isFinite(v) ? formatDayLong(v) : "";
    else out[inp.id] = typeof v === "string" ? v : "";
  }
  return out;
}

/** What formulas read: numbers as typed (NaN when empty), Number(option value), 1/0 for toggles, days since 1970-01-01 for dates. */
export function formulaScope(inputs: readonly NumericInputDef[], values: Values): Scope {
  const out: Scope = {};
  for (const inp of inputs) {
    const v = values[inp.id];
    if (inp.type === "number") out[inp.id] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
    else if (inp.type === "select") out[inp.id] = Number(v);
    else if (inp.type === "date") out[inp.id] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
    else out[inp.id] = v ? 1 : 0;
  }
  return out;
}

/** The text a `when` condition compares against. */
function conditionValue(v: InputValue): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "boolean") return [v ? "true" : "false"];
  if (v === null || v === undefined) return [""];
  return [String(v).trim()];
}

export function whenMatches(when: When | When[] | undefined, values: Values): boolean {
  if (!when) return true;
  if (Array.isArray(when)) return when.every((w) => whenMatches(w, values));
  const have = conditionValue(values[when.input]);
  const list = (x: string | string[] | undefined) => (x === undefined ? null : Array.isArray(x) ? x : [x]);
  const is = list(when.is);
  const not = list(when.not);
  if (is && !have.some((h) => is.includes(h))) return false;
  if (not && have.some((h) => not.includes(h))) return false;
  return true;
}

/** Inputs marked `required` (text/textarea) that are still empty. */
export function missingRequired(inputs: readonly InputDef[], values: Values): InputDef[] {
  return inputs.filter((inp) => (inp.type === "text" || inp.type === "textarea") && inp.required && !String(values[inp.id] ?? "").trim());
}

/* ---------- input renderer ---------- */

export function InputField({ input, value, onChange }: { input: InputDef; value: InputValue; onChange: (v: InputValue) => void }) {
  const uid = useId();
  const id = `${uid}-${input.id}`;
  const label = (
    <label htmlFor={id} className="field-label">
      {input.label}
      {(input.type === "text" || input.type === "textarea") && input.required ? <span className="ml-1 text-accent-text">*</span> : null}
    </label>
  );
  const help = input.help ? <span className="field-hint">{input.help}</span> : null;

  switch (input.type) {
    case "text":
      return (
        <div className="min-w-0">
          {label}
          <input id={id} className="input" type="text" value={String(value ?? "")} placeholder={input.placeholder} maxLength={input.maxLength} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    case "textarea":
      return (
        <div className="min-w-0 sm:col-span-2">
          {label}
          <textarea id={id} className="input !min-h-0" rows={input.rows ?? 4} value={String(value ?? "")} placeholder={input.placeholder} maxLength={input.maxLength} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    case "number":
      return (
        <div className="min-w-0">
          {label}
          <span className="flex items-center gap-2">
            <input
              id={id}
              className="input"
              type="number"
              inputMode="decimal"
              min={input.min}
              max={input.max}
              step={input.step ?? "any"}
              placeholder={input.placeholder}
              value={typeof value === "number" && Number.isFinite(value) ? value : ""}
              onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            />
            {input.unit ? <span className="shrink-0 text-[0.9rem] text-ink-4">{input.unit}</span> : null}
          </span>
          {help}
        </div>
      );
    case "select": {
      const chips = input.display === "chips" || (input.display !== "dropdown" && input.options.length <= 5);
      if (!chips) {
        return (
          <div className="min-w-0">
            {label}
            <select id={id} className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
              {input.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {help}
          </div>
        );
      }
      return (
        <fieldset className="min-w-0">
          <legend className="field-label">{input.label}</legend>
          <div className="flex flex-wrap gap-2">
            {input.options.map((o) => (
              <button key={o.value} type="button" className="chip" data-selected={value === o.value ? "true" : undefined} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case "multiselect": {
      const picked = Array.isArray(value) ? value : [];
      const full = input.max !== undefined && picked.length >= input.max;
      return (
        <fieldset className="min-w-0 sm:col-span-2">
          <legend className="field-label">
            {input.label}
            {input.max ? <span className="ml-1 font-normal text-ink-4">(up to {input.max})</span> : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {input.options.map((o) => {
              const on = picked.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className="chip"
                  data-selected={on ? "true" : undefined}
                  aria-pressed={on}
                  aria-disabled={!on && full ? "true" : undefined}
                  onClick={() => {
                    if (on) onChange(picked.filter((v) => v !== o.value));
                    else if (!full) onChange([...picked, o.value]);
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {help}
        </fieldset>
      );
    }
    case "date":
      return (
        <div className="min-w-0">
          {label}
          <input
            id={id}
            className="input"
            type="date"
            value={typeof value === "number" ? dayToIso(value) : ""}
            onChange={(e) => onChange(e.target.value ? isoToDay(e.target.value) : null)}
          />
          {help}
        </div>
      );
    case "toggle": {
      const on = Boolean(value);
      return (
        <div className="min-w-0">
          <span className="field-label">{input.label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            className="chip min-h-[50px] gap-3"
            data-selected={on ? "true" : undefined}
            onClick={() => onChange(!on)}
          >
            <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-pane-3"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
            </span>
            <span>{on ? (input.onLabel ?? "Yes") : (input.offLabel ?? "No")}</span>
          </button>
          {help}
        </div>
      );
    }
  }
}

/** Grid of inputs; textareas and multiselects span both columns on wide screens. */
export function InputGrid({ inputs, values, onChange }: { inputs: readonly InputDef[]; values: Values; onChange: (id: string, v: InputValue) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {inputs.map((inp) => (
        <InputField key={inp.id} input={inp} value={values[inp.id] ?? null} onChange={(v) => onChange(inp.id, v)} />
      ))}
    </div>
  );
}

/* ---------- result pieces ---------- */

export type Tone = "accent" | "ok" | "bad" | "pine" | "quiet";

const TONE_BAR: Record<Tone, string> = {
  accent: "before:bg-accent",
  ok: "before:bg-ok",
  bad: "before:bg-bad",
  pine: "before:bg-pine",
  quiet: "before:bg-ink-4",
};

/** Nested pane with a coloured hairline on the left, announced to screen readers when it appears. */
export function ResultPane({ eyebrow, title, tone = "accent", children, className = "" }: { eyebrow?: string; title?: ReactNode; tone?: Tone; children?: ReactNode; className?: string }) {
  return (
    <div aria-live="polite" className={`pane-inset relative overflow-hidden px-5 py-5 sm:px-6 before:absolute before:inset-y-4 before:left-0 before:w-[3px] before:rounded-r-full ${TONE_BAR[tone]} ${className}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      {title ? <h3 className={`headline text-[1.35rem] leading-snug text-ink sm:text-[1.5rem] ${eyebrow ? "mt-2" : ""}`}>{title}</h3> : null}
      {children}
    </div>
  );
}

/** The Onward Scout call to action inside a tool (result panes); tracks `tool_cta`. */
export function ToolCtaButton({ tool, href, label, className = "btn btn-primary btn-sm", onClick }: { tool: Tool; href?: string; label?: string; className?: string; onClick?: (href: string) => void }) {
  const cta = toolCta(tool);
  const to = href ?? cta.href;
  return (
    <Link href={to} prefetch={false} className={className} onClick={() => onClick?.(to)}>
      {label ?? cta.label}
    </Link>
  );
}

export function Progress({ at, of, label = "Question" }: { at: number; of: number; label?: string }) {
  const pct = of ? Math.round((at / of) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[0.8rem] text-ink-4">
        <span>
          {label} {Math.min(at + 1, of)} of {of}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-pane-3" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={at}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Vertical list of answer buttons (quiz, decision). */
export function OptionList({ options, onPick, selected }: { options: string[]; onPick: (i: number) => void; selected?: number }) {
  return (
    <div className="grid gap-2">
      {options.map((label, i) => (
        <button
          key={`${i}:${label}`}
          type="button"
          data-selected={selected === i ? "true" : undefined}
          aria-pressed={selected === i}
          className="chip w-full justify-start !rounded-2xl !px-4 !py-3 text-left text-[0.98rem] leading-snug"
          onClick={() => onPick(i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
