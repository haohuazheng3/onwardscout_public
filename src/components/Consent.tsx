"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { isAdminPath, isSignInPath, stripLocale } from "@/lib/site";

declare global {
  interface Window {
    fw?: (...args: unknown[]) => void;
    __osAnalyticsLoaded?: boolean;
  }
}

/*
 * Region-aware consent + the FlowGlance loader (our only analytics). Visitors in the
 * EU/EEA, UK and Switzerland — or anywhere /api/geo cannot place — must opt in before
 * FlowGlance loads. Everywhere else it loads by default with a clear notice and a one-tap
 * opt-out. The choice lives 180 days in a first-party cookie and can be changed from the
 * footer ("Cookie settings") at any time.
 */

const FW_KEY = process.env.NEXT_PUBLIC_FLOWGLANCE_KEY;
const COOKIE = "os_consent";
/** Where /api/geo placed the visitor ("notice" or "optin"), so the lookup runs once per 180 days. */
const REGION_COOKIE = "os_region";
const OPEN_EVENT = "os:open-consent";
export const ANALYTICS_LOADED_EVENT = "os:analytics-loaded";

type Consent = "all" | "essential";
type Mode = "hidden" | "optin" | "notice";
type Region = "notice" | "optin";

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)os_consent=([^;]+)/);
  if (!m) return null;
  return m[1] === "essential" ? "essential" : "all";
}

/** The person opted out of analytics: nothing may be sent to FlowGlance, even if it is loaded. */
export function analyticsDeclined(): boolean {
  return readConsent() === "essential";
}

function readRegion(): Region | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)os_region=(notice|optin)(?:;|$)/);
  return m ? (m[1] as Region) : null;
}

function writeCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
}

function writeConsent(v: Consent) {
  writeCookie(COOKIE, v);
}

/**
 * Pages where nothing is recorded, whatever the consent: sign-in (one-time codes are typed
 * there), the admin area and checkout.
 */
export function analyticsExcludedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return isSignInPath(pathname) || isAdminPath(pathname) || /^\/checkout(?:\/|$)/.test(stripLocale(pathname));
}

/** Inject the FlowGlance snippet once. A no-op without NEXT_PUBLIC_FLOWGLANCE_KEY. */
export function loadFlowGlance(): void {
  if (!FW_KEY || typeof document === "undefined" || window.__osAnalyticsLoaded) return;
  window.__osAnalyticsLoaded = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://flowglance.com/fw.js";
  s.setAttribute("data-site", FW_KEY);
  s.onload = () => window.dispatchEvent(new Event(ANALYTICS_LOADED_EVENT));
  s.onerror = () => console.warn("[analytics] FlowGlance failed to load");
  document.head.appendChild(s);
}

/**
 * Fire a FlowGlance business event (`upload`, `profile_confirmed`, `goal_set`,
 * `apply_requested`, `application_submitted`, `handoff_completed`, `checkout_started`,
 * `purchase`, `unlock`). Queued until the snippet is ready; a no-op if analytics are off.
 */
export function track(name: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined" || analyticsDeclined()) return;
  const send = () => {
    try {
      window.fw?.("event", name, props ?? {});
    } catch (e) {
      console.warn("[analytics] event failed", name, e);
    }
  };
  if (window.fw) return send();
  if (!window.__osAnalyticsLoaded) return;
  window.addEventListener(ANALYTICS_LOADED_EVENT, send, { once: true });
}

/** Opens the consent panel again (footer "Cookie settings"). */
export function openConsentSettings(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function ConsentManager() {
  const t = useTranslations("common.consent");
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode>("hidden");
  /** Analytics may run (consent given, or a notice region without an opt-out); null = undecided. */
  const allowed = useRef<boolean | null>(null);
  /** Loads FlowGlance when allowed, unless the current page is one that is never recorded. */
  const loadIfAllowed = useCallback(() => {
    if (allowed.current && !analyticsExcludedPath(window.location.pathname)) loadFlowGlance();
  }, []);

  useEffect(() => {
    const existing = readConsent();
    if (existing) {
      allowed.current = existing === "all";
      loadIfAllowed();
      return;
    }
    const decide = (region: Region) => {
      allowed.current = region === "notice";
      loadIfAllowed();
      setMode(region === "notice" ? "notice" : "optin");
    };
    const known = readRegion();
    let cancelled = false;
    // Async even when the region is remembered, so the banner never renders during hydration.
    const lookup: Promise<{ consentRequired?: boolean; failed?: boolean }> = known
      ? Promise.resolve({ consentRequired: known === "optin", failed: true })
      : fetch("/api/geo")
          .then((r) => (r.ok ? r.json() : { consentRequired: true }))
          .catch((e: unknown) => {
            console.warn("[consent] geo lookup failed; asking for opt-in", e);
            return { consentRequired: true, failed: true };
          });
    void lookup.then((g) => {
      if (cancelled) return;
      const region: Region = g.consentRequired === false ? "notice" : "optin";
      if (!g.failed) writeCookie(REGION_COOKIE, region);
      decide(region);
    });
    return () => {
      cancelled = true;
    };
  }, [loadIfAllowed]);

  // Client-side navigation into a page that may be recorded loads it then (sign-in, checkout
  // and admin never are).
  useEffect(() => {
    if (pathname) loadIfAllowed();
  }, [pathname, loadIfAllowed]);

  useEffect(() => {
    const open = () => setMode(window.__osAnalyticsLoaded ? "notice" : "optin");
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const accept = useCallback(() => {
    writeConsent("all");
    allowed.current = true;
    loadIfAllowed();
    setMode("hidden");
  }, [loadIfAllowed]);

  const essentialOnly = useCallback(() => {
    writeConsent("essential");
    allowed.current = false;
    setMode("hidden");
    // FlowGlance cannot be unloaded from a running page, and in-app navigation never reloads
    // it: reload now so the opt-out takes effect at once (the reloaded page runs without it).
    if (window.__osAnalyticsLoaded) window.location.reload();
  }, []);

  if (mode === "hidden") return null;
  const optin = mode === "optin";

  return (
    <div
      className="fixed inset-x-3 z-[60] sm:inset-x-auto sm:right-5 sm:w-[400px]"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--consent-offset, 12px))" }}
      role="region"
      aria-label={t("region")}
    >
      {/* Short blocks: the panel appears after hydration and must never become the page's LCP element. */}
      <div className="pane animate-rise p-5">
        <p className="title text-[1.06rem] text-ink">{optin ? t("optInTitle") : t("noticeTitle")}</p>
        <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-3">{optin ? t("optInBody") : t("noticeBody")}</p>
        <p className="mt-1 text-[0.88rem] leading-relaxed text-ink-3">
          {optin ? t("optInDetail") : t("noticeDetail")}{" "}
          <Link href="/cookie-policy" className="link text-ink-2">
            {t("details")}
          </Link>
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary btn-sm flex-1" onClick={accept}>
            {optin ? t("accept") : t("ok")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm flex-1" onClick={essentialOnly}>
            {optin ? t("essentialOnly") : t("optOut")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer button that reopens the consent panel. */
export function CookieSettingsButton({ className = "" }: { className?: string }) {
  const t = useTranslations("common.footer");
  return (
    <button
      type="button"
      onClick={openConsentSettings}
      className={`press inline-flex min-h-[36px] items-center rounded-full px-3 text-[0.86rem] text-ink-3 underline-offset-4 hover:text-ink hover:underline ${className}`}
    >
      {t("cookieSettings")}
    </button>
  );
}
