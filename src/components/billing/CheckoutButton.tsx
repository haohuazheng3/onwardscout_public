"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { track } from "@/components/Consent";
import { Button, Callout, Pane, Spinner, type ButtonSize } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { formatPrice, isSku, OFFERS, offerName, SKUS, type Locale, type Sku } from "@/content/plans";
import {
  checkoutErrorKey,
  fromForPath,
  isStripeCheckoutUrl,
  signInHrefFor,
  withinAttempt,
  type CheckoutErrorKey,
  type CheckoutFrom,
} from "./checkout-flow";

/*
 * The one way to open Stripe Checkout, shared by the pricing page (P5a) and /app/billing.
 *
 *  - A press flips the button to its pending state before any network call; the POST to
 *    /api/checkout {sku, nonce} then sends the browser to Stripe. Failures roll back with a toast.
 *  - The nonce is the server's idempotency key: a refresh or a double tap within 20 minutes reuses
 *    the same attempt (and the Stripe page it produced) instead of opening a second session.
 *  - 401 (guest): the tab remembers the choice and goes to the localized sign-in with
 *    redirect_url=/pricing?buy=<sku>; back on that page the purchase resumes once on its own
 *    (`usePurchaseResume` / `<ResumePurchase />`). Only a page load this very tab marked before
 *    leaving resumes by itself: a pasted ?buy= link asks first.
 *  - All buttons on a page share one state, so only one checkout opens at a time.
 *
 * Copy comes from the `billing` namespace. On (site) pages, where client components only get
 * `common`, wrap the pricing CTAs in <BillingIntl> (./BillingIntl) for the full wording; without
 * it the buttons still work and fall back to the catalog names and `common` messages.
 */

/* ------------------------------------------------------------------ shared state */

type Phase = "opening" | "redirecting" | "signing-in";

interface CheckoutSnapshot {
  pending: Sku | null;
  phase: Phase | null;
}

const IDLE: CheckoutSnapshot = { pending: null, phase: null };
let snapshot: CheckoutSnapshot = IDLE;
const listeners = new Set<() => void>();

function setSnapshot(next: CheckoutSnapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Which offer is opening right now (any button, any component). */
export function useCheckoutStatus(): CheckoutSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => IDLE);
}

/** Back to idle (bfcache restore after visiting Stripe, or a cancelled navigation). */
export function resetCheckout(): void {
  setSnapshot(IDLE);
}

/* ------------------------------------------------------------------ the attempt in sessionStorage */

/** Fired on this window when an attempt is stashed or forgotten, so buttons re-read storage. */
const CHANGE_EVENT = "os:checkout";

function announce(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (e) {
    console.warn("[checkout] change event failed", e);
  }
}

function subscribeStorage(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const nonceKey = (sku: Sku) => `os_checkout_nonce:${sku}`;
const urlKey = (sku: Sku) => `os_checkout_url:${sku}`;
const resumeKey = (sku: Sku) => `os_checkout_resume:${sku}`;

function readStamped(key: string): { value: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown; at?: unknown };
    if (typeof parsed.value !== "string" || !withinAttempt(parsed.at)) return null;
    return { value: parsed.value, at: parsed.at as number };
  } catch {
    return null;
  }
}

function writeStamped(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, at: Date.now() }));
  } catch (e) {
    // Private mode or quota: the attempt is simply not reusable across a refresh (the server dedupes by nonce).
    console.warn("[checkout] session storage unavailable", e);
  }
}

function attemptNonce(sku: Sku): string {
  const kept = readStamped(nonceKey(sku));
  if (kept) return kept.value;
  const value = crypto.randomUUID();
  writeStamped(nonceKey(sku), value);
  return value;
}

function stashedUrl(sku: Sku): string | null {
  const kept = readStamped(urlKey(sku));
  return kept && isStripeCheckoutUrl(kept.value) ? kept.value : null;
}

function markResume(sku: Sku): void {
  writeStamped(resumeKey(sku), "1");
}

/** True once when this tab marked a resume for the offer within the attempt window; the mark is consumed. */
function takeResumeMark(sku: Sku): boolean {
  const kept = readStamped(resumeKey(sku));
  try {
    sessionStorage.removeItem(resumeKey(sku));
  } catch {
    /* storage unavailable: nothing was kept */
  }
  return kept !== null;
}

/** Ends the attempt for an offer: the next press mints a fresh nonce and a fresh Stripe session. */
export function forgetCheckout(sku: Sku): void {
  try {
    sessionStorage.removeItem(nonceKey(sku));
    sessionStorage.removeItem(urlKey(sku));
    sessionStorage.removeItem(resumeKey(sku));
  } catch {
    /* storage unavailable: nothing was kept */
  }
  announce();
}

/* ------------------------------------------------------------------ copy */

type Values = Record<string, string | number>;

/** billing.* when the namespace is loaded, else the given fallback (catalog names, `common` messages). */
function useBillingCopy() {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  return useMemo(() => {
    const has = (key: string) => {
      try {
        return t.has(key);
      } catch {
        return false;
      }
    };
    return {
      /** The billing namespace is loaded (always in the app; on site pages only inside <BillingIntl>). */
      ready: has("checkout.opening"),
      text: (key: string, fallback: string, values?: Values) => (has(key) ? t(key, values) : fallback),
      common: (key: string) => tc(key),
    };
  }, [t, tc]);
}

type Copy = ReturnType<typeof useBillingCopy>;

function defaultLabel(copy: Copy, sku: Sku, locale: Locale): string {
  const offer = OFFERS[sku];
  const name = offerName(sku, locale);
  const price = formatPrice(offer.priceUsd);
  return offer.interval === "month"
    ? copy.text("checkout.labelPlan", `${name} · ${price}`, { name, price })
    : copy.text("checkout.labelPack", `${name} · ${price}`, { name, price });
}

function phaseLabel(copy: Copy, phase: Phase | null): string {
  if (phase === "redirecting") return copy.text("checkout.redirecting", copy.common("status.loading"));
  if (phase === "signing-in") return copy.text("checkout.signingIn", copy.common("status.loading"));
  return copy.text("checkout.opening", copy.common("status.working"));
}

function errorMessage(copy: Copy, key: CheckoutErrorKey, server?: string): string {
  const fallback =
    key === "network" ? copy.common("errors.network") : key === "rate_limited" ? copy.common("errors.rateLimited") : (server ?? copy.common("errors.generic"));
  return copy.text(`checkout.errors.${key}`, fallback);
}

/* ------------------------------------------------------------------ starting a checkout */

interface RunContext {
  locale: Locale;
  from: CheckoutFrom;
  onError: (key: CheckoutErrorKey, serverMessage: string | undefined, portal: boolean) => void;
}

async function runCheckout(sku: Sku, ctx: RunContext): Promise<void> {
  if (snapshot.pending) return; // one checkout at a time, whichever button was pressed
  setSnapshot({ pending: sku, phase: "opening" }); // before the network, always

  const stashed = stashedUrl(sku);
  if (stashed) {
    setSnapshot({ pending: sku, phase: "redirecting" });
    window.location.assign(stashed);
    return;
  }

  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sku, nonce: attemptNonce(sku), locale: ctx.locale, from: ctx.from }),
    });
    if (res.status === 401) {
      markResume(sku);
      setSnapshot({ pending: sku, phase: "signing-in" });
      window.location.assign(signInHrefFor(ctx.locale, sku, ctx.from));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { url?: unknown; error?: string; code?: string; portal?: boolean; stale?: boolean };
    if (!res.ok || !isStripeCheckoutUrl(body.url)) {
      if (body.stale) forgetCheckout(sku);
      setSnapshot(IDLE);
      ctx.onError(checkoutErrorKey(res.status, body.code), body.error, body.portal === true);
      return;
    }
    writeStamped(urlKey(sku), body.url);
    announce();
    track("checkout_started", { sku, priceUsd: OFFERS[sku].priceUsd, interval: OFFERS[sku].interval ?? "once" });
    setSnapshot({ pending: sku, phase: "redirecting" });
    window.location.assign(body.url);
  } catch (e) {
    console.warn("[checkout] start failed", e);
    setSnapshot(IDLE);
    ctx.onError("network", undefined, false);
  }
}

/** `start(sku)` with this component's locale, copy and toasts. */
function useStartCheckout(from?: CheckoutFrom): (sku: Sku) => Promise<void> {
  const locale = useLocale() as Locale;
  const copy = useBillingCopy();
  const router = useRouter();
  return useCallback(
    (sku: Sku) =>
      runCheckout(sku, {
        locale,
        from: from ?? fromForPath(window.location.pathname),
        onError: (key, server, portal) => {
          toast.error(copy.text("checkout.errorTitle", copy.common("errors.generic")), {
            body: errorMessage(copy, key, server),
            action: portal ? { label: copy.text("checkout.openBilling", copy.common("appNav.billing")), onClick: () => router.push("/app/billing") } : undefined,
          });
        },
      }),
    [locale, copy, router, from],
  );
}

/* ------------------------------------------------------------------ resume after sign-in */

export interface ResumeIntent {
  sku: Sku;
  /** This tab asked for the resume before leaving for sign-in (else it was a pasted link). */
  marked: boolean;
  status: "new" | "started" | "dismissed";
}

let intent: ResumeIntent | null = null;
const intentListeners = new Set<() => void>();

function setIntent(next: ResumeIntent | null): void {
  intent = next;
  for (const l of intentListeners) l();
}

function subscribeIntent(cb: () => void): () => void {
  intentListeners.add(cb);
  return () => {
    intentListeners.delete(cb);
  };
}

/** Reads `?buy=<sku>` once, removes it from the address bar and remembers whether this tab marked it. */
function captureIntent(): void {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  const buy = url.searchParams.get("buy");
  if (!isSku(buy)) return;
  url.searchParams.delete("buy");
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (e) {
    console.warn("[checkout] could not clean the address bar", e);
  }
  setIntent({ sku: buy, marked: takeResumeMark(buy), status: "new" });
}

/**
 * Resume a purchase after sign-in. Place it (or `<ResumePurchase />`) on any page a buy button
 * returns to (`/pricing`, `/app/billing`). When the page was loaded with `?buy=<sku>` that this
 * tab marked before signing in, checkout starts once on its own; a `?buy=` link from elsewhere
 * waits for a press (`intent.marked === false`). Every CheckoutButton runs it too, so a page with
 * buttons resumes even without the component.
 */
export function usePurchaseResume(): { intent: ResumeIntent | null; dismiss: () => void } {
  const current = useSyncExternalStore(subscribeIntent, () => intent, () => null);
  const start = useStartCheckout();

  useEffect(() => {
    captureIntent();
  }, []);

  useEffect(() => {
    if (!current || current.status !== "new" || !current.marked) return;
    const timer = window.setTimeout(() => {
      if (!intent || intent.status !== "new" || !intent.marked) return;
      setIntent({ ...intent, status: "started" });
      void start(current.sku);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [current, start]);

  const dismiss = useCallback(() => {
    if (intent) setIntent({ ...intent, status: "dismissed" });
  }, []);

  return { intent: current, dismiss };
}

/** Back from Stripe with the browser's Back button: the page comes from bfcache still "redirecting". */
function useBfcacheReset(): void {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) resetCheckout();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
}

/* ------------------------------------------------------------------ components */

export interface CheckoutButtonProps {
  sku: Sku;
  className?: string;
  /** The idle label; defaults to "Get Pro · $29/month" / "Buy 10 credits · $9". */
  children?: ReactNode;
  variant?: "primary" | "ghost" | "ink";
  size?: ButtonSize;
  block?: boolean;
  /** The page the button is on (Stripe's back link and the sign-in round trip return there). Default: from the URL. */
  from?: CheckoutFrom;
}

/** A buy button with instant pressed state. Signed-out → sign-in and back; signed-in → Stripe Checkout. */
export function CheckoutButton({ sku, className, children, variant = "primary", size = "lg", block = false, from }: CheckoutButtonProps) {
  const locale = useLocale() as Locale;
  const copy = useBillingCopy();
  const status = useCheckoutStatus();
  const start = useStartCheckout(from);
  usePurchaseResume();
  useBfcacheReset();
  // An attempt from the last 20 minutes still has its Stripe page: say so instead of pretending to start over.
  const resumable = useSyncExternalStore(subscribeStorage, () => stashedUrl(sku) !== null, () => false);

  const busy = status.pending === sku;
  const otherBusy = status.pending !== null && !busy;
  const idle = children ?? (resumable ? copy.text("checkout.resume", defaultLabel(copy, sku, locale)) : defaultLabel(copy, sku, locale));

  return (
    <Button
      variant={variant}
      size={size}
      block={block}
      className={className}
      loading={busy}
      aria-disabled={otherBusy || undefined}
      aria-live="polite"
      data-sku={sku}
      onClick={() => {
        if (otherBusy) return;
        void start(sku);
      }}
    >
      {busy ? phaseLabel(copy, status.phase) : idle}
    </Button>
  );
}

/**
 * The visible half of the resume: "Picking up where you left off…" while checkout opens on its
 * own after sign-in, or a one-tap prompt when the page was opened from a `?buy=` link. Renders
 * nothing otherwise. Put it near the top of the pricing page.
 */
export function ResumePurchase({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const copy = useBillingCopy();
  const status = useCheckoutStatus();
  const { intent: current, dismiss } = usePurchaseResume();
  if (!current || current.status === "dismissed") return null;
  const name = offerName(current.sku, locale);

  if (current.marked) {
    if (status.pending !== current.sku) return null;
    return (
      <Pane className={className} pad="sm" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <Spinner />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{copy.text("checkout.resumingTitle", phaseLabel(copy, status.phase))}</p>
            <p className="mt-0.5 text-[0.92rem] text-ink-3">{copy.text("checkout.resumingBody", name, { name })}</p>
          </div>
        </div>
      </Pane>
    );
  }

  return (
    <Pane className={className} pad="sm" role="region" aria-label={copy.text("checkout.promptTitle", name)}>
      <p className="font-semibold text-ink">{copy.text("checkout.promptTitle", name)}</p>
      <p className="mt-1 text-[0.94rem] leading-relaxed text-ink-3">{copy.text("checkout.promptBody", name, { name })}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <CheckoutButton sku={current.sku} size="md" />
        <Button variant="quiet" size="md" onClick={dismiss}>
          {copy.text("checkout.notNow", copy.common("buttons.cancel"))}
        </Button>
      </div>
    </Pane>
  );
}

/* ------------------------------------------------------------------ cancelled checkout notice */

let cancelledNotice = false;
const noticeListeners = new Set<() => void>();

function setCancelledNotice(v: boolean): void {
  cancelledNotice = v;
  for (const l of noticeListeners) l();
}

function subscribeNotice(cb: () => void): () => void {
  noticeListeners.add(cb);
  return () => {
    noticeListeners.delete(cb);
  };
}

/** Reads `?checkout=cancelled` once and removes it from the address bar. */
function captureCancelled(): void {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  if (url.searchParams.get("checkout") !== "cancelled") return;
  url.searchParams.delete("checkout");
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (e) {
    console.warn("[checkout] could not clean the address bar", e);
  }
  resetCheckout();
  setCancelledNotice(true);
}

/**
 * Feedback after Stripe sends someone back without paying (`?checkout=cancelled`): nothing was
 * charged, the attempt is kept for 20 minutes, and "Start over" forgets it. Reads the query on the
 * client, so it works on static pages. Needs the `billing` messages (renders nothing without them).
 */
export function CheckoutNotice({ className }: { className?: string }) {
  const copy = useBillingCopy();
  const visible = useSyncExternalStore(subscribeNotice, () => cancelledNotice, () => false);

  useEffect(() => {
    captureCancelled();
  }, []);

  if (!visible || !copy.ready) return null;
  const startOver = () => {
    for (const sku of SKUS) forgetCheckout(sku);
    setCancelledNotice(false);
  };
  return (
    <Callout
      tone="info"
      className={className}
      title={copy.text("checkout.cancelledTitle", "")}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="quiet" size="sm" onClick={startOver}>
            {copy.text("checkout.startOver", copy.common("buttons.retry"))}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setCancelledNotice(false)}>
            {copy.common("buttons.close")}
          </Button>
        </div>
      }
    >
      {copy.text("checkout.cancelledBody", "")}
    </Callout>
  );
}
