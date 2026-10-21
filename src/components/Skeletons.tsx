import type { CSSProperties, ReactNode } from "react";
import { cx } from "./ui";

/*
 * Loading states are skeleton panes in the shape of what is coming, with a calm shimmer —
 * never a blank area, never a spinner wall, never a full-page overlay. Server-safe (no
 * hooks, no i18n), so every loading.tsx can render them instantly. Pass `label` for an
 * accessible name when the skeleton is the whole page.
 */

function Bar({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cx("skeleton block", className)} style={style} />;
}

function Busy({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={className} aria-busy="true" aria-live="polite" role={label ? "status" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/** One pane: an eyebrow, a title and a few lines. */
export function PaneSkeleton({ lines = 3, className, label, tall = false }: { lines?: number; className?: string; label?: string; tall?: boolean }) {
  const widths = ["100%", "92%", "74%", "86%", "60%", "90%"];
  return (
    <Busy label={label} className={cx("pane min-w-0 p-5 sm:p-7", tall && "min-h-[260px]", className)}>
      <Bar className="h-3 w-24 rounded-full" />
      <Bar className="mt-4 h-7 w-3/5 max-w-[320px] rounded-[10px]" />
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Bar key={i} className="h-3.5 rounded-full" style={{ width: widths[i % widths.length] }} />
        ))}
      </div>
    </Busy>
  );
}

/** A row of stat panes. */
export function StatsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <Busy className={cx("grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 [&>*]:min-w-0", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pane px-5 py-5 sm:px-6 sm:py-6">
          <Bar className="h-3 w-20 rounded-full" />
          <Bar className="mt-4 h-9 w-16 rounded-[10px]" />
          <Bar className="mt-3 h-3 w-32 rounded-full" />
        </div>
      ))}
    </Busy>
  );
}

/** A list inside one pane: avatar/icon, two lines, a trailing tag. */
export function ListSkeleton({ rows = 5, className, label }: { rows?: number; className?: string; label?: string }) {
  return (
    <Busy label={label} className={cx("pane min-w-0 divide-y divide-[var(--line)] px-4 sm:px-6", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <Bar className="h-11 w-11 shrink-0 rounded-[14px]" />
          <div className="min-w-0 flex-1">
            <Bar className="h-4 rounded-full" style={{ width: `${[62, 48, 70, 54, 66][i % 5]}%` }} />
            <Bar className="mt-2.5 h-3 rounded-full" style={{ width: `${[38, 44, 30, 50, 36][i % 5]}%` }} />
          </div>
          <Bar className="hidden h-6 w-20 shrink-0 rounded-full sm:block" />
        </div>
      ))}
    </Busy>
  );
}

/** Cards in the responsive pane grid (opportunities, documents). */
export function CardGridSkeleton({ cards = 6, className, label }: { cards?: number; className?: string; label?: string }) {
  return (
    <Busy label={label} className={cx("pane-grid", className)}>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="pane p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Bar className="h-6 w-20 rounded-full" />
            <Bar className="h-6 w-14 rounded-full" />
          </div>
          <Bar className="mt-5 h-5 w-4/5 rounded-full" />
          <Bar className="mt-2.5 h-3.5 w-3/5 rounded-full" />
          <div className="mt-5 space-y-2">
            <Bar className="h-3 w-full rounded-full" />
            <Bar className="h-3 w-11/12 rounded-full" />
          </div>
          <div className="mt-6 flex items-center justify-between">
            <Bar className="h-4 w-24 rounded-full" />
            <Bar className="h-10 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Kanban columns (the applications board): horizontal scroll inside, never the page. */
export function BoardSkeleton({ columns = 4, className, label }: { columns?: number; className?: string; label?: string }) {
  return (
    <Busy label={label} className={cx("scroll-row -mx-4 gap-3 px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible", className)}>
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="pane-inset w-[78vw] max-w-[320px] p-3 sm:w-[300px] lg:w-auto lg:max-w-none">
          <div className="flex items-center justify-between px-1 pb-3 pt-1">
            <Bar className="h-3.5 w-24 rounded-full" />
            <Bar className="h-5 w-7 rounded-full" />
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: [3, 2, 2, 1][c % 4] }).map((_, r) => (
              <div key={r} className="pane rounded-[20px] p-4">
                <Bar className="h-4 w-4/5 rounded-full" />
                <Bar className="mt-2.5 h-3 w-1/2 rounded-full" />
                <div className="mt-4 flex gap-2">
                  <Bar className="h-5 w-16 rounded-full" />
                  <Bar className="h-5 w-12 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** A form pane: label + field pairs, then the action. */
export function FormSkeleton({ fields = 4, className, label }: { fields?: number; className?: string; label?: string }) {
  return (
    <Busy label={label} className={cx("pane min-w-0 p-5 sm:p-7", className)}>
      <Bar className="h-6 w-48 rounded-[10px]" />
      <Bar className="mt-3 h-3.5 w-72 max-w-full rounded-full" />
      <div className="mt-7 space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <Bar className="h-3 w-28 rounded-full" />
            <Bar className="mt-2.5 h-[52px] w-full rounded-[16px]" />
          </div>
        ))}
      </div>
      <Bar className="mt-7 h-12 w-40 rounded-full" />
    </Busy>
  );
}

/** A detail page: title block, a main column of panes and a side column. */
export function DetailSkeleton({ className, label }: { className?: string; label?: string }) {
  return (
    <Busy label={label} className={cx("min-w-0", className)}>
      <Bar className="h-3 w-24 rounded-full" />
      <Bar className="mt-4 h-9 w-4/5 max-w-[560px] rounded-[12px]" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Bar className="h-6 w-24 rounded-full" />
        <Bar className="h-6 w-20 rounded-full" />
        <Bar className="h-6 w-28 rounded-full" />
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="space-y-4">
          <PaneSkeleton lines={5} />
          <PaneSkeleton lines={3} />
        </div>
        <div className="space-y-4">
          <div className="pane p-5 sm:p-6">
            <Bar className="h-3 w-20 rounded-full" />
            <Bar className="mt-4 h-12 w-full rounded-full" />
            <Bar className="mt-3 h-12 w-full rounded-full" />
          </div>
          <PaneSkeleton lines={2} />
        </div>
      </div>
    </Busy>
  );
}

/** A signed-in page: header, stats, then a list — the default for /app routes. */
export function AppPageSkeleton({ label }: { label?: string }) {
  return (
    <Busy label={label} className="min-w-0">
      <div className="pb-6 sm:pb-8">
        <Bar className="h-3 w-24 rounded-full" />
        <Bar className="mt-3 h-9 w-2/3 max-w-[420px] rounded-[12px]" />
        <Bar className="mt-3 h-3.5 w-80 max-w-full rounded-full" />
      </div>
      <StatsSkeleton />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ListSkeleton rows={4} />
        <PaneSkeleton lines={4} tall />
      </div>
    </Busy>
  );
}
