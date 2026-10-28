import { ArrowRight, CalendarClock, Check, ChartNoAxesColumn, CircleCheck, Flag, ListChecks, Plus, Route, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ApplyButton } from "@/components/scout/ApplyButton";
import { ButtonLink, Progress, ScoutDot, Skeleton, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { opportunityTypeLabel } from "@/lib/core/opportunity-types";
import type { OpportunityTypeId } from "@/lib/core/types";
import type { PlanStage } from "@/lib/llm/types";
import { PaneTitle } from "./HomePanes";

/*
 * The dashboard's plan panes (server components; strings arrive translated). Each pane says one
 * thing with a picture and a few words: the roadmap as a timeline, where the person stands as a
 * meter and a short list, what is open as bars, deadlines as a week strip, picks with fit rings.
 * Colour follows meaning: blaze marks what is current or leading, pine is progress, grey is
 * context; text always stays in ink.
 */

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

/* ------------------------------------------------------------------ rings */

/** A meter drawn as a ring: pine on a lighter pine track, the value in the middle. */
export function Ring({ value, size = 44, stroke = 4.5, label, children }: { value: number; size?: number; stroke?: number; label: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden focusable="false">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pine-soft)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pine)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center" aria-hidden>
        {children}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ this week */

export interface WeekStep {
  text: string;
  href?: string;
  cta?: string;
  /** `href` is already a full path (the localized sign-in link). */
  external?: boolean;
}

export function ThisWeekPane({ title, steps }: { title: string; steps: WeekStep[] }) {
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="week-title">
      <PaneTitle id="week-title" icon={<ListChecks size={17} aria-hidden />} title={title} />
      <ol className="mt-5 grid gap-4">
        {steps.map((s, i) => (
          <li key={i} className="flex min-w-0 gap-3">
            <span className={cx("num grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.85rem] font-semibold", i === 0 ? "bg-accent text-accent-ink" : "bg-pine-soft text-pine")}>{i + 1}</span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[0.95rem] leading-snug text-ink-2">{s.text}</p>
              {s.href && s.cta ? (
                <ButtonLink href={s.href} external={s.external} size="sm" variant={i === 0 ? "primary" : "ghost"} className="mt-2.5" iconRight={<ArrowRight size={15} aria-hidden />}>
                  {s.cta}
                </ButtonLink>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ roadmap */

export interface RoadmapMilestone {
  id: string;
  title: string;
  target: number;
  progress: number;
}

/**
 * The plan's stages on a timeline from the day it was made to the horizon. The today marker moves
 * as weeks pass; stages around today are blaze, finished ones pine, later ones grey.
 */
export function RoadmapPane({
  stages,
  horizon,
  startedAt,
  today,
  milestones,
  strings,
  className,
}: {
  stages: PlanStage[];
  horizon: number;
  startedAt: Date;
  today: Date;
  milestones: RoadmapMilestone[];
  strings: { title: string; goal: string | null; tick: (d: Date) => string; span: (from: Date, to: Date) => string };
  className?: string;
}) {
  const now = Math.max(0, Math.min(horizon, (today.getTime() - startedAt.getTime()) / MONTH_MS));
  const pct = (m: number) => `${(Math.max(0, Math.min(horizon, m)) / horizon) * 100}%`;
  const at = (m: number) => new Date(startedAt.getTime() + m * MONTH_MS);
  const step = horizon <= 3 ? 1 : horizon <= 6 ? 2 : 3;
  const ticks = Array.from({ length: Math.floor(horizon / step) + 1 }, (_, i) => i * step);
  return (
    <section className={cx("pane min-w-0 p-5 sm:p-6", className)} aria-labelledby="roadmap-title">
      <PaneTitle id="roadmap-title" icon={<Route size={17} aria-hidden />} title={strings.title} />
      <ol className="mt-5 grid gap-3.5">
        {stages.map((s, i) => {
          const state = s.endMonth <= now ? "done" : s.startMonth <= now ? "now" : "later";
          return (
            <li key={i} className="grid gap-1.5 sm:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] sm:items-center sm:gap-5">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[0.95rem] font-semibold text-ink">
                  {state === "done" ? <Check size={15} className="shrink-0 text-pine" aria-hidden /> : null}
                  <span className="truncate">{s.title}</span>
                </p>
                <p className="line-clamp-2 text-[0.82rem] leading-snug text-ink-3">
                  {s.detail}
                  <span className="sr-only"> ({strings.span(at(s.startMonth), at(s.endMonth))})</span>
                </p>
              </div>
              <div className="relative h-2.5 rounded-full bg-pane-3" aria-hidden>
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: pct(s.startMonth),
                    width: `calc(${pct(s.endMonth)} - ${pct(s.startMonth)})`,
                    background: state === "now" ? "var(--accent)" : state === "done" ? "var(--pine)" : "var(--line-2)",
                  }}
                />
                <span className="absolute -top-1 bottom-[-4px] w-0.5 rounded-full bg-ink" style={{ left: pct(now) }} />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-2.5 grid sm:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] sm:gap-5" aria-hidden>
        <span className="hidden sm:block" />
        <div className="relative h-5 text-[0.75rem] text-ink-4">
          {ticks.map((m) => (
            <span key={m} className={cx("num absolute top-0 whitespace-nowrap", m === 0 ? "" : m === horizon ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(m) }}>
              {strings.tick(at(m))}
            </span>
          ))}
        </div>
      </div>
      {milestones.length ? (
        <div className="mt-5 border-t border-[color:var(--line)] pt-5">
          {strings.goal ? (
            <p className="mb-3.5 flex items-center gap-2 text-[0.86rem] font-semibold text-ink-2">
              <Flag size={14} className="shrink-0 text-accent-text" aria-hidden />
              <span className="min-w-0 truncate">{strings.goal}</span>
            </p>
          ) : null}
          <ul className="grid gap-4 sm:grid-cols-3">
            {milestones.slice(0, 3).map((m) => (
              <li key={m.id} className="min-w-0">
                <Progress value={Math.min(m.progress, m.target)} max={m.target} label={m.title} showValue />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ where you stand */

export function StandPane({
  completeness,
  strengths,
  improveHref,
  improveExternal,
  strings,
}: {
  completeness: number;
  strengths: Array<{ label: string; evidence: string }>;
  improveHref: string;
  improveExternal?: boolean;
  strings: { title: string; profile: string; profileBody: string; improve: string; ringLabel: string };
}) {
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="stand-title">
      <PaneTitle id="stand-title" icon={<Sparkles size={17} aria-hidden />} title={strings.title} />
      <div className="mt-5 flex items-center gap-4">
        <Ring value={completeness} size={64} stroke={7} label={strings.ringLabel}>
          <span className="num text-[0.95rem] font-semibold text-ink">{Math.round(completeness)}%</span>
        </Ring>
        <div className="min-w-0">
          <p className="text-[0.95rem] font-semibold text-ink">{strings.profile}</p>
          <p className="text-[0.84rem] leading-snug text-ink-3">{strings.profileBody}</p>
          {improveExternal ? (
            <a href={improveHref} className="link mt-1 inline-block text-[0.86rem]">
              {strings.improve}
            </a>
          ) : (
            <Link href={improveHref} className="link mt-1 inline-block text-[0.86rem]">
              {strings.improve}
            </Link>
          )}
        </div>
      </div>
      {strengths.length ? (
        <ul className="mt-5 grid gap-3">
          {strengths.map((s, i) => (
            <li key={i} className="flex min-w-0 gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-pine-soft text-pine">
                <Check size={14} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[0.93rem] font-semibold text-ink">{s.label}</p>
                <p className="line-clamp-2 text-[0.82rem] leading-snug text-ink-3">{s.evidence}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ open now */

/** Live counts per direction of the plan as horizontal bars: the lead direction in blaze, the rest grey. */
export function OpenNowPane({ items, strings }: { items: Array<{ id: string; label: string; open: number }>; strings: { title: string; note: string; count: (n: number) => string } }) {
  const max = Math.max(1, ...items.map((i) => i.open));
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="open-title">
      <PaneTitle id="open-title" icon={<ChartNoAxesColumn size={17} aria-hidden />} title={strings.title} />
      <ul className="mt-5 grid gap-4">
        {items.map((it, i) => (
          <li key={it.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-[0.9rem]">
              <span className="min-w-0 truncate text-ink-2">{it.label}</span>
              <span className="num shrink-0 font-semibold text-ink">{strings.count(it.open)}</span>
            </div>
            <div className="mt-1.5 h-2.5" aria-hidden>
              <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(2, (it.open / max) * 100)}%`, background: i === 0 ? "var(--accent)" : "var(--ink-4)" }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[0.78rem] text-ink-4">{strings.note}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ gaps */

export function GapsPane({ items, strings }: { items: Array<{ label: string; href: string; cta: string; external?: boolean }>; strings: { title: string; none: string } }) {
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="gaps-title">
      <PaneTitle id="gaps-title" icon={<Plus size={17} aria-hidden />} title={strings.title} />
      {items.length ? (
        <ul className="mt-5 grid gap-3">
          {items.map((g, i) => {
            const body = (
              <>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text">
                  <Plus size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-[0.93rem] leading-snug text-ink">{g.label}</span>
                <span className="flex shrink-0 items-center gap-1 text-[0.84rem] font-semibold text-accent-text">
                  {g.cta}
                  <ArrowRight size={14} aria-hidden />
                </span>
              </>
            );
            const cls = "pane-inset flex min-w-0 items-center gap-3 px-3.5 py-3 transition-colors hover:bg-pane-3";
            return (
              <li key={i}>
                {g.external ? (
                  <a href={g.href} className={cls}>
                    {body}
                  </a>
                ) : (
                  <Link href={g.href} className={cls}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 flex items-center gap-2.5 text-[0.93rem] text-ink-2">
          <CircleCheck size={18} className="shrink-0 text-ok" aria-hidden />
          {strings.none}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ picks */

export interface CompactPick {
  opportunityId: string;
  goalId: string | null;
  type: OpportunityTypeId;
  channel: string;
  name: string;
  orgName: string | null;
  deadline: string | null;
  rolling: boolean;
  fit: number;
}

export function PicksListPane({
  items,
  refreshing,
  locale,
  className,
  strings,
}: {
  items: CompactPick[] | null;
  refreshing: boolean;
  locale: string;
  className?: string;
  strings: { title: string; all: string; empty: string; emptyBody: string; finding: string; updating: string; error: string; fit: (fit: number) => string; rolling: string; due: (iso: string) => string };
}) {
  return (
    <section className={cx("pane min-w-0 p-5 sm:p-6", className)} aria-labelledby="picks-title" aria-busy={refreshing && !items?.length}>
      <PaneTitle
        id="picks-title"
        icon={<Sparkles size={17} aria-hidden />}
        title={strings.title}
        action={
          refreshing && items?.length ? (
            <span className="flex shrink-0 items-center gap-2 text-[0.84rem] text-ink-3" role="status">
              <ScoutDot live />
              {strings.updating}
            </span>
          ) : (
            <Link href="/app/scout" prefetch={false} className="link shrink-0 text-[0.88rem]">
              {strings.all}
            </Link>
          )
        }
      />
      {items === null ? (
        <p className="mt-5 text-[0.92rem] text-ink-3">{strings.error}</p>
      ) : items.length ? (
        <ul className="mt-3 divide-y divide-[color:var(--line)]">
          {items.map((p) => (
            <li key={p.opportunityId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Ring value={p.fit} label={strings.fit(p.fit)}>
                <span className="num text-[0.78rem] font-semibold text-ink">{p.fit}</span>
              </Ring>
              <div className="min-w-0">
                <Link href={`/app/scout/${p.opportunityId}`} prefetch={false} className="block truncate text-[0.98rem] font-semibold text-ink hover:underline">
                  {p.name}
                </Link>
                <p className="flex min-w-0 items-center gap-1.5 text-[0.82rem] text-ink-3">
                  <span className="truncate">{[p.orgName, opportunityTypeLabel(p.type, locale)].filter(Boolean).join(" · ")}</span>
                  <span className="shrink-0">·</span>
                  <CalendarClock size={13} className="shrink-0" aria-hidden />
                  <span className="shrink-0">{p.deadline ? strings.due(p.deadline) : p.rolling ? strings.rolling : "—"}</span>
                </p>
              </div>
              <div className="col-start-2 sm:col-start-3">
                <ApplyButton opportunityId={p.opportunityId} type={p.type} channel={p.channel} goalId={p.goalId} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      ) : refreshing ? (
        <div className="mt-4 grid gap-4">
          <p className="text-[0.9rem] text-ink-3">{strings.finding}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton circle className="block h-11 w-11" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="block h-4 w-3/5 rounded-full" />
                <Skeleton className="block h-3 w-2/5 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-[0.98rem] font-semibold text-ink">{strings.empty}</p>
          <p className="mt-1 text-[0.88rem] text-ink-3">{strings.emptyBody}</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ deadlines */

/**
 * The next eight weeks as a strip: one column per week, a dot per pick that closes that week
 * (blaze within seven days), and the next two written out — the strip is never the only way to
 * read a date.
 */
export function DeadlinesPane({
  items,
  today,
  strings,
}: {
  items: Array<{ id: string; name: string; deadline: string }>;
  today: Date;
  strings: { title: string; none: string; week: (d: Date) => string; inDays: (n: number) => string; more: (n: number) => string };
}) {
  const DAY = 24 * 3600 * 1000;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const upcoming = items
    .map((i) => ({ ...i, days: Math.ceil((new Date(i.deadline).getTime() - start.getTime()) / DAY) }))
    .filter((i) => i.days >= 0 && i.days < 56)
    .sort((a, b) => a.days - b.days);
  const weeks = Array.from({ length: 8 }, (_, w) => upcoming.filter((i) => Math.floor(i.days / 7) === w));
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="deadlines-title">
      <PaneTitle id="deadlines-title" icon={<CalendarClock size={17} aria-hidden />} title={strings.title} />
      {upcoming.length ? (
        <>
          <div className="mt-5 grid grid-cols-8 gap-1.5" aria-hidden>
            {weeks.map((list, w) => (
              <div key={w} className="flex min-w-0 flex-col items-center gap-2">
                <div className="flex h-[58px] w-full flex-col-reverse items-center gap-1 rounded-[10px] bg-pane-2 py-1.5">
                  {list.slice(0, 3).map((i) => (
                    <span key={i.id} title={i.name} className="block h-2.5 w-2.5 rounded-full ring-2 ring-[color:var(--pane-2)]" style={{ background: i.days < 7 ? "var(--accent)" : "var(--pine)" }} />
                  ))}
                  {list.length > 3 ? <span className="text-[0.65rem] font-semibold leading-none text-ink-3">+{list.length - 3}</span> : null}
                </div>
                <span className="num whitespace-nowrap text-[0.68rem] text-ink-4">{w % 2 === 0 ? strings.week(new Date(start.getTime() + w * 7 * DAY)) : " "}</span>
              </div>
            ))}
          </div>
          <ul className="mt-4 grid gap-2.5">
            {upcoming.slice(0, 2).map((i) => (
              <li key={i.id} className="flex min-w-0 items-center gap-2.5">
                <span className="block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.days < 7 ? "var(--accent)" : "var(--pine)" }} aria-hidden />
                <Link href={`/app/scout/${i.id}`} prefetch={false} className="min-w-0 flex-1 truncate text-[0.9rem] text-ink hover:underline">
                  {i.name}
                </Link>
                <span className="num shrink-0 text-[0.82rem] font-semibold text-ink-2">{strings.inDays(i.days)}</span>
              </li>
            ))}
          </ul>
          {upcoming.length > 2 ? <p className="mt-2.5 text-[0.8rem] text-ink-4">{strings.more(upcoming.length - 2)}</p> : null}
        </>
      ) : (
        <p className="mt-5 text-[0.92rem] leading-relaxed text-ink-3">{strings.none}</p>
      )}
    </section>
  );
}
