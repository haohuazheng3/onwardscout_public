"use client";

import { useEffect } from "react";
import { ANALYTICS_LOADED_EVENT, track } from "@/components/Consent";
import { isSku } from "@/content/plans";
import { forgetCheckout } from "./CheckoutButton";

/**
 * Fires the FlowGlance `purchase` event once per Checkout Session (deduped across reloads through
 * localStorage) and ends the finished attempt, so the next purchase of the same offer mints a
 * fresh nonce instead of reopening this session. Renders nothing. `amount` is in cents.
 */
export function PurchaseEvents({ sessionId, sku, amount, currency }: { sessionId: string; sku: string; amount: number; currency: string }) {
  useEffect(() => {
    if (isSku(sku)) forgetCheckout(sku);
    const key = `os_purchase_${sessionId}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch (e) {
      // Private mode or blocked storage: at worst the event fires twice and FlowGlance dedupes on id.
      console.warn("[analytics] purchase dedupe unavailable", e);
    }
    const send = () => {
      track("purchase", { amount: amount / 100, currency: currency.toUpperCase(), item: sku, id: sessionId });
      try {
        localStorage.setItem(key, "1");
      } catch (e) {
        console.warn("[analytics] purchase dedupe not stored", e);
      }
    };
    // FlowGlance loads after consent (and the geo lookup): send now if it is there, else when it arrives.
    if (window.fw) {
      send();
      return;
    }
    window.addEventListener(ANALYTICS_LOADED_EVENT, send, { once: true });
    return () => window.removeEventListener(ANALYTICS_LOADED_EVENT, send);
  }, [sessionId, sku, amount, currency]);
  return null;
}
