"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TeleprompterTool } from "@/content/tools/types";
import { countWords } from "./templating";
import { useToolEvents } from "./shared";

/*
 * A browser teleprompter: the script scrolls past a reading line at the chosen words per
 * minute, so a 150-word script takes exactly a minute. Space starts and pauses, R resets.
 * Mirror flips the text for prompter glass; full screen uses the browser's own API.
 */

const SIZES = { s: "text-[1.35rem] sm:text-[1.7rem]", m: "text-[1.75rem] sm:text-[2.3rem]", l: "text-[2.2rem] sm:text-[3rem]" } as const;
type Size = keyof typeof SIZES;

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TeleprompterView({ tool }: { tool: TeleprompterTool }) {
  const [text, setText] = useState(tool.input.default ?? "");
  const [wpm, setWpm] = useState(tool.wpm.default);
  const [size, setSize] = useState<Size>("m");
  const [mirror, setMirror] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const id = useId();
  const events = useToolEvents(tool);
  const started = useRef(false);

  const words = countWords(text);
  const total = words > 0 ? (words / wpm) * 60 : 0;

  // Advance the clock while running; stop at the end.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setElapsed((e) => {
        const next = e + dt;
        if (next >= total) {
          setRunning(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, total]);

  // Scroll position follows the clock, so changing the speed mid-read keeps the place.
  useEffect(() => {
    const vp = viewport.current;
    const ct = content.current;
    if (!vp || !ct) return;
    const max = Math.max(0, ct.scrollHeight - vp.clientHeight);
    vp.scrollTop = total > 0 ? max * Math.min(1, elapsed / total) : 0;
  }, [elapsed, total, size, text]);

  const toggle = useCallback(() => {
    if (!words) return;
    if (!started.current) {
      started.current = true;
      events.result({ words, wpm });
    }
    setRunning((r) => {
      if (!r && elapsed >= total) setElapsed(0);
      return !r;
    });
  }, [words, wpm, elapsed, total, events]);

  const reset = useCallback(() => {
    setRunning(false);
    setElapsed(0);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    }
  };

  const fullscreen = () => {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id} className="field-label">
          {tool.input.label}
        </label>
        <textarea
          id={id}
          className="input min-h-[7.5rem] w-full resize-y"
          rows={5}
          placeholder={tool.input.placeholder}
          maxLength={tool.input.maxLength}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            events.used();
            reset();
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${id}-wpm`} className="field-label">
            Speed: {wpm} words per minute
          </label>
          <input
            id={`${id}-wpm`}
            type="range"
            min={tool.wpm.min}
            max={tool.wpm.max}
            step={5}
            value={wpm}
            onChange={(e) => {
              const next = Number(e.target.value);
              // Keep the reader's place: scale the elapsed time to the new pace.
              setElapsed((el) => (total > 0 ? (el / total) * ((words / next) * 60) : 0));
              setWpm(next);
            }}
            className="w-full accent-[var(--accent)]"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Text size">
          {(["s", "m", "l"] as Size[]).map((s) => (
            <button key={s} type="button" className="chip" data-selected={size === s ? "" : undefined} aria-pressed={size === s} onClick={() => setSize(s)}>
              {s === "s" ? "Small" : s === "m" ? "Medium" : "Large"}
            </button>
          ))}
          <button type="button" className="chip" data-selected={mirror ? "" : undefined} aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>
            Mirror
          </button>
        </div>
      </div>

      <div ref={frame} className="pane-ink relative overflow-hidden !rounded-[20px]" tabIndex={0} onKeyDown={onKey} aria-label="Teleprompter: space to start or pause, R to reset">
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 h-[3.2em] -translate-y-1/2 border-y border-[#FF7A4D]/40 bg-[#FF7A4D]/[0.06]" aria-hidden="true" />
        <div ref={viewport} className="h-[22rem] overflow-hidden sm:h-[26rem]">
          <div ref={content} className={`px-6 py-[38%] font-semibold leading-[1.45] text-[#F3EEE6] sm:px-10 ${SIZES[size]}`} style={mirror ? { transform: "scaleX(-1)" } : undefined}>
            {text.trim() ? (
              text.split(/\n+/).map((para, i) => (
                <p key={i} className="mb-[0.8em] whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {para}
                </p>
              ))
            ) : (
              <p className="text-[#A89E92]">Paste your script above, then press Start.</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={toggle} disabled={!words}>
          {running ? "Pause" : elapsed > 0 && elapsed < total ? "Resume" : "Start"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Reset
        </button>
        <button type="button" className="btn btn-quiet" onClick={fullscreen}>
          Full screen
        </button>
        <p className="ml-auto text-[0.92rem] tabular-nums text-ink-3">
          {words} words · {clock(elapsed)} / {clock(total)}
        </p>
      </div>
      <p className="text-[0.82rem] text-ink-4">Keyboard: space starts and pauses, R resets. Read at the highlighted line.</p>
    </div>
  );
}
