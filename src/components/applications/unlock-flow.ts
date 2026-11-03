"use client";

import { track } from "@/components/Consent";
import { withinAttempt } from "@/components/billing/checkout-flow";
import { SINGLE } from "@/content/plans";
import { call, RequestError, type CallMessages } from "./api";

/*
 * The client half of unlocking one application for $19: POST /api/drafts/unlock {method: "pay"}
 * and off to Stripe. One attempt (its nonce) is reused for 20 minutes, so a double tap or a
 * refresh lands on the same Stripe page instead of opening a second session. Shared by the
 * signed-out apply page and the signed-in room.
 */

const nonceKey = (applicationId: string) => `os_unlock_nonce:${applicationId}`;

function attemptNonce(applicationId: string): string {
  try {
    const raw = sessionStorage.getItem(nonceKey(applicationId));
    if (raw) {
      const parsed = JSON.parse(raw) as { value?: unknown; at?: unknown };
      if (typeof parsed.value === "string" && withinAttempt(parsed.at)) return parsed.value;
    }
  } catch {
    /* storage unavailable: a fresh nonce each time; the server still dedupes within the attempt */
  }
  const value = crypto.randomUUID();
  try {
    sessionStorage.setItem(nonceKey(applicationId), JSON.stringify({ value, at: Date.now() }));
  } catch (e) {
    console.warn("[unlock] session storage unavailable", e);
  }
  return value;
}

/** Forget the attempt (the server said it went stale): the next press mints a new one. */
export function forgetUnlockAttempt(applicationId: string): void {
  try {
    sessionStorage.removeItem(nonceKey(applicationId));
  } catch {
    /* nothing kept */
  }
}

/**
 * Opens Stripe Checkout for this application. Resolves only when the request failed (the
 * browser leaves the page on success); throws RequestError with the server's sentence.
 */
export async function startUnlockCheckout(applicationId: string, locale: "en" | "zh", messages: CallMessages): Promise<void> {
  const nonce = attemptNonce(applicationId);
  try {
    const r = await call<{ url: string }>("/api/drafts/unlock", { json: { method: "pay", applicationId, nonce, locale } }, messages);
    if (!r.url.startsWith("https://checkout.stripe.com/")) throw new RequestError(messages.generic, 500);
    track("checkout_started", { sku: "single", priceUsd: SINGLE.priceUsd, interval: "once", applicationId });
    window.location.assign(r.url);
  } catch (err) {
    if (err instanceof RequestError && err.data?.code === "stale") forgetUnlockAttempt(applicationId);
    throw err;
  }
}
