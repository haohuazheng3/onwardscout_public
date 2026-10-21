"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ButtonLink, Chip, EmptyState, Pane, cx } from "@/components/ui";
import { cardOrder } from "@/lib/applications/present";
import type { BoardCard } from "@/lib/applications/types";
import { BOARD_COLUMNS, type BoardColumn } from "@/lib/core/state-machine";
import { ApplicationCard } from "./ApplicationCard";
import { StartPracticeButton } from "./StartPracticeButton";

/*
 * The board. Desktop: horizontal lanes (to do → preparing → needs you → ready → submitted →
 * waiting → in progress → closed), scrolling inside the board, never the page. Phones: a
 * segmented row of columns with counts and one list. Goal filter chips switch instantly
 * (client-side) and keep the URL in sync for sharing and back/forward.
 */

const MOBILE_PRIORITY: BoardColumn[] = ["needs_you", "ready", "preparing", "todo", "submitted", "waiting", "progress", "closed"];

export function ApplicationsBoard({
  initial,
  goals,
  locale,
  nowIso,
  initialGoal,
  initialColumn,
}: {
  initial: BoardCard[];
  goals: { id: string; label: string }[];
  locale: string;
  nowIso: string;
  initialGoal: string | null;
  initialColumn: BoardColumn | null;
}) {
  const t = useTranslations("applications");
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [goal, setGoal] = useState<string | null>(initialGoal && goals.some((g) => g.id === initialGoal) ? initialGoal : null);
  const cards = useMemo(() => (goal ? initial.filter((c) => c.goalId === goal) : initial), [goal, initial]);
  const byColumn = useMemo(() => {
    const m = new Map<BoardColumn, BoardCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
    for (const c of cards) m.get(c.column)?.push(c);
    for (const list of m.values()) list.sort(cardOrder);
    return m;
  }, [cards]);
  const firstNonEmpty = MOBILE_PRIORITY.find((c) => (byColumn.get(c)?.length ?? 0) > 0) ?? "needs_you";
  const [column, setColumn] = useState<BoardColumn | null>(initialColumn);
  const shown = column ?? firstNonEmpty;
  const hasPractice = initial.some((c) => c.practice);

  const setUrl = (g: string | null, col: BoardColumn | null) => {
    try {
      const url = new URL(window.location.href);
      if (g) url.searchParams.set("goal", g);
      else url.searchParams.delete("goal");
      if (col) url.searchParams.set("status", col);
      else url.searchParams.delete("status");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch (err) {
      console.warn("[applications] url sync skipped", err);
    }
  };

  if (!initial.length) {
    return (
      <EmptyState
        title={t("board.emptyTitle")}
        body={t("board.emptyBody")}
        action={
          <>
            <ButtonLink href="/app/scout" icon={<Compass size={16} aria-hidden />}>
              {t("board.findMore")}
            </ButtonLink>
            <StartPracticeButton />
          </>
        }
      />
    );
  }

  const count = (c: BoardColumn) => byColumn.get(c)?.length ?? 0;
  const needs = count("needs_you") + count("ready");

  return (
    <div className="grid min-w-0 gap-4 sm:gap-5">
      {goals.length ? (
        <div className="scroll-row gap-2" role="group" aria-label={t("board.goalFilter")}>
          <Chip
            selected={!goal}
            count={initial.length}
            onClick={() => {
              setGoal(null);
              setUrl(null, column);
            }}
          >
            {t("board.allGoals")}
          </Chip>
          {goals.map((g) => (
            <Chip
              key={g.id}
              selected={goal === g.id}
              count={initial.filter((c) => c.goalId === g.id).length}
              onClick={() => {
                setGoal(g.id);
                setUrl(g.id, column);
              }}
            >
              {g.label}
            </Chip>
          ))}
        </div>
      ) : null}

      <p className="text-[0.92rem] text-ink-3">{t("board.summary", { needs, submitted: count("submitted") + count("waiting"), progress: count("progress") })}</p>

      {!cards.length ? <EmptyState compact title={t("board.filteredEmpty")} /> : null}

      {/* Phones and tablets: one column at a time. */}
      {cards.length ? (
        <div className="grid min-w-0 gap-3 lg:hidden">
          <div className="scroll-row gap-2" role="tablist" aria-label={t("board.columns")}>
            {BOARD_COLUMNS.map((c) => (
              <Chip
                key={c}
                size="sm"
                role="tab"
                aria-selected={shown === c}
                selected={shown === c}
                count={count(c)}
                onClick={() => {
                  setColumn(c);
                  setUrl(goal, c);
                }}
              >
                {t(`columns.${c}`)}
              </Chip>
            ))}
          </div>
          <div className="grid gap-2.5" role="tabpanel">
            {(byColumn.get(shown) ?? []).map((card) => (
              <ApplicationCard key={card.id} card={card} locale={locale} now={now} />
            ))}
            {!count(shown) ? <p className="pane-inset px-4 py-6 text-center text-[0.92rem] text-ink-4">{t("board.laneEmpty")}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Desktop: lanes side by side, scrolling inside the board. */}
      {cards.length ? (
        <div className="hidden min-w-0 lg:block">
          <div className="scroll-row gap-3 pb-2">
            {BOARD_COLUMNS.map((c) => (
              <section key={c} className={cx("pane-inset flex w-[288px] shrink-0 flex-col p-3", column === c && "shadow-[0_0_0_1.5px_var(--accent)]")} aria-label={t("a11y.lane", { column: t(`columns.${c}`), count: count(c) })}>
                <div className="flex items-center justify-between px-1 pb-3 pt-1">
                  <h2 className="text-[0.86rem] font-semibold text-ink-2">{t(`columns.${c}`)}</h2>
                  <span className={cx("num inline-grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[0.78rem] font-semibold", (c === "needs_you" || c === "ready") && count(c) > 0 ? "bg-[var(--accent)] text-accent-ink" : "bg-pane text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]")}>{count(c)}</span>
                </div>
                <div className="grid gap-2.5">
                  {(byColumn.get(c) ?? []).map((card) => (
                    <ApplicationCard key={card.id} card={card} locale={locale} now={now} />
                  ))}
                  {!count(c) ? <p className="px-1 py-3 text-[0.86rem] text-ink-4">{t("board.laneEmpty")}</p> : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {!hasPractice && initial.length < 3 ? (
        <Pane pad="md" className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{t("board.practiceTitle")}</p>
            <p className="mt-1 text-[0.92rem] text-ink-3">{t("board.practiceBody")}</p>
          </div>
          <StartPracticeButton className="shrink-0" />
        </Pane>
      ) : null}
    </div>
  );
}
