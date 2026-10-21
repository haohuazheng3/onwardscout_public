"use client";

import { Bell, CheckCheck, ChevronRight, Settings } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { updateAppStatus, useAppStatus } from "@/components/AppNav";
import { Button, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { Link, usePathname } from "@/i18n/navigation";

/*
 * The bell in the app shell (P6; contracts-features §9). Press → the list opens at once: a
 * popover from 640px, a bottom sheet on phones. The last list is kept in memory so reopening is
 * instant; it refreshes in the background (skeleton rows only the first time). Opening an item
 * marks it read optimistically; "Mark all read" clears the badge at once and rolls back with a
 * toast if the server refuses.
 */

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ListResponse {
  notifications: Item[];
  unread: number;
  more: boolean;
}

const PAGE = 20;
const FRESH_MS = 30_000;
const KINDS = ["needs_you", "submitted", "reply", "progress", "new_matches", "digest", "billing", "system"] as const;

let cache: { items: Item[]; more: boolean; at: number } | null = null;

async function fetchPage(before?: string): Promise<ListResponse> {
  const qs = new URLSearchParams({ limit: String(PAGE), ...(before ? { before } : {}) });
  const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`/api/notifications answered ${res.status}`);
  return (await res.json()) as ListResponse;
}

function postRead(body: { ids: string[] } | { all: true }, keepalive = false): Promise<Response> {
  return fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive,
  });
}

function RowSkeleton() {
  return (
    <li className="flex gap-3 px-4 py-3.5" aria-hidden="true">
      <span className="skeleton mt-1 h-2.5 w-2.5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <span className="skeleton block h-3 w-20 rounded-full" />
        <span className="skeleton mt-2.5 block h-4 w-4/5 rounded-full" />
        <span className="skeleton mt-2 block h-3 w-3/5 rounded-full" />
      </span>
    </li>
  );
}

export function NotificationsBell({ className }: { className?: string }) {
  const t = useTranslations("settings.bell");
  const tc = useTranslations("common");
  const format = useFormatter();
  const pathname = usePathname();
  const { unreadNotifications: unread } = useAppStatus();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [items, setItems] = useState<Item[] | null>(cache?.items ?? null);
  const [more, setMore] = useState(cache?.more ?? false);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const store = useCallback((next: Item[], hasMore: boolean) => {
    cache = { items: next, more: hasMore, at: Date.now() };
    setItems(next);
    setMore(hasMore);
  }, []);

  const refresh = useCallback(async () => {
    if (!cache) setState("loading");
    try {
      const data = await fetchPage();
      store(data.notifications, data.more);
      updateAppStatus({ unreadNotifications: data.unread });
      setState("idle");
    } catch (err) {
      console.warn("[bell] list unavailable", err);
      setState(cache ? "idle" : "error");
    }
  }, [store]);

  function openList() {
    const wide = window.matchMedia("(min-width: 640px)").matches;
    setSheet(!wide);
    setNow(Date.now());
    setOpen(true);
    if (!cache || Date.now() - cache.at > FRESH_MS || cache.items.filter((i) => !i.readAt).length !== unread) void refresh();
  }

  const close = useCallback((focusButton = false) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  // Popover: close on an outside press, on Esc and when the route changes.
  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, sheet, close]);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  function markOne(item: Item) {
    if (item.readAt || !items) return;
    const now = new Date().toISOString();
    store(
      items.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)),
      more,
    );
    updateAppStatus({ unreadNotifications: Math.max(0, unread - 1) });
    // keepalive: the request survives the navigation the click starts.
    postRead({ ids: [item.id] }, true).catch((err) => console.warn("[bell] mark read failed", err));
  }

  async function markAll() {
    if (!items) return;
    const before = items;
    const beforeUnread = unread;
    const now = new Date().toISOString();
    store(
      items.map((i) => (i.readAt ? i : { ...i, readAt: now })),
      more,
    );
    updateAppStatus({ unreadNotifications: 0 });
    try {
      const res = await postRead({ all: true });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? tc("errors.generic"));
      const data = (await res.json().catch(() => null)) as { unread?: number } | null;
      if (typeof data?.unread === "number") updateAppStatus({ unreadNotifications: data.unread });
    } catch (err) {
      store(before, more);
      updateAppStatus({ unreadNotifications: beforeUnread });
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function loadMore() {
    if (!items?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(items[items.length - 1].createdAt);
      const seen = new Set(items.map((i) => i.id));
      store([...items, ...data.notifications.filter((n) => !seen.has(n.id))], data.more);
    } catch (err) {
      toast.error(t("loadFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setLoadingMore(false);
    }
  }

  const kindLabel = (kind: string) => ((KINDS as readonly string[]).includes(kind) ? t(`kinds.${kind}`) : t("kinds.system"));

  const list: ReactNode = (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1 sm:pt-3">
        <p className="text-[0.86rem] text-ink-3" aria-live="polite">
          {t("unread", { count: unread })}
        </p>
        <Button variant="quiet" size="sm" icon={<CheckCheck size={16} aria-hidden />} onClick={() => void markAll()} disabled={!items || unread === 0}>
          {t("markAll")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items === null && state !== "error" ? (
          <ul aria-busy="true" aria-label={tc("status.loading")} className="divide-y divide-[var(--line)]">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </ul>
        ) : items === null ? (
          <div className="px-4 py-8 text-center">
            <p className="font-semibold text-ink">{t("loadFailed")}</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => void refresh()}>
              {t("retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="title text-[1.05rem] text-ink">{t("empty")}</p>
            <p className="mx-auto mt-1.5 max-w-[30ch] text-[0.9rem] leading-relaxed text-ink-3">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((item) => {
              const unreadItem = !item.readAt;
              const content = (
                <>
                  <span className={cx("mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full", unreadItem ? "bg-accent" : "bg-transparent")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[0.76rem] font-semibold uppercase tracking-[0.06em] text-ink-4">
                      {kindLabel(item.kind)}
                      <span className="font-normal normal-case tracking-normal">· {format.relativeTime(new Date(item.createdAt), now || new Date(item.createdAt))}</span>
                      {unreadItem ? <span className="sr-only">{t("new")}</span> : null}
                    </span>
                    <span className={cx("mt-0.5 block break-words text-[0.95rem] leading-snug", unreadItem ? "font-semibold text-ink" : "text-ink-2")}>{item.title}</span>
                    {item.body ? <span className="mt-1 line-clamp-3 block whitespace-pre-line break-words text-[0.86rem] leading-snug text-ink-3">{item.body}</span> : null}
                  </span>
                  {item.href ? <ChevronRight size={16} className="mt-1 shrink-0 text-ink-4" aria-hidden /> : null}
                </>
              );
              const rowClass = "press flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-pane-2";
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link href={item.href} prefetch={false} className={rowClass} onClick={() => markOne(item)}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" className={rowClass} onClick={() => markOne(item)}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {items && more ? (
          <div className="px-4 py-3">
            <Button variant="quiet" size="sm" block loading={loadingMore} onClick={() => void loadMore()}>
              {tc("buttons.showMore")}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="border-t border-line px-2 py-2">
        <Link
          href="/app/settings#notifications"
          prefetch={false}
          className="press flex min-h-[42px] items-center gap-2 rounded-[14px] px-2 text-[0.88rem] font-medium text-ink-3 hover:bg-pane-2 hover:text-ink"
        >
          <Settings size={16} aria-hidden />
          {t("seeAll")}
        </Link>
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className={cx("relative inline-flex", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={tc("appNav.notificationsUnread", { count: unread })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !sheet ? panelId : undefined}
        onClick={() => (open ? close() : openList())}
        className={cx("btn btn-quiet btn-icon btn-sm relative", open && "bg-pane-2")}
      >
        <Bell size={19} aria-hidden />
        {unread > 0 ? <span className="badge-count absolute -right-0.5 -top-0.5">{unread > 99 ? "99+" : unread}</span> : null}
      </button>

      {open && !sheet ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("label")}
          className="pane animate-pop absolute right-0 top-[calc(100%+12px)] z-50 flex max-h-[min(72vh,620px)] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] p-0 pt-1"
        >
          <p className="title px-4 pt-3 text-[1.1rem] text-ink">{t("label")}</p>
          {list}
        </div>
      ) : null}

      <Dialog open={open && sheet} onClose={() => close(true)} title={t("label")} className="max-h-[85dvh]">
        <div className="-mx-5 -mb-5 flex max-h-[65dvh] flex-col sm:-mx-7 sm:-mb-7">{list}</div>
      </Dialog>
    </div>
  );
}
