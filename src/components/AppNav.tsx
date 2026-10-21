"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Compass,
  CreditCard,
  Ellipsis,
  FileText,
  House,
  Plug,
  Send,
  Settings,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { LocaleList, LocaleSwitcher } from "./LocaleSwitcher";
import { LogoLink, LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";
import { APP_STATUS_EVENT, parseAppStatus, sanitizePatch, type AppStatus, type AppStatusPatch } from "./app-status";
import { Dialog } from "./ui-client";
import { useHydrated } from "./use-hydrated";

export { APP_STATUS_EVENT, type AppStatus, type AppStatusPatch } from "./app-status";

/*
 * The signed-in shell. Desktop (≥1024px): a floating rail pane on the left and a slim
 * floating top bar. Phones: a compact top bar and a floating bottom tab bar (safe-area
 * aware) with Home · Scout · Applications · Profile · More; "More" opens a sheet with
 * Documents, Goals, Integrations, Billing and Settings.
 *
 * Every nav press highlights its target at once (optimistic), while the route's
 * loading.tsx skeleton renders; the highlight settles when the pathname changes.
 */

/* ======================================================================= nav model */

type NavKey = "home" | "scout" | "applications" | "profile" | "documents" | "goals" | "integrations" | "billing" | "settings";
type NavItem = { href: string; key: NavKey; Icon: LucideIcon; exact?: boolean };

export const APP_PRIMARY_NAV: NavItem[] = [
  { href: "/app", key: "home", Icon: House, exact: true },
  { href: "/app/scout", key: "scout", Icon: Compass },
  { href: "/app/applications", key: "applications", Icon: Send },
  { href: "/app/profile", key: "profile", Icon: UserRound },
];

export const APP_MORE_NAV: NavItem[] = [
  { href: "/app/documents", key: "documents", Icon: FileText },
  { href: "/app/goals", key: "goals", Icon: Target },
  { href: "/app/integrations", key: "integrations", Icon: Plug },
  { href: "/app/billing", key: "billing", Icon: CreditCard },
  { href: "/app/settings", key: "settings", Icon: Settings },
];

function matches(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href || pathname === `${item.href}/start`;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Active state with an optimistic override: the pressed item lights up before the route lands. */
function useActiveNav() {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setPending(null);
  }
  const isActive = (item: NavItem) => (pending ? pending === item.href : matches(pathname, item));
  const press = (item: NavItem) => {
    if (!matches(pathname, item) || pathname !== item.href) setPending(item.href);
  };
  return { pathname, isActive, press, pending };
}

/* ======================================================================= status store (/api/me) */

const SERVER_STATUS: AppStatus = { available: null, reserved: 0, unreadNotifications: 0, needsYou: 0, state: "idle" };
let status: AppStatus = SERVER_STATUS;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const statusListeners = new Set<() => void>();

function setStatus(next: AppStatus) {
  status = next;
  for (const l of statusListeners) l();
}

/**
 * Push fresh numbers into the shell from anywhere (after a reservation, a purchase, a
 * notification read): `updateAppStatus({ available: 41, reserved: 1 })`. Non-module code can
 * dispatch `new CustomEvent("os:app-status", { detail: patch })` instead.
 */
export function updateAppStatus(patch: AppStatusPatch) {
  setStatus({ ...status, ...patch, state: "ready" });
}

/** Refetch /api/me now (e.g. after checkout). Concurrent callers share one request. */
export function refreshAppStatus(): Promise<void> {
  if (inFlight) return inFlight;
  if (status.state === "idle") setStatus({ ...status, state: "loading" });
  inFlight = fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
    .then(async (r) => {
      if (!r.ok) throw new Error(`/api/me answered ${r.status}`);
      const patch = parseAppStatus(await r.json());
      fetchedAt = Date.now();
      setStatus({ ...status, ...patch, state: "ready" });
    })
    .catch((e: unknown) => {
      console.warn("[app] status unavailable", e);
      setStatus({ ...status, state: status.available === null ? "error" : "ready" });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribeStatus(cb: () => void) {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

/** The shell's live numbers (credits, unread notifications, "needs you"). */
export function useAppStatus(): AppStatus {
  return useSyncExternalStore(subscribeStatus, () => status, () => SERVER_STATUS);
}

/** Loads /api/me once per mount, again when the tab regains focus after a minute, and listens for pushes. */
function AppStatusLoader() {
  useEffect(() => {
    if (status.state === "idle" || Date.now() - fetchedAt > 60_000) void refreshAppStatus();
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - fetchedAt > 60_000) void refreshAppStatus();
    };
    const onPush = (e: Event) => updateAppStatus(sanitizePatch((e as CustomEvent<unknown>).detail));
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(APP_STATUS_EVENT, onPush);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(APP_STATUS_EVENT, onPush);
    };
  }, []);
  return null;
}

/* ======================================================================= credits, notifications, user */

/**
 * The credit balance chip. Presentational: feed it `available` (and `reserved`); `null`
 * renders the shimmer placeholder. Links to billing.
 */
export function CreditsBadge({
  available,
  reserved = 0,
  href = "/app/billing",
  className,
}: {
  available: number | null;
  reserved?: number;
  href?: string;
  className?: string;
}) {
  const t = useTranslations("common.appNav");
  if (available === null) return <span className={cx("skeleton inline-block h-9 w-[92px] rounded-full", className)} aria-hidden="true" />;
  const empty = available <= 0;
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={t("creditsLabel", { count: available, reserved })}
      className={cx(
        "press inline-flex min-h-[36px] items-center gap-2 rounded-full px-3 text-[0.84rem] font-semibold transition-colors",
        empty
          ? "bg-accent-soft text-accent-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]"
          : "bg-pane-2 text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-pane-3",
        className,
      )}
    >
      <span className={cx("h-2 w-2 rounded-full", empty ? "bg-accent" : "bg-pine")} aria-hidden="true" />
      <span className="num">{t("credits", { count: available })}</span>
      {reserved > 0 ? <span className="num hidden font-medium text-ink-3 sm:inline">· {t("creditsHeld", { count: reserved })}</span> : null}
      {empty ? <span className="hidden sm:inline">· {t("topUp")}</span> : null}
    </Link>
  );
}

/** CreditsBadge fed by the shell's status store; hides itself if /api/me has no balance. */
export function CreditsBadgeLive({ className }: { className?: string }) {
  const s = useAppStatus();
  if (s.state === "error" && s.available === null) return null;
  if (s.state === "ready" && s.available === null) return null;
  return <CreditsBadge available={s.available} reserved={s.reserved} className={className} />;
}

/** Bell with the unread count; opens the notification list on the home page. */
export function NotificationsButton({ className }: { className?: string }) {
  const t = useTranslations("common.appNav");
  const { unreadNotifications: unread } = useAppStatus();
  return (
    <Link
      href="/app#notifications"
      prefetch={false}
      aria-label={t("notificationsUnread", { count: unread })}
      className={cx("btn btn-quiet btn-icon btn-sm relative", className)}
    >
      <Bell size={19} aria-hidden />
      {unread > 0 ? (
        <span className="badge-count absolute -right-0.5 -top-0.5">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Link>
  );
}

/** Clerk's account button, rendered only after hydration and Clerk load (no #418 mismatch). */
export function UserMenu() {
  const hydrated = useHydrated();
  const { isLoaded } = useAuth();
  if (!hydrated || !isLoaded) return <span className="skeleton skeleton-circle inline-block h-9 w-9" aria-hidden="true" />;
  return (
    <span className="grid h-10 w-10 place-items-center">
      <UserButton />
    </span>
  );
}

/** "N need you" — the one thing on the board that is waiting for a tap. `short` for phones. */
function NeedsYouPill({ className, short = false }: { className?: string; short?: boolean }) {
  const t = useTranslations("common.appNav");
  const { needsYou } = useAppStatus();
  if (needsYou <= 0) return null;
  return (
    <Link
      href="/app/applications?status=needs_you"
      prefetch={false}
      className={cx(
        "press inline-flex min-h-[36px] min-w-0 items-center gap-2 rounded-full bg-accent-soft px-3.5 text-[0.86rem] font-semibold text-accent-text",
        className,
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      {short ? (
        <>
          <span className="num" aria-hidden="true">
            {needsYou}
          </span>
          <span className="sr-only">{t("needsYou", { count: needsYou })}</span>
        </>
      ) : (
        <>
          <span className="truncate">{t("needsYou", { count: needsYou })}</span>
          <ArrowRight size={15} className="shrink-0" aria-hidden />
        </>
      )}
    </Link>
  );
}

/* ======================================================================= desktop rail */

function RailLink({ item, active, onPress, small = false }: { item: NavItem; active: boolean; onPress: () => void; small?: boolean }) {
  const t = useTranslations("common.appNav");
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      prefetch={item.key === "home" || item.key === "scout" || item.key === "applications" ? undefined : false}
      aria-current={active ? "page" : undefined}
      onPointerDown={onPress}
      onClick={onPress}
      className={cx(
        "press group relative flex items-center gap-3 rounded-[16px] px-3 font-medium transition-colors",
        small ? "min-h-[42px] text-[0.9rem]" : "min-h-[48px] text-[0.97rem]",
        active ? "bg-pane-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-3 hover:bg-pane-2/60 hover:text-ink",
      )}
    >
      <Icon size={small ? 17 : 19} strokeWidth={active ? 2.25 : 1.9} className={active ? "text-ink" : "text-ink-4 group-hover:text-ink-2"} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
      {active ? <span className="scout-dot" aria-hidden="true" /> : null}
    </Link>
  );
}

export function AppRail() {
  const t = useTranslations("common");
  const { isActive, press } = useActiveNav();
  return (
    <aside
      className="fixed bottom-4 left-4 top-4 z-30 hidden w-[244px] lg:block"
      style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
    >
      <div className="pane flex h-full flex-col overflow-y-auto overscroll-contain p-3">
        <div className="px-2 pb-4 pt-1">
          <LogoLink href="/app" label={t("a11y.appHome")} />
        </div>
        <nav aria-label={t("a11y.appNav")} className="flex flex-col gap-1">
          {APP_PRIMARY_NAV.map((item) => (
            <RailLink key={item.href} item={item} active={isActive(item)} onPress={() => press(item)} />
          ))}
          <p className="eyebrow mb-1 mt-5 px-3">{t("appNav.more")}</p>
          {APP_MORE_NAV.map((item) => (
            <RailLink key={item.href} item={item} active={isActive(item)} onPress={() => press(item)} small />
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-1 pt-6">
          <div className="flex items-center justify-between gap-2">
            <LocaleSwitcher size="sm" />
            <ThemeToggle compact />
          </div>
          <Link
            href="/"
            className="press flex min-h-[40px] items-center gap-2 rounded-[14px] px-2 text-[0.86rem] text-ink-3 hover:text-ink"
          >
            <ArrowLeft size={15} aria-hidden />
            {t("appNav.backToSite")}
          </Link>
        </div>
      </div>
    </aside>
  );
}

/* ======================================================================= top bar */

export function AppTopBar({ credits, notifications }: { credits?: ReactNode; notifications?: ReactNode }) {
  const t = useTranslations("common");
  return (
    <div
      className="sticky top-0 z-20 px-3 sm:px-6 lg:px-8"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-2 lg:pt-1">
        {/* Phones: the mark leads home. Desktop: the rail carries the brand; the left side holds "needs you". */}
        <div className="pane-glass flex h-[52px] min-w-0 items-center gap-2 rounded-full pl-2 pr-2 lg:hidden">
          <Link href="/app" aria-label={t("a11y.appHome")} className="press grid h-10 w-10 shrink-0 place-items-center rounded-full">
            <LogoMark size={26} />
          </Link>
          <NeedsYouPill short className="px-3" />
        </div>
        <div className="hidden min-w-0 lg:block">
          <NeedsYouPill />
        </div>
        <div className="pane-glass flex h-[52px] shrink-0 items-center gap-1 rounded-full pl-2 pr-1.5">
          {credits ?? <CreditsBadgeLive />}
          {notifications ?? <NotificationsButton />}
          <UserMenu />
        </div>
      </div>
    </div>
  );
}

/* ======================================================================= mobile tab bar */

function MoreSheet({ open, onClose, isActive, press }: { open: boolean; onClose: () => void; isActive: (i: NavItem) => boolean; press: (i: NavItem) => void }) {
  const t = useTranslations("common");
  return (
    <Dialog open={open} onClose={onClose} title={t("appNav.moreTitle")}>
      <nav aria-label={t("appNav.more")} className="grid grid-cols-2 gap-2">
        {APP_MORE_NAV.map((item) => {
          const active = isActive(item);
          const { Icon } = item;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                press(item);
                onClose();
              }}
              className={cx(
                "press flex min-h-[76px] flex-col justify-between rounded-[20px] p-3.5 text-[0.95rem] font-semibold",
                active ? "bg-ink text-void" : "bg-pane-2 text-ink shadow-[inset_0_0_0_1px_var(--line)]",
              )}
            >
              <Icon size={20} aria-hidden className={active ? "" : "text-pine"} />
              {t(`appNav.${item.key}`)}
            </Link>
          );
        })}
      </nav>
      <LocaleList className="mt-5" />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <ThemeToggle />
        <Link href="/" className="press inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap text-[0.88rem] text-ink-3 hover:text-ink">
          <ArrowLeft size={15} aria-hidden />
          {t("appNav.backToSite")}
        </Link>
      </div>
    </Dialog>
  );
}

export function AppTabBar() {
  const t = useTranslations("common.appNav");
  const { isActive, press } = useActiveNav();
  const { needsYou } = useAppStatus();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = APP_MORE_NAV.some((i) => isActive(i));

  const cell = "press flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] pt-1 text-[0.68rem] font-semibold leading-none";

  return (
    <>
      <nav
        aria-label={t("workspace")}
        className="app-tabbar fixed inset-x-3 z-40 lg:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
      >
        <div className="pane-glass flex h-[66px] items-stretch gap-0.5 rounded-[26px] p-1.5">
          {APP_PRIMARY_NAV.map((item) => {
            const active = isActive(item);
            const { Icon } = item;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.key === "profile" ? false : undefined}
                aria-current={active ? "page" : undefined}
                onPointerDown={() => press(item)}
                onClick={() => press(item)}
                className={cx(cell, active ? "text-ink" : "text-ink-3")}
              >
                <span
                  className={cx(
                    "relative grid h-[30px] w-[46px] place-items-center rounded-full transition-colors duration-150",
                    active ? "bg-ink text-void" : "",
                  )}
                >
                  <Icon size={19} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
                  {item.key === "applications" && needsYou > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_2px_var(--pane)]" aria-hidden="true" />
                  ) : null}
                </span>
                <span className="max-w-full truncate px-0.5">{t(item.key)}</span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={cx(cell, moreActive || moreOpen ? "text-ink" : "text-ink-3")}
          >
            <span className={cx("grid h-[30px] w-[46px] place-items-center rounded-full", moreActive ? "bg-ink text-void" : "")}>
              <Ellipsis size={20} aria-hidden />
            </span>
            <span>{t("more")}</span>
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} isActive={isActive} press={press} />
    </>
  );
}

/* ======================================================================= shell */

/** The whole signed-in chrome around `children`. Used by app/layout.tsx. */
export function AppShell({ children, credits, notifications }: { children: ReactNode; credits?: ReactNode; notifications?: ReactNode }) {
  return (
    <div className="min-h-screen-d">
      <AppStatusLoader />
      <AppRail />
      <div className="lg:pl-[276px]">
        <AppTopBar credits={credits} notifications={notifications} />
        <main id="main" className="app-main mx-auto w-full max-w-[1180px] px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          {children}
        </main>
      </div>
      <AppTabBar />
    </div>
  );
}
