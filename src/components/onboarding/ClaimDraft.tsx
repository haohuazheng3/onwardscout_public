"use client";

import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect } from "react";

/*
 * Rendered by the /app shell when a signed-in person still carries an anonymous draft cookie
 * (`os_anon`: they dropped files on /app/start before signing in, then signed in from anywhere).
 * Claims the draft once — POST /api/drafts/claim is idempotent, moves the rows to the person,
 * clears the cookie and starts matching — and refreshes the page when something moved.
 * The "Save your scout" path (/app/start?claim=1) claims on its own, so it is skipped there.
 */

let started = false;

export function ClaimDraft() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (started) return;
    const { pathname, search } = window.location;
    if (/\/app\/start\/?$/.test(pathname) && new URLSearchParams(search).get("claim") === "1") return;
    started = true;
    fetch("/api/drafts/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`claim answered ${res.status}`);
        const body = (await res.json().catch(() => null)) as { moved?: number } | null;
        if ((body?.moved ?? 0) > 0) router.refresh();
      })
      .catch((err: unknown) => {
        started = false; // try again on the next page that renders the shell
        console.warn("[app] draft claim failed", err);
      });
  }, [locale, router]);

  return null;
}
