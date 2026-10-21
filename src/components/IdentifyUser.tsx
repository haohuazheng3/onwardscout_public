"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { ANALYTICS_LOADED_EVENT } from "./Consent";
import { useHydrated } from "./use-hydrated";

const SESSION_KEY = "os_identified";

/**
 * Ties FlowGlance sessions to the signed-in person (Clerk user id as `userRef` + email), so a
 * support conversation can be matched to what they actually saw. Runs after hydration,
 * once per browser session and user, and only once the analytics snippet is loaded — a
 * no-op while consent is withheld.
 */
export function IdentifyUser() {
  const hydrated = useHydrated();
  const { user, isSignedIn, isLoaded } = useUser();
  const userRef = user?.id ?? null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  useEffect(() => {
    if (!hydrated || !isLoaded || !isSignedIn || !userRef) return;

    let done = false;
    try {
      done = sessionStorage.getItem(SESSION_KEY) === userRef;
    } catch {
      /* storage unavailable: identify once per page view instead */
    }
    if (done) return;

    const send = () => {
      if (!window.fw) return;
      try {
        window.fw("identify", { userRef, email });
        try {
          sessionStorage.setItem(SESSION_KEY, userRef);
        } catch {
          /* storage unavailable: harmless, we may identify again next page */
        }
      } catch (e) {
        console.warn("[analytics] identify failed", e);
      }
    };

    if (window.fw) {
      send();
      return;
    }
    window.addEventListener(ANALYTICS_LOADED_EVENT, send, { once: true });
    return () => window.removeEventListener(ANALYTICS_LOADED_EVENT, send);
  }, [hydrated, isLoaded, isSignedIn, userRef, email]);

  return null;
}
