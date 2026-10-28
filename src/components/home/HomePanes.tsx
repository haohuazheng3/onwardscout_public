import { ArrowRight, Bell, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ScoutDot, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { boardColumnLabel, statusLabel, type BoardColumn } from "@/lib/core/state-machine";
import type { ApplicationStatus } from "@/lib/core/types";

/*
 * The weekly cockpit's panes (server components; strings come in already translated, so
 * they render without client JavaScript except the Apply buttons).
 */

export function PaneTitle({ id, icon, title, action }: { id: string; icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">{icon}</span>
      <h2 id={id} className="title min-w-0 flex-1 truncate text-[1.15rem] text-ink">
        {title}
      </h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ needs you */

export interface NeedsYouItem {
  id: string;
  status: ApplicationStatus;
  reason: string | null;
  name: string | null;
  orgName: string | null;
  practice: boolean;
}

export function NeedsYouPane({ items, locale, strings }: { items: NeedsYouItem[] | null; locale: string; strings: { title: string; empty: string; error: string; practice: string; open: string } }) {
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="needs-title">
      <PaneTitle id="needs-title" icon={<CircleAlert size={17} aria-hidden />} title={strings.title} action={items?.length ? <Tag tone="accent">{items.length}</Tag> : null} />
      {items === null ? (
        <p className="mt-4 text-[0.92rem] text-ink-3">{strings.error}</p>
      ) : items.length ? (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={`/app/applications/${a.id}`} prefetch={false} className="press group flex min-w-0 items-center gap-3 py-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.96rem] font-medium text-ink">
                    {a.name ?? strings.open}
                    {a.orgName ? <span className="font-normal text-ink-3"> · {a.orgName}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.84rem] text-ink-3">
                    {statusLabel(a.status, locale)}
                    {a.reason ? ` · ${a.reason}` : ""}
                    {a.practice ? ` · ${strings.practice}` : ""}
                  </span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[0.92rem] text-ink-3">{strings.empty}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ pipeline */

export function PipelinePane({ counts, locale, strings }: { counts: Partial<Record<BoardColumn, number>> | null; locale: string; strings: { title: string; error: string; board: string } }) {
  const columns: BoardColumn[] = ["todo", "preparing", "needs_you", "ready", "submitted", "waiting", "progress", "closed"];
  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="pipeline-title">
      <PaneTitle
        id="pipeline-title"
        icon={<ScoutDot />}
        title={strings.title}
        action={
          <Link href="/app/applications" prefetch={false} className="link text-[0.86rem]">
            {strings.board}
          </Link>
        }
      />
      {counts === null ? (
        <p className="mt-4 text-[0.92rem] text-ink-3">{strings.error}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          {columns.map((c) => {
            const n = counts[c] ?? 0;
            return (
              <li key={c} className={cx("pane-inset min-w-0 px-3 py-2.5", c === "needs_you" && n > 0 && "bg-accent-soft")}>
                <p className={cx("num text-[1.4rem] font-semibold leading-none", n ? "text-ink" : "text-ink-4", c === "needs_you" && n > 0 && "text-accent-text")}>{n}</p>
                <p className="mt-1 truncate text-[0.8rem] text-ink-3">{boardColumnLabel(c, locale)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ notifications & activity */

export interface FeedItem {
  id: string;
  title: string;
  body?: string | null;
  href?: string | null;
  when: string;
  unread?: boolean;
}

export function FeedPane({ id, icon, title, items, empty, error }: { id: string; icon: ReactNode; title: string; items: FeedItem[] | null; empty: string; error: string }) {
  return (
    <section id={id} className="pane min-w-0 scroll-mt-28 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <PaneTitle id={`${id}-title`} icon={icon} title={title} />
      {items === null ? (
        <p className="mt-4 text-[0.92rem] text-ink-3">{error}</p>
      ) : items.length ? (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {items.map((n) => {
            const inner = (
              <>
                <span className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", n.unread ? "bg-accent" : "bg-line-2")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.93rem] font-medium leading-snug text-ink">{n.title}</span>
                  {n.body ? <span className="mt-0.5 line-clamp-2 block text-[0.84rem] text-ink-3">{n.body}</span> : null}
                  <span className="mt-0.5 block text-[0.78rem] text-ink-4">{n.when}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.href && n.href.startsWith("/") ? (
                  <Link href={n.href} prefetch={false} className="press flex min-w-0 items-start gap-3 py-3">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-start gap-3 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[0.92rem] text-ink-3">{empty}</p>
      )}
    </section>
  );
}

export const BellIcon = <Bell size={17} aria-hidden />;
