"use client";

import { Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MatchFeedback } from "@/lib/core/types";
import { BOARD_GROUPS, boardGroupOfType, type BoardGroup } from "@/lib/opportunities/groups";
import {
  BOARD_VIEWS,
  DEFAULT_FILTERS,
  activeSheetFilters,
  filtersToQuery,
  hasNarrowingFilters,
  parseBoardFilters,
  type BoardFilters,
} from "@/lib/opportunities/filters";
import { hostOf } from "@/lib/opportunities/present";
import type { BoardItem, FeedbackReason } from "@/lib/opportunities/types";
import { Button, ButtonLink, Callout, Chip, EmptyState, Input, ScoutDot, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { FilterSheet } from "./FilterSheet";
import { ImportDialog } from "./ImportDialog";
import { CardSkeletons, ImportingCard, ScoutCard } from "./ScoutCard";

export interface RefreshInfo {
  refreshing: boolean;
  finishedAt: string | null;
  failed: boolean;
}

interface BoardData {
  items: BoardItem[];
  next: number | null;
  counts: Record<BoardGroup, number> | null;
  newThisWeek?: number | null;
}

const POLL_MS = 2500;
const POLL_MAX = 48;

/**
 * The Scout board (client): goal switcher, "new this week", type chips with counts, search,
 * the filter sheet, the infinite list of cards and "Add an opportunity you found". Every press
 * changes the screen at once; data aligns afterwards; failures roll back with a toast.
 */
export function ScoutBoard({
  initialFilters,
  initial,
  goals,
  regions,
  initialRefresh,
  hasMatches,
  profileState,
  scoring,
  nowIso,
}: {
  initialFilters: BoardFilters;
  initial: BoardData & { newThisWeek: number };
  goals: { id: string; label: string }[];
  regions: string[];
  initialRefresh: RefreshInfo;
  hasMatches: boolean;
  profileState: "empty" | "draft" | "ready";
  scoring: "local" | "ai";
  nowIso: string;
}) {
  const t = useTranslations("scout");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const [filters, setFilters] = useState<BoardFilters>(initialFilters);
  const [data, setData] = useState<BoardData>(initial);
  const [newThisWeek, setNewThisWeek] = useState(initial.newThisWeek);
  const [listState, setListState] = useState<"idle" | "loading">("idle");
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">("idle");
  const [refresh, setRefresh] = useState<RefreshInfo>(initialRefresh);
  const [everMatched, setEverMatched] = useState(hasMatches);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [imports, setImports] = useState<{ key: string; host: string }[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState("");
  const [searchDraft, setSearchDraft] = useState(initialFilters.q ?? "");
  const seq = useRef(0);
  const autoAll = useRef(false);
  const filtersRef = useRef(filters);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    filtersRef.current = filters;
    dataRef.current = data;
  }, [filters, data]);

  const goalLabels = useMemo(() => new Map(goals.map((g) => [g.id, g.label])), [goals]);

  /* ---------------------------------------------------------------- loading */

  const syncUrl = useCallback((f: BoardFilters) => {
    const q = filtersToQuery(f);
    const url = `${window.location.pathname}${q ? `?${q}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const reload = useCallback(
    async (f: BoardFilters, rollback?: { filters: BoardFilters; data: BoardData }) => {
      const id = ++seq.current;
      setListState("loading");
      setMoreState("idle");
      try {
        const res = await fetch(`/api/opportunities?${filtersToQuery(f, { counts: 1 })}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as (BoardData & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error || tc("errors.generic"));
        if (id !== seq.current) return;
        setData({ items: body.items, next: body.next, counts: body.counts });
        if (typeof body.newThisWeek === "number") setNewThisWeek(body.newThisWeek);
        if (body.items.some((i) => i.match && i.opportunity.type !== "practice")) setEverMatched(true);
        setListState("idle");
      } catch (err) {
        if (id !== seq.current) return;
        setListState("idle");
        if (rollback) {
          setFilters(rollback.filters);
          setData(rollback.data);
          setSearchDraft(rollback.filters.q ?? "");
          syncUrl(rollback.filters);
        }
        toast.error(tc("errors.rolledBack"), { body: err instanceof TypeError ? tc("errors.network") : err instanceof Error ? err.message : undefined });
      }
    },
    [syncUrl, tc],
  );

  const applyFilters = useCallback(
    (patch: Partial<BoardFilters>) => {
      const prev = filtersRef.current;
      const merged = { ...prev, ...patch };
      if ("group" in patch && !("type" in patch)) merged.type = null;
      const nf = parseBoardFilters(new URLSearchParams(filtersToQuery(merged)));
      if (filtersToQuery(nf) === filtersToQuery(prev)) return;
      setFilters(nf);
      syncUrl(nf);
      void reload(nf, { filters: prev, data: dataRef.current });
    },
    [reload, syncUrl],
  );

  const loadMore = useCallback(async () => {
    const cursor = dataRef.current.next;
    if (cursor === null || moreState === "loading" || listState === "loading") return;
    const id = seq.current;
    setMoreState("loading");
    try {
      const res = await fetch(`/api/opportunities?${filtersToQuery(filtersRef.current, { cursor })}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (BoardData & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error || tc("errors.generic"));
      if (id !== seq.current) return;
      setData((cur) => {
        const seen = new Set(cur.items.map((i) => i.opportunity.id));
        return { ...cur, items: [...cur.items, ...body.items.filter((i) => !seen.has(i.opportunity.id))], next: body.next };
      });
      setMoreState("idle");
    } catch {
      if (id !== seq.current) return;
      setMoreState("error");
    }
  }, [listState, moreState, tc]);

  /* infinite list: load the next page when the sentinel comes near */
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || data.next === null || moreState !== "idle") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data.next, loadMore, moreState]);

  /* ---------------------------------------------------------------- refresh ("Look again") */

  const polling = useRef(false);
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch("/api/matches?state=1", { cache: "no-store" }).catch(() => null);
        const body = res && res.ok ? ((await res.json().catch(() => null)) as { refresh?: RefreshInfo } | null) : null;
        if (!body?.refresh) continue;
        if (!body.refresh.refreshing) {
          setRefresh(body.refresh);
          if (body.refresh.failed) toast.error(t("refresh.failed"));
          await reload(filtersRef.current);
          return;
        }
      }
      setRefresh((r) => ({ ...r, refreshing: false }));
    } finally {
      polling.current = false;
    }
  }, [reload, t]);

  useEffect(() => {
    if (initialRefresh.refreshing) void poll();
  }, [initialRefresh.refreshing, poll]);

  async function lookAgain() {
    const prev = refresh;
    setRefresh({ ...prev, refreshing: true });
    try {
      const res = await fetch("/api/matches", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { refresh?: RefreshInfo; error?: string } | null;
      if (!res.ok) throw new Error(body?.error || tc("errors.generic"));
      if (body?.refresh && !body.refresh.refreshing) {
        setRefresh(body.refresh);
        await reload(filtersRef.current);
        return;
      }
      void poll();
    } catch (err) {
      setRefresh(prev);
      toast.error(t("refresh.failed"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  /* ---------------------------------------------------------------- feedback */

  /** Keeps the chip counts and "new this week" in step with cards leaving or coming back. */
  function adjustCounts(item: BoardItem, delta: 1 | -1) {
    const g = boardGroupOfType(item.opportunity.type);
    if (g) setData((cur) => (cur.counts ? { ...cur, counts: { ...cur.counts, [g]: Math.max(0, (cur.counts[g] ?? 0) + delta) } } : cur));
    if (item.match?.isNew && item.opportunity.type !== "practice") setNewThisWeek((n) => Math.max(0, n + delta));
  }

  function removeLater(id: string) {
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => {
      setData((cur) => ({ ...cur, items: cur.items.filter((i) => i.opportunity.id !== id) }));
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 180);
  }

  function restore(item: BoardItem, index: number) {
    setData((cur) => {
      if (cur.items.some((i) => i.opportunity.id === item.opportunity.id)) return cur;
      const items = [...cur.items];
      items.splice(Math.min(index, items.length), 0, item);
      return { ...cur, items };
    });
  }

  async function postFeedback(target: string, feedback: MatchFeedback | null, reason?: FeedbackReason): Promise<{ id: string; feedback: MatchFeedback | null }> {
    const res = await fetch(`/api/matches/${encodeURIComponent(target)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback, reason: reason ?? null }),
    });
    const body = (await res.json().catch(() => null)) as { match?: { id: string; feedback: MatchFeedback | null }; error?: string } | null;
    if (!res.ok || !body?.match) throw new Error(body?.error || tc("errors.generic"));
    return body.match;
  }

  async function onFeedback(item: BoardItem, feedback: MatchFeedback | null, reason?: FeedbackReason) {
    const index = dataRef.current.items.findIndex((i) => i.opportunity.id === item.opportunity.id);
    removeLater(item.opportunity.id);
    adjustCounts(item, -1);
    let matchId: string;
    try {
      const saved = await postFeedback(item.match?.id ?? item.opportunity.id, feedback, reason);
      matchId = saved.id;
    } catch (err) {
      restore(item, index);
      adjustCounts(item, 1);
      toast.error(tc("errors.rolledBack"), { body: err instanceof TypeError ? tc("errors.network") : err instanceof Error ? err.message : undefined });
      return;
    }
    const restored: BoardItem = item.match ? item : { ...item, match: null };
    const title = feedback === "later" ? t("feedback.savedLater") : feedback === "not_interested" ? t("feedback.dismissed") : t("feedback.movedBack");
    toast({
      title,
      body: feedback === "not_interested" ? t("feedback.learns") : undefined,
      action: {
        label: t("feedback.undo"),
        onClick: async () => {
          restore(restored, index);
          adjustCounts(item, 1);
          try {
            await postFeedback(matchId, item.match?.feedback ?? null);
          } catch (err) {
            removeLater(item.opportunity.id);
            adjustCounts(item, -1);
            toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
          }
        },
      },
    });
  }

  /* ---------------------------------------------------------------- import */

  async function importUrl(url: string) {
    const key = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const host = hostOf(/^https?:\/\//i.test(url) ? url : `https://${url}`) ?? url;
    setImportOpen(false);
    setImports((cur) => [{ key, host }, ...cur]);
    try {
      const res = await fetch("/api/opportunities/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = (await res.json().catch(() => null)) as
        | { opportunity?: BoardItem["opportunity"]; match?: BoardItem["match"]; created?: boolean; missing?: string[]; typeGuessed?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.opportunity) throw new Error(body?.error || tc("errors.generic"));
      const item: BoardItem = { opportunity: body.opportunity, match: body.match ?? null, application: null };
      setData((cur) => ({ ...cur, items: [item, ...cur.items.filter((i) => i.opportunity.id !== item.opportunity.id)] }));
      setImportDraft("");
      toast.success(body.created ? t("import.added") : t("import.alreadyThere"), {
        body: body.typeGuessed ? t("import.typeGuessed") : body.missing?.length ? t("import.missing") : undefined,
      });
    } catch (err) {
      setImportDraft(url);
      toast.error(t("import.failed"), {
        body: err instanceof TypeError ? tc("errors.network") : err instanceof Error ? err.message : undefined,
        action: { label: t("import.tryAgain"), onClick: () => setImportOpen(true) },
      });
    } finally {
      setImports((cur) => cur.filter((x) => x.key !== key));
    }
  }

  /* ---------------------------------------------------------------- search */

  const searchTimer = useRef<number | null>(null);
  function commitSearch(raw: string) {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = raw.trim();
    const cur = filtersRef.current;
    if ((cur.q ?? "") === q) return;
    if (q && cur.view === "picks") {
      autoAll.current = true;
      applyFilters({ q, view: "all", goal: null });
    } else if (!q && autoAll.current) {
      autoAll.current = false;
      applyFilters({ q: null, view: "picks" });
    } else applyFilters({ q: q || null });
  }
  function onSearchInput(value: string) {
    setSearchDraft(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => commitSearch(value), 380);
  }

  /* ---------------------------------------------------------------- render */

  const sheetCount = activeSheetFilters(filters);
  const narrowing = hasNarrowingFilters(filters);
  const showGoals = filters.view !== "all" && goals.length > 0;
  // A refresh that finished after the page was rendered is newer than `now`: never "in 40 seconds".
  const lastLooked = refresh.finishedAt
    ? format.relativeTime(new Date(refresh.finishedAt), new Date(Math.max(now.getTime(), new Date(refresh.finishedAt).getTime())))
    : null;
  const totalCount = data.counts ? BOARD_GROUPS.reduce((n, g) => n + (data.counts?.[g] ?? 0), 0) : null;
  const visibleItems = data.items;
  const empty = listState === "idle" && !visibleItems.length && !imports.length;

  return (
    <div className="grid min-w-0 gap-4 sm:gap-5">
      {/* header pane: goals, new this week, look again, add one you found */}
      <section className="pane min-w-0 p-4 sm:p-6" aria-label={t("header.label")}>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <ScoutDot live={refresh.refreshing} />
              <p className="num text-[1.05rem] font-semibold text-ink" aria-live="polite">
                {refresh.refreshing ? t("header.looking") : t("header.newThisWeek", { count: newThisWeek })}
              </p>
            </div>
            <p className="mt-1 text-[0.88rem] text-ink-3">
              {lastLooked ? t("header.lastLooked", { when: lastLooked }) : t("header.neverLooked")}
              {" · "}
              {scoring === "ai" ? t("header.scoringAi") : t("header.scoringLocal")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="sm:hidden"
              icon={<RefreshCw size={16} className={refresh.refreshing ? "animate-spin" : undefined} aria-hidden />}
              onClick={lookAgain}
              aria-label={refresh.refreshing ? t("header.lookingShort") : t("header.lookAgain")}
              aria-busy={refresh.refreshing || undefined}
              disabled={refresh.refreshing}
            />
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              icon={<RefreshCw size={15} className={refresh.refreshing ? "animate-spin" : undefined} aria-hidden />}
              onClick={lookAgain}
              aria-busy={refresh.refreshing || undefined}
              disabled={refresh.refreshing}
            >
              {refresh.refreshing ? t("header.lookingShort") : t("header.lookAgain")}
            </Button>
            <Button variant="ink" size="sm" className="flex-1 sm:flex-none" icon={<Plus size={15} aria-hidden />} onClick={() => setImportOpen(true)}>
              {t("import.open")}
            </Button>
          </div>
        </div>
        {showGoals ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="sr-only">{t("header.goalsLabel")}</p>
            <div className="scroll-row -mx-4 scroll-px-4 px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6" role="group" aria-label={t("header.goalsLabel")}>
              <Chip size="sm" selected={!filters.goal} onClick={() => applyFilters({ goal: null })}>
                {t("header.allGoals")}
              </Chip>
              {goals.map((g) => (
                <Chip key={g.id} size="sm" selected={filters.goal === g.id} onClick={() => applyFilters({ goal: filters.goal === g.id ? null : g.id })} className="max-w-[260px]">
                  {g.label}
                </Chip>
              ))}
            </div>
          </div>
        ) : goals.length === 0 ? (
          <div className="mt-4 border-t border-line pt-4 text-[0.9rem] text-ink-3">
            {t("header.noGoals")}{" "}
            <ButtonLink href="/app/goals" variant="quiet" size="sm" className="-my-2 align-baseline">
              {t("header.setGoal")}
            </ButtonLink>
          </div>
        ) : null}
      </section>

      {profileState !== "ready" ? (
        <Callout
          tone="accent"
          title={profileState === "empty" ? t("profileHint.emptyTitle") : t("profileHint.draftTitle")}
          action={
            <ButtonLink href={profileState === "empty" ? "/app/start" : "/app/profile"} variant="ink" size="sm">
              {profileState === "empty" ? t("profileHint.emptyCta") : t("profileHint.draftCta")}
            </ButtonLink>
          }
        >
          {profileState === "empty" ? t("profileHint.emptyBody") : t("profileHint.draftBody")}
        </Callout>
      ) : null}

      {/* toolbar: views, search, filters */}
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex shrink-0 gap-1.5" role="group" aria-label={t("views.label")}>
            {BOARD_VIEWS.map((v) => (
              <Chip
                key={v}
                size="sm"
                selected={filters.view === v}
                onClick={() => {
                  autoAll.current = false;
                  applyFilters({ view: v });
                }}
              >
                {t(`views.${v}`)}
              </Chip>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 gap-2">
            <form
              role="search"
              className="relative min-w-0 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                commitSearch(searchDraft);
              }}
            >
              <label htmlFor="scout-search" className="sr-only">
                {t("search.label")}
              </label>
              <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
              <Input
                id="scout-search"
                type="search"
                enterKeyHint="search"
                value={searchDraft}
                placeholder={t("search.placeholder")}
                onChange={(e) => onSearchInput(e.target.value)}
                className="h-12 min-h-0 pl-11 pr-11"
                maxLength={120}
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft("");
                    commitSearch("");
                  }}
                  className="press absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-pane-2"
                  aria-label={t("search.clear")}
                >
                  <X size={16} aria-hidden />
                </button>
              ) : null}
            </form>
            <Button variant="ghost" className="h-12 shrink-0" icon={<SlidersHorizontal size={16} aria-hidden />} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
              <span className="hidden sm:inline">{t("filters.button")}</span>
              {sheetCount ? <span className="badge-count ml-1">{sheetCount}</span> : <span className="sr-only sm:hidden">{t("filters.button")}</span>}
            </Button>
          </div>
        </div>
        {filters.q && filters.view === "all" ? <p className="text-[0.86rem] text-ink-3">{t("search.everything")}</p> : null}

        <div className="scroll-row -mx-4 scroll-px-4 px-4 sm:mx-0 sm:flex-wrap sm:scroll-px-0 sm:px-0" role="group" aria-label={t("groups.label")}>
          <Chip size="sm" selected={!filters.group} count={totalCount ?? undefined} onClick={() => applyFilters({ group: null })}>
            {t("groups.all")}
          </Chip>
          {BOARD_GROUPS.map((g) => (
            <Chip key={g} size="sm" selected={filters.group === g} count={data.counts?.[g]} onClick={() => applyFilters({ group: filters.group === g ? null : g })}>
              {t(`groups.${g}`)}
            </Chip>
          ))}
        </div>
      </div>

      {/* the list */}
      <section aria-label={t(`views.${filters.view}`)} aria-busy={listState === "loading" || undefined} className="min-w-0">
        {empty ? (
          <BoardEmpty
            view={filters.view}
            narrowing={narrowing}
            refreshing={refresh.refreshing}
            everMatched={everMatched}
            q={filters.q}
            onClear={() => {
              autoAll.current = false;
              setSearchDraft("");
              applyFilters({ ...DEFAULT_FILTERS, view: filters.view === "all" && !filters.q ? "all" : "picks", goal: filters.goal });
            }}
            onLookAgain={lookAgain}
            onShowAll={() => applyFilters({ view: "all" })}
          />
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {imports.map((i) => (
              <ImportingCard key={i.key} host={i.host} />
            ))}
            {listState === "loading" ? (
              <CardSkeletons count={4} />
            ) : (
              visibleItems.map((item) => (
                <ScoutCard
                  key={item.opportunity.id}
                  item={item}
                  now={now}
                  view={filters.view}
                  goalLabel={item.match?.goalId && !filters.goal && goals.length > 1 ? (goalLabels.get(item.match.goalId) ?? null) : null}
                  leaving={leaving.has(item.opportunity.id)}
                  onFeedback={onFeedback}
                />
              ))
            )}
            {listState === "idle" && moreState === "loading" ? <CardSkeletons count={2} /> : null}
          </div>
        )}
        {listState === "idle" && data.next !== null ? (
          <div ref={sentinel} className="mt-5 flex justify-center">
            {moreState === "error" ? (
              <Button variant="ghost" onClick={() => setMoreState("idle")}>
                {t("list.retryMore")}
              </Button>
            ) : (
              <Button variant="quiet" onClick={() => void loadMore()} loading={moreState === "loading"}>
                {t("list.showMore")}
              </Button>
            )}
          </div>
        ) : null}
        {listState === "idle" && data.next === null && visibleItems.length > 6 ? <p className="mt-6 text-center text-[0.88rem] text-ink-4">{t("list.end")}</p> : null}
      </section>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        regions={regions}
        onChange={applyFilters}
        onClear={() => applyFilters({ remote: null, country: null, deadline: null, effort: null })}
      />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} initialUrl={importDraft} onSubmit={importUrl} />
    </div>
  );
}

function BoardEmpty({
  view,
  narrowing,
  refreshing,
  everMatched,
  q,
  onClear,
  onLookAgain,
  onShowAll,
}: {
  view: BoardFilters["view"];
  narrowing: boolean;
  refreshing: boolean;
  everMatched: boolean;
  q: string | null;
  onClear: () => void;
  onLookAgain: () => void;
  onShowAll: () => void;
}) {
  const t = useTranslations("scout.empty");
  if (narrowing) {
    return (
      <EmptyState
        title={q ? t("searchTitle", { q }) : t("filteredTitle")}
        body={q ? t("searchBody") : t("filteredBody")}
        action={
          <Button variant="ghost" onClick={onClear}>
            {t("clear")}
          </Button>
        }
      />
    );
  }
  if (view === "later") return <EmptyState title={t("laterTitle")} body={t("laterBody")} />;
  if (view === "all") return <EmptyState title={t("allTitle")} body={t("allBody")} />;
  if (refreshing || !everMatched) {
    return (
      <EmptyState
        icon={<ScoutDot live className={cx("h-3 w-3")} />}
        title={t("lookingTitle")}
        body={refreshing ? t("lookingBody") : t("idleBody")}
        action={
          <>
            <Button variant="primary" onClick={onLookAgain} loading={refreshing}>
              {refreshing ? t("looking") : t("lookAgain")}
            </Button>
            <Button variant="ghost" onClick={onShowAll}>
              {t("browseAll")}
            </Button>
          </>
        }
      />
    );
  }
  return (
    <EmptyState
      title={t("seenAllTitle")}
      body={t("seenAllBody")}
      action={
        <>
          <Button variant="primary" onClick={onLookAgain}>
            {t("lookAgain")}
          </Button>
          <Button variant="ghost" onClick={onShowAll}>
            {t("browseAll")}
          </Button>
        </>
      }
    />
  );
}
