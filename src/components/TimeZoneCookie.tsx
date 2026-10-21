"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Remembers the browser's time zone (cookie `os_tz`, one year) so the personal area renders
 * times in the person's zone on the server too. When the zone the server used differs (first
 * visit, travel), it stores the new one and refreshes once.
 */
export function TimeZoneCookie({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz || tz === current) return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `os_tz=${encodeURIComponent(tz)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
    // Only when the cookie took (blocked cookies would refresh forever).
    if (document.cookie.includes(`os_tz=${encodeURIComponent(tz)}`)) router.refresh();
  }, [current, router]);
  return null;
}
