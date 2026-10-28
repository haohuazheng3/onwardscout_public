"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/*
 * Right after onboarding the first picks are still being scored. While they are, this asks every
 * few seconds whether matching is done and reloads the dashboard's data when it is (for up to two
 * minutes; the page also says so in words, so nothing depends on this to be understood).
 */
export function PicksRefresher() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped || Date.now() - started > 120_000) return;
      try {
        const res = await fetch("/api/drafts/refresh", { cache: "no-store" });
        const body = (await res.json()) as { refresh?: { refreshing?: boolean } };
        if (!body.refresh?.refreshing) {
          router.refresh();
          return;
        }
      } catch (err) {
        console.warn("[home] refresh check failed", err);
      }
      setTimeout(tick, 3000);
    };
    const first = setTimeout(tick, 2500);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [router]);
  return null;
}
