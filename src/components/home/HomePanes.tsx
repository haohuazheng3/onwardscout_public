import { ArrowRight, Bell, CalendarClock, CircleAlert, Target } from "lucide-react";
import type { ReactNode } from "react";
import { ApplyButton } from "@/components/scout/ApplyButton";
import { ButtonLink, EmptyState, Progress, ScoutDot, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { boardColumnLabel, statusLabel, type BoardColumn } from "@/lib/core/state-machine";
import { opportunityTypeLabel } from "@/lib/core/opportunity-types";
import type { ApplicationStatus, OpportunityTypeId } from "@/lib/core/types";

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

/* ------------------------------------------------------------------ hero */

export interface HeroGoal {
  id: string;
  label: string;
  successDefinition: string | null;
  milestones: { id: string; title: string; target: number; progress: number }[];
}

export function HeroPane({ goal, others, strings }: { goal: HeroGoal | null; others: number; strings: { eyebrow: string; empty: string; emptyBody: string; set: string; all: string; more: string } }) {
  if (!goal) {
    return (
      <section className="pane-ink min-w-0 p-6 sm:p-8" aria-labelledby="hero-title">
        <p className="eyebrow text-[color:var(--ink-3)]">{strings.eyebrow}</p>
        <h2 id="hero-title" className="headline mt-3 text-[1.6rem] sm:text-[2rem]">
          {strings.empty}
        </h2>
        <p className="mt-2 max-w-lg text-[0.98rem] leading-relaxed opacity-80">{strings.emptyBody}</p>
        <ButtonLink href="/app/start?step=3" className="mt-5" variant="primary" iconRight={<ArrowRight size={17} aria-hidden />}>
          {strings.set}
        </ButtonLink>
      </section>
    );
  }
  return (
    <section className="pane-ink min-w-0 p-6 sm:p-8" aria-labelledby="hero-title">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow flex min-w-0 items-center gap-2 opacity-80">
          <Target size={14} className="shrink-0" aria-hidden />
          <span className="truncate">
            {strings.eyebrow} · {goal.label}
          </span>
        </p>
        <Link href="/app/goals" className="link shrink-0 text-[0.86rem] opacity-80">
          {strings.all}
        </Link>
      </div>
      <h2 id="hero-title" className="headline mt-3 text-[1.55rem] leading-tight sm:text-[2rem]">
        {goal.successDefinition ?? goal.label}
      </h2>
      {goal.milestones.length ? (
        <ul className="mt-6 grid gap-4">
          {goal.milestones.slice(0, 3).map((m) => (
            <li key={m.id}>
              <Progress value={Math.min(m.progress, m.target)} max={m.target} label={m.title} showValue />
            </li>
          ))}
        </ul>
      ) : null}
      {others > 0 ? <p className="mt-5 text-[0.86rem] opacity-70">{strings.more}</p> : null}
    </section>
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

/* ------------------------------------------------------------------ picks */

export interface PickItem {
  opportunityId: string;
  goalId: string | null;
  type: OpportunityTypeId;
  channel: string;
  name: string;
  orgName: string | null;
  deadline: string | null;
  rolling: boolean;
  fit: number;
  reason: string | null;
  isNew: boolean;
}

export function PicksPane({ items, locale, strings }: { items: PickItem[] | null; locale: string; strings: { title: string; all: string; empty: string; emptyBody: string; error: string; fit: (fit: number) => string; rolling: string; due: (iso: string) => string; isNew: string; scout: string } }) {
  return (
    <section className="min-w-0" aria-labelledby="picks-title">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 id="picks-title" className="title text-[1.2rem] text-ink">
          {strings.title}
        </h2>
        <Link href="/app/scout" prefetch={false} className="link text-[0.9rem]">
          {strings.all}
        </Link>
      </div>
      {items === null ? (
        <div className="pane p-5 text-[0.92rem] text-ink-3">{strings.error}</div>
      ) : items.length ? (
        <ul className="grid gap-3">
          {items.map((p) => (
            <li key={p.opportunityId} className="pane min-w-0 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{opportunityTypeLabel(p.type, locale)}</Tag>
                <Tag tone="pine">{strings.fit(p.fit)}</Tag>
                {p.isNew ? <Tag tone="accent">{strings.isNew}</Tag> : null}
              </div>
              <Link href={`/app/scout/${p.opportunityId}`} prefetch={false} className="mt-3 block min-w-0">
                <h3 className="title truncate text-[1.1rem] text-ink hover:underline">{p.name}</h3>
                {p.orgName ? <p className="truncate text-[0.92rem] text-ink-3">{p.orgName}</p> : null}
              </Link>
              {p.reason ? <p className="mt-2 line-clamp-2 text-[0.9rem] leading-relaxed text-ink-2">{p.reason}</p> : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[0.84rem] text-ink-3">
                  <CalendarClock size={14} aria-hidden />
                  {p.deadline ? strings.due(p.deadline) : p.rolling ? strings.rolling : "—"}
                </span>
                <ApplyButton opportunityId={p.opportunityId} type={p.type} channel={p.channel} goalId={p.goalId} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title={strings.empty} body={strings.emptyBody} action={<ButtonLink href="/app/scout" variant="ghost">{strings.scout}</ButtonLink>} />
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
