"use client";

import { ArrowRight, ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { LocaleList, LocaleSwitcher } from "./LocaleSwitcher";
import { LogoLink } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

/*
 * The public header: one floating glass pill. It renders in (site) without Clerk, so it
 * never asks who is signed in: "Sign in" goes to /sign-in and "Start free" to /app/start;
 * the proxy sends a signed-out visitor from /app/start to /sign-in and back afterwards.
 */

type NavItem = { href: string; key: "howItWorks" | "opportunities" | "pricing" | "blog"; englishOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/opportunities", key: "opportunities", englishOnly: true },
  { href: "/pricing", key: "pricing" },
  { href: "/blog", key: "blog", englishOnly: true },
];

const MOBILE_EXTRA = [
  { href: "/faq", key: "faq" },
  { href: "/about", key: "about" },
  { href: "/contact", key: "contact" },
] as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
}

function ForMenu() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const active = pathname.startsWith("/for/");

  // Close on navigation (adjusting state during render, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "press inline-flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-full px-3 text-[0.94rem] font-medium transition-colors xl:px-3.5",
          open || active ? "bg-pane-2 text-ink" : "text-ink-3 hover:text-ink",
        )}
      >
        {t("nav.forShort")}
        <ChevronDown size={15} className={cx("transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="pane animate-pop absolute left-1/2 top-[calc(100%+12px)] z-50 w-[560px] -translate-x-1/2 p-2.5">
          <ul className="grid grid-cols-2 gap-1">
            {AUDIENCES.map((a) => {
              const k = audienceKey(a);
              return (
                <li key={a}>
                  <Link
                    href={`/for/${a}`}
                    onClick={() => setOpen(false)}
                    className="press group flex h-full flex-col rounded-[18px] px-4 py-3 transition-colors hover:bg-pane-2"
                  >
                    <span className="flex items-center justify-between gap-2 text-[0.96rem] font-semibold text-ink">
                      {t(`audiences.${k}`)}
                      <ArrowRight size={15} className="text-ink-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <span className="mt-0.5 text-[0.84rem] leading-snug text-ink-3">{t(`audiences.${k}Blurb`)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const isActive = useIsActive();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const root = document.documentElement;
      const prev = root.style.overflow;
      root.style.overflow = "hidden";
      return () => {
        root.style.overflow = prev;
      };
    }
    if (!open && d.open) d.close();
  }, [open]);

  const row = (href: string, label: string, englishOnly = false) => (
    <Link
      key={href}
      href={href}
      locale={englishOnly ? "en" : undefined}
      onClick={onClose}
      aria-current={isActive(href) ? "page" : undefined}
      className={cx(
        "press flex min-h-[54px] items-center justify-between gap-3 rounded-[18px] px-4 text-[1.06rem] font-medium",
        isActive(href) ? "bg-pane-2 text-ink" : "text-ink-2 active:bg-pane-2",
      )}
    >
      <span className="flex items-center gap-2">
        {label}
        {englishOnly && locale !== "en" ? <span className="tag min-h-[20px] px-2 text-[0.68rem]">{t("nav.englishOnly")}</span> : null}
      </span>
      <ArrowRight size={17} className="text-ink-4" aria-hidden />
    </Link>
  );

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={t("nav.menu")}
      className="fixed inset-x-0 top-0 bottom-auto m-0 h-auto max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--scrim)] backdrop:backdrop-blur-[6px] lg:hidden"
    >
      {open ? (
        <div className="safe-x pt-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
          <div className="pane animate-rise max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain p-3">
            <div className="flex items-center justify-between pb-1 pl-1">
              <LogoLink />
              <button
                type="button"
                onClick={onClose}
                className="btn btn-quiet btn-icon"
                aria-label={t("a11y.closeMenu")}
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <nav aria-label={t("a11y.mobileNav")} className="mt-1 flex flex-col">
              {row("/", t("nav.home"))}
              {NAV.map((n) => row(n.href, t(`nav.${n.key}`), n.englishOnly))}
              {MOBILE_EXTRA.map((n) => row(n.href, t(`nav.${n.key}`)))}
            </nav>
            <div className="mt-3 px-1">
              <p className="eyebrow mb-2">{t("nav.for")}</p>
              <div className="grid grid-cols-2 gap-2">
                {AUDIENCES.map((a) => (
                  <Link
                    key={a}
                    href={`/for/${a}`}
                    onClick={onClose}
                    className="press flex min-h-[48px] items-center rounded-[16px] bg-pane-2 px-3.5 text-[0.93rem] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    {t(`audiences.${audienceKey(a)}`)}
                  </Link>
                ))}
              </div>
            </div>
            <LocaleList className="mt-4 px-1" />
            <div className="mt-4 flex justify-center">
              <ThemeToggle />
            </div>
            {/* The two actions stay in reach while the menu scrolls. */}
            <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 grid grid-cols-2 gap-2 rounded-b-[var(--radius-pane)] bg-pane px-4 pb-4 pt-3 shadow-[0_-12px_24px_-16px_rgba(18,22,20,0.25)]">
              <Link href="/sign-in" prefetch={false} onClick={onClose} className="btn btn-ghost btn-block">
                {t("nav.signIn")}
              </Link>
              <Link href="/app/start" prefetch={false} onClick={onClose} className="btn btn-primary btn-block">
                {t("nav.startFree")}
                <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

export function Header() {
  const t = useTranslations("common");
  const pathname = usePathname();
  const isActive = useIsActive();
  const [open, setOpen] = useState(false);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <header className="safe-x sticky top-0 z-40 sm:px-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
      <div className="pane-glass mx-auto flex h-[60px] max-w-[1180px] items-center justify-between gap-2 rounded-full pl-3 pr-2 sm:h-[64px] sm:pl-5">
        <LogoLink />

        <nav aria-label={t("a11y.mainNav")} className="hidden items-center gap-0.5 lg:flex">
          {NAV.slice(0, 3).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              locale={n.englishOnly ? "en" : undefined}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={cx(
                "press inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3 text-[0.94rem] font-medium transition-colors xl:px-3.5",
                isActive(n.href) ? "bg-pane-2 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {t(`nav.${n.key}`)}
            </Link>
          ))}
          <ForMenu />
          {NAV.slice(3).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              locale={n.englishOnly ? "en" : undefined}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={cx(
                "press inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3 text-[0.94rem] font-medium transition-colors xl:px-3.5",
                isActive(n.href) ? "bg-pane-2 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {t(`nav.${n.key}`)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <LocaleSwitcher size="sm" className="hidden md:inline-flex lg:hidden xl:inline-flex" />
          <Link
            href="/sign-in"
            prefetch={false}
            className="press hidden min-h-[40px] items-center whitespace-nowrap rounded-full px-3.5 text-[0.94rem] font-medium text-ink-2 transition-colors hover:text-ink sm:inline-flex"
          >
            {t("nav.signIn")}
          </Link>
          <Link href="/app/start" prefetch={false} className="btn btn-primary btn-sm">
            {t("nav.startFree")}
            <ArrowUpRight size={16} className="hidden sm:block" aria-hidden />
          </Link>
          <button
            type="button"
            className="btn btn-quiet btn-icon btn-sm lg:hidden"
            aria-label={t("a11y.openMenu")}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} aria-hidden />
          </button>
        </div>
      </div>
      <MobileMenu open={open} onClose={() => setOpen(false)} />
    </header>
  );
}

/**
 * The slim header for pages outside the public site and the signed-in shell (sign-in,
 * checkout): the logo home, the language switcher and a way back to the website.
 */
export function SlimHeader() {
  const t = useTranslations("common");
  return (
    <header className="safe-x relative z-30 sm:px-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
      <div className="mx-auto flex h-[60px] max-w-[1180px] items-center justify-between gap-2">
        <LogoLink />
        <div className="flex items-center gap-1.5">
          <LocaleSwitcher size="sm" />
          <Link
            href="/"
            className="press hidden min-h-[40px] items-center rounded-full px-3.5 text-[0.9rem] font-medium text-ink-3 hover:text-ink sm:inline-flex"
          >
            {t("buttons.backToSite")}
          </Link>
        </div>
      </div>
    </header>
  );
}
