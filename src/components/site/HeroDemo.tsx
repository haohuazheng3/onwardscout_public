"use client";

import { ArrowRight, Check, Clock3, FileText, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { cx, Tag } from "@/components/ui";
import "./hero-demo.css";

/*
 * The home-page example: a résumé drops in, profile facts appear, three picks slide in with fit
 * scores, one is prepared and submitted after a tap, another becomes a handoff with every field ready.
 * Labelled "Example" with illustrative data; screen readers get one sentence instead of the
 * animation. It plays only while on screen, can be paused, and shows the finished state at
 * once when the visitor prefers reduced motion. Copy arrives as props (public pages give
 * client components the `common` namespace only).
 */

export interface HeroDemoCard {
  type: string;
  title: string;
  meta: string;
  fit: string;
}

export interface HeroDemoCopy {
  example: string;
  exampleNote: string;
  summary: string;
  dropTitle: string;
  dropHint: string;
  fileName: string;
  fileMeta: string;
  reading: string;
  found: string;
  profileTitle: string;
  profileNote: string;
  chips: string[];
  picksTitle: string;
  cards: [HeroDemoCard, HeroDemoCard, HeroDemoCard];
  prepared: string;
  submit: string;
  yourTap: string;
  submitted: string;
  evidence: string;
  handoff: string;
  handoffWhy: string;
  drafting: string;
  pause: string;
  play: string;
}

/** How long each phase holds, in ms. 0 idle · 1 file · 2 reading · 3 profile · 4 picks · 5 prepared · 6 submitted + handoff. */
export const DEMO_PHASES = [700, 900, 1300, 1500, 1500, 1900, 4600] as const;
export const DEMO_FINAL = DEMO_PHASES.length - 1;

/** The phase after `p` (the example loops). */
export function nextPhase(p: number): number {
  return p >= DEMO_FINAL ? 0 : p + 1;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => false;

type Vars = CSSProperties & Record<`--${string}`, string>;

/** Layers stacked in one grid cell; only `active` is shown. `layers[i]` adds a class to layer i (its entrance). */
function Swap({
  active,
  children,
  className,
  layerClassName,
  layers,
  delay = 0,
}: {
  active: number;
  children: ReactNode[];
  className?: string;
  layerClassName?: string;
  layers?: (string | undefined)[];
  delay?: number;
}) {
  return (
    <div className={cx("hd-swap", className)}>
      {children.filter((child) => child !== null && child !== undefined).map((child, i) => (
        <div key={i} className={cx("hd-layer", layerClassName, layers?.[i])} data-active={i === active} style={{ "--d": `${delay}ms` } as Vars}>
          {child}
        </div>
      ))}
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block rounded-full", className)} />;
}

function Ok({ children }: { children: ReactNode }) {
  return (
    <span className="tag tag-ok gap-1 whitespace-nowrap">
      <Check size={12} strokeWidth={3} aria-hidden />
      {children}
    </span>
  );
}

export function HeroDemo({ copy, className }: { copy: HeroDemoCopy; className?: string }) {
  const reduced = useSyncExternalStore(subscribeMotion, reducedNow, reducedOnServer);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);

  // Play only while at least a quarter of the example is on screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !playing || !visible) return;
    const t = window.setTimeout(() => setPhase(nextPhase), DEMO_PHASES[phase]);
    return () => window.clearTimeout(t);
  }, [phase, playing, visible, reduced]);

  const p = reduced ? DEMO_FINAL : phase;
  const [c1, c2, c3] = copy.cards;

  return (
    <figure ref={root} className={cx("hd-stage relative m-0 min-w-0", className)}>
      <figcaption className="sr-only">{copy.summary}</figcaption>

      <div className="mb-3 flex min-h-[40px] items-center justify-between gap-3 pl-1">
        <span className="flex min-w-0 items-center gap-2">
          <Tag tone="accent">{copy.example}</Tag>
          <span className="truncate text-[0.8rem] text-ink-4">{copy.exampleNote}</span>
        </span>
        {reduced ? null : (
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="btn btn-quiet btn-icon btn-sm shrink-0"
            aria-label={playing ? copy.pause : copy.play}
            aria-pressed={!playing}
          >
            {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
        )}
      </div>

      {/* Phones: one column. Tablets: drop + profile side by side, picks below. Wide: the flow reads left to right. */}
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)_minmax(0,1.32fr)] lg:items-start lg:gap-4">
          {/* You drop in */}
          <div className="pane hd-float min-w-0 p-4 sm:p-5" style={{ "--float-delay": "0s" } as Vars}>
            <p className="eyebrow eyebrow-dot">{copy.dropTitle}</p>
            <div className="mt-3 rounded-[18px] border-[1.5px] border-dashed border-line-2 p-2">
              <Swap active={p >= 1 ? 1 : 0} layers={[undefined, "hd-drop"]}>
                <div className="flex min-h-[56px] items-center justify-center px-3 text-center text-[0.82rem] leading-snug text-ink-4">{copy.dropHint}</div>
                <div className="flex min-h-[56px] items-center gap-3 rounded-[14px] bg-pane-2 p-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-text">
                    <FileText size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] font-semibold text-ink">{copy.fileName}</span>
                    <span className="block text-[0.76rem] text-ink-4">PDF · {copy.fileMeta}</span>
                  </span>
                </div>
              </Swap>
            </div>
            <div className="mt-3">
              <Swap active={p >= 3 ? 2 : p >= 2 ? 1 : 0}>
                <div className="pt-1">
                  <Bar className="h-2.5 w-2/3" />
                  <Bar className="mt-2 h-1.5 w-full" />
                </div>
                <div>
                  <p className="text-[0.8rem] text-ink-3">{copy.reading}…</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-pane-3">
                    <div className="hd-bar" data-on={p >= 2} />
                  </div>
                </div>
                <p className="flex min-h-[34px] items-center gap-2 text-[0.84rem] font-medium leading-snug text-ink-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-pine-soft text-pine">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  {copy.found}
                </p>
              </Swap>
            </div>
          </div>

          {/* Your profile */}
          <div className="pane hd-float min-w-0 p-4 sm:p-5 lg:mt-10" style={{ "--float-delay": "-3s" } as Vars}>
            <p className="eyebrow eyebrow-dot">{copy.profileTitle}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {copy.chips.map((chip, i) => (
                <span
                  key={chip}
                  className={cx("hd-chip", i >= 4 && "hidden sm:inline-flex")}
                  data-on={p >= 3}
                  style={{ "--d": `${120 + i * 90}ms` } as Vars}
                >
                  <span className="hd-chip-dot" />
                  {chip}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[0.76rem] text-ink-4">
              <span className="h-1.5 w-1.5 rounded-full bg-pine" />
              {copy.profileNote}
            </p>
          </div>

        {/* This week's picks */}
        <div className="pane hd-float min-w-0 p-3 sm:col-span-2 sm:p-4 lg:col-span-1 lg:mt-3" style={{ "--float-delay": "-6s" } as Vars}>
          <p className="eyebrow eyebrow-dot px-1 pt-1">{copy.picksTitle}</p>
          <ul className="mt-3 grid gap-2">
            {[c1, c2, c3].map((card, i) => {
              // The last line of a card: skeleton → what it is → what happened to it.
              const line = p < 4 ? 0 : i === 0 ? (p >= 6 ? 3 : p >= 5 ? 2 : 1) : i === 1 ? (p >= 6 ? 2 : 1) : p >= 5 ? 2 : 1;
              return (
                <li key={card.title} className={cx("pane-inset min-w-0 p-3", i === 2 && "hidden sm:block")}>
                  <Swap active={p >= 4 ? 1 : 0} layerClassName="hd-slide" delay={i * 150}>
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <Bar className="h-[22px] w-16" />
                        <Bar className="h-[22px] w-14" />
                      </div>
                      <Bar className="mt-2.5 h-3.5 w-3/5" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="tag">{card.type}</span>
                        <span className="tag tag-pine num">{card.fit}</span>
                      </div>
                      <p className="mt-2 truncate text-[0.93rem] font-semibold leading-snug text-ink">{card.title}</p>
                    </div>
                  </Swap>
                  <Swap active={line} delay={line === 1 ? i * 150 : 0} className="mt-1.5">
                    <Bar className="mt-1 h-3 w-2/5" />
                    <p className="truncate text-[0.78rem] leading-snug text-ink-3">{card.meta}</p>
                    {i === 0 ? (
                      <span className="flex items-center gap-2 pt-0.5">
                        <Ok>{copy.prepared}</Ok>
                        <span className="hd-tap-button">{copy.submit}</span>
                        <span className="truncate text-[0.74rem] text-ink-4">{copy.yourTap}</span>
                      </span>
                    ) : i === 1 ? (
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                        <span className="tag tag-warn w-fit gap-1 whitespace-nowrap">
                          <Clock3 size={12} strokeWidth={2.6} />
                          {copy.handoff}
                        </span>
                        <span className="min-w-0 text-[0.74rem] leading-snug text-ink-3">{copy.handoffWhy}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 pt-1 text-[0.76rem] text-ink-3">
                        <span className="scout-dot scout-dot-live" />
                        <span className="truncate">{copy.drafting}…</span>
                      </span>
                    )}
                    {i === 0 ? (
                      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pt-0.5">
                        <Ok>{copy.prepared}</Ok>
                        <ArrowRight size={13} className="shrink-0 text-ink-4" />
                        <Ok>{copy.submitted}</Ok>
                        <span className="text-[0.74rem] text-ink-4">{copy.evidence}</span>
                      </span>
                    ) : null}
                  </Swap>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </figure>
  );
}
