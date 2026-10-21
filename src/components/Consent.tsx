"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";

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
const OPEN_EVENT = "os:open-consent";
export const ANALYTICS_LOADED_EVENT = "os:analytics-loaded";

type Consent = "all" | "essential";
type Mode = "hidden" | "optin" | "notice";

function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)os_consent=([^;]+)/);
  if (!m) return null;
  return m[1] === "essential" ? "essential" : "all";
}

function writeConsent(v: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
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
  if (typeof window === "undefined") return;
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
  const [mode, setMode] = useState<Mode>("hidden");

  useEffect(() => {
    const existing = readConsent();
    if (existing === "all") {
      loadFlowGlance();
      return;
    }
    if (existing === "essential") return;
    let cancelled = false;
    fetch("/api/geo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { consentRequired: true }))
      .catch((e: unknown) => {
        console.warn("[consent] geo lookup failed; asking for opt-in", e);
        return { consentRequired: true };
      })
      .then((g: { consentRequired?: boolean }) => {
        if (cancelled) return;
        if (g.consentRequired === false) {
          loadFlowGlance();
          setMode("notice");
        } else {
          setMode("optin");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const open = () => setMode(window.__osAnalyticsLoaded ? "notice" : "optin");
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const accept = useCallback(() => {
    writeConsent("all");
    loadFlowGlance();
    setMode("hidden");
  }, []);

  const essentialOnly = useCallback(() => {
    writeConsent("essential");
    setMode("hidden");
    // FlowGlance cannot be unloaded from a running page; the next page load runs without it.
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
