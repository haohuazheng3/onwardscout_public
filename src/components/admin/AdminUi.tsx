import type { ReactNode } from "react";
import { Callout, Tag, cx, type TagTone } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { LinkPending } from "./AdminClient";

/*
 * Shared, server-safe pieces of the admin area (no hooks): formatting, the page title row,
 * key/value lists, a table that becomes a stack of cards below 640px (nothing scrolls sideways
 * at 390px), status tags and the table-shaped skeleton every admin loading.tsx uses.
 * The admin area is the owner's cockpit: dense and legible rather than airy.
 */

/* ------------------------------------------------------------------ formatting */

/** Fixed UTC, so a timestamp reads the same here, in Vercel logs and in Stripe. */
export function fmtDate(d: Date | string | null | undefined, locale = "en"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const f = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${f.format(date)} UTC`;
}

export function fmtDay(d: Date | string | null | undefined, locale = "en"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** "3 min ago", "in 2 days" — localized. */
export function ago(d: Date | string | null | undefined, locale = "en", now: number = Date.now()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = date.getTime() - now;
  if (Number.isNaN(diff)) return "—";
  const rtf = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", { numeric: "auto", style: "short" });
  const abs = Math.abs(diff);
  const s = Math.round(diff / 1000);
  if (abs < 60_000) return rtf.format(s, "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 48 * 3_600_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 45 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return fmtDay(date, locale);
}

export function fmtMoney(cents: number, currency = "usd", locale = "en"): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function fmtInt(n: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(n);
}

/** Cents with up to 2 decimals (LLM costs are fractions of a cent). */
export function fmtCents(cents: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cents / 100);
}

/** `job_k3v9abcd…` → `k3v9abcd` for dense tables; the full id goes in the title attribute. */
export function shortId(id: string): string {
  return id.replace(/^[a-z]+_/, "").slice(0, 8);
}

/* ------------------------------------------------------------------ tones */

export function statusTone(status: string | null | undefined): TagTone {
  switch (status) {
    case "done":
    case "submitted":
    case "paid":
    case "active":
    case "ok":
    case "confirmed":
    case "pass":
    case "progress":
    case "replied":
      return "ok";
    case "failed":
    case "error":
    case "rejected":
    case "disputed":
    case "past_due":
    case "unpaid":
    case "fail":
    case "softfail":
      return "bad";
    case "needs_you":
    case "needs_info":
    case "ready":
    case "unverified":
    case "new":
    case "queued":
    case "running":
    case "preparing":
    case "submitting":
    case "warn":
      return "accent";
    case "waiting":
    case "draft":
    case "trialing":
      return "pine";
    default:
      return "default";
  }
}

export function StatusTag({ status, label }: { status: string | null | undefined; label?: ReactNode }) {
  return <Tag tone={statusTone(status)}>{label ?? (status ?? "—").replace(/_/g, " ")}</Tag>;
}

/* ------------------------------------------------------------------ scaffolding */

export function AdminTitle({ title, lede, actions, count }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode; count?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="headline flex flex-wrap items-baseline gap-x-3 text-[1.7rem] text-ink sm:text-[2rem]">
          {title}
          {count !== undefined ? <span className="num font-sans text-[1rem] font-medium text-ink-4">{count}</span> : null}
        </h1>
        {lede ? <p className="mt-1 max-w-3xl text-[0.92rem] leading-relaxed text-ink-3">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("pane min-w-0 p-5 sm:p-6", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function KeyValue({ rows }: { rows: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-[var(--line)]">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <dt className="shrink-0 text-[0.86rem] text-ink-3 sm:w-52">{r.label}</dt>
          <dd className="min-w-0 break-words text-[0.92rem] text-ink sm:text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code className="break-all rounded-md bg-pane-2 px-1.5 py-0.5 font-mono text-[0.8rem] text-ink-2" title={title}>
      {children}
    </code>
  );
}

export function Json({ value, max = "max-h-72" }: { value: unknown; max?: string }) {
  return <pre className={cx("overflow-auto whitespace-pre-wrap break-all rounded-xl bg-pane-2 p-3 text-[0.75rem] text-ink-3", max)}>{JSON.stringify(value, null, 2)}</pre>;
}

export function Notice({ tone, children }: { tone: "ok" | "bad" | "info"; children: ReactNode }) {
  return (
    <Callout tone={tone === "info" ? "info" : tone} className="text-[0.92rem]">
      <span role="status">{children}</span>
    </Callout>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="pane-inset px-5 py-8 text-center text-[0.95rem] text-ink-3">{children}</div>;
}

/* ------------------------------------------------------------------ responsive table */

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** The card title on phones (no label). */
  primary?: boolean;
  /** Row actions: the bottom of the card on phones. */
  actions?: boolean;
}

/** A real <table> from 640px, a stack of labelled cards below. */
export function AdminTable<T>({ columns, rows, keyOf, empty }: { columns: Column<T>[]; rows: T[]; keyOf: (row: T) => string; empty: ReactNode }) {
  if (rows.length === 0) return <EmptyRow>{empty}</EmptyRow>;
  return (
    <div className="pane overflow-hidden">
      <table className="block w-full text-left text-[0.9rem] sm:table">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-line text-[0.76rem] uppercase tracking-[0.08em] text-ink-4">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-3 font-semibold", c.className)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-[var(--line)] sm:table-row-group">
          {rows.map((row) => (
            <tr key={keyOf(row)} className="block px-4 py-4 sm:table-row sm:p-0">
              {columns.map((c) => (
                <td key={c.key} className={cx("block min-w-0 sm:table-cell sm:px-4 sm:py-3 sm:align-top", c.primary ? "mb-1" : c.actions ? "mt-3" : "py-0.5", c.className)}>
                  {c.primary || c.actions ? (
                    c.render(row)
                  ) : (
                    <div className="flex items-baseline justify-between gap-4 sm:block">
                      <span className="shrink-0 text-[0.78rem] text-ink-4 sm:hidden">{c.label}</span>
                      <span className="min-w-0 break-words text-right sm:text-left">{c.render(row)}</span>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ links */

export function UserLink({ id, email }: { id: string | null | undefined; email?: string | null }) {
  if (!id) return <span className="text-ink-4">—</span>;
  return (
    <Link href={`/admin/users/${encodeURIComponent(id)}`} prefetch={false} className="break-all text-accent-text underline-offset-2 hover:underline" title={id}>
      {email ?? shortId(id)}
    </Link>
  );
}

/* ------------------------------------------------------------------ filters */

/** A row of filter pills (links); the active one is marked. */
export function FilterPills({ items, label }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="scroll-row -mx-4 gap-1.5 px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          prefetch={false}
          aria-current={i.active ? "page" : undefined}
          className={cx(
            "press inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.86rem] font-semibold transition-colors",
            i.active ? "bg-ink text-void" : "bg-pane-2 text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink",
          )}
        >
          {i.label}
          {typeof i.count === "number" ? <span className={cx("num text-[0.8em]", i.active ? "opacity-70" : "text-ink-4")}>{i.count}</span> : null}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ skeleton */

/** Table-shaped skeleton for admin loading.tsx files. */
export function TableSkeleton({ rows = 6, filters = false, label }: { rows?: number; filters?: boolean; label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" role={label ? "status" : undefined} aria-label={label}>
      <span className="skeleton block h-9 w-48 rounded-[12px]" />
      <span className="skeleton mt-3 block h-4 w-80 max-w-full rounded-full" />
      {filters ? (
        <div className="mt-5 flex gap-2">
          <span className="skeleton block h-9 w-28 rounded-full" />
          <span className="skeleton block h-9 w-24 rounded-full" />
          <span className="skeleton block h-9 w-20 rounded-full" />
        </div>
      ) : null}
      <div className="pane mt-5 divide-y divide-[var(--line)]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <span className="skeleton block h-4 w-20 shrink-0 rounded-full" />
            <span className="skeleton block h-4 flex-1 rounded-full" />
            <span className="skeleton hidden h-4 w-24 rounded-full sm:block" />
            <span className="skeleton hidden h-4 w-16 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Previous / next links under an admin list (`?page=`); nothing when the list fits one page. */
export function AdminPager({ page, hasNext, href, labels }: { page: number; hasNext: boolean; href: (page: number) => string; labels: { prev: string; next: string; page: string } }) {
  if (page <= 1 && !hasNext) return null;
  const link = "press inline-flex min-h-[40px] items-center rounded-full bg-pane-2 px-4 text-[0.88rem] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:text-ink";
  return (
    <nav aria-label={labels.page} className="flex items-center justify-between gap-3 pt-2">
      {page > 1 ? (
        <Link href={href(page - 1)} prefetch={false} className={link}>
          ← {labels.prev}
        </Link>
      ) : (
        <span />
      )}
      <span className="num text-[0.85rem] text-ink-3">{labels.page}</span>
      {hasNext ? (
        <Link href={href(page + 1)} prefetch={false} className={link}>
          {labels.next} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
