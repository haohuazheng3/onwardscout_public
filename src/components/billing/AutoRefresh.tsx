"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";

/** Re-renders the server page every `seconds`, at most `max` times (while a payment clears). Renders nothing. */
export function AutoRefresh({ seconds, max }: { seconds: number; max: number }) {
  const router = useRouter();
  const count = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      count.current += 1;
      if (count.current > max) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds, max]);
  return null;
}
