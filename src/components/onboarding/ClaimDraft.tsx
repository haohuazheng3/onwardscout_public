"use client";

import { FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui-client";

/*
 * Rendered by the /app shell when a signed-in person still carries an anonymous draft cookie
 * (`os_anon`: files were dropped on /app/start in this browser before signing in). A new account
 * takes the draft at once — POST /api/drafts/claim moves the rows, clears the cookie and starts
 * matching — and the page refreshes. An account that already has a profile is asked first: the
 * draft may be someone else's on a shared computer, so it is added only with a yes, or deleted.
 * The "Save your scout" path (/app/start?claim=1) claims on its own, so it is skipped there.
 */

let started = false;

interface Pending {
  name: string | null;
  files: string[];
}

async function post(locale: string, action: "auto" | "claim" | "discard"): Promise<{ moved?: number; pending?: Pending; discarded?: boolean }> {
  const res = await fetch("/api/drafts/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale, action }),
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`claim answered ${res.status}`);
  return ((await res.json().catch(() => null)) ?? {}) as { moved?: number; pending?: Pending; discarded?: boolean };
}

export function ClaimDraft() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("onboarding.claimAsk");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<"claim" | "discard" | null>(null);

  useEffect(() => {
    if (started) return;
    const { pathname, search } = window.location;
    if (/\/app\/start\/?$/.test(pathname) && new URLSearchParams(search).get("claim") === "1") return;
    started = true;
    post(locale, "auto")
      .then((body) => {
        if (body.pending) setPending(body.pending);
        else if ((body.moved ?? 0) > 0) router.refresh();
      })
      .catch((err: unknown) => {
        started = false; // try again on the next page that renders the shell
        console.warn("[app] draft claim failed", err);
      });
  }, [locale, router]);

  if (!pending) return null;

  const decide = async (action: "claim" | "discard") => {
    setBusy(action);
    try {
      const body = await post(locale, action);
      setPending(null);
      toast.success(action === "claim" ? t("added") : t("deleted"));
      if (action === "claim" && (body.moved ?? 0) > 0) router.refresh();
    } catch (err) {
      setBusy(null);
      toast.error(t("failed"), { body: err instanceof Error ? err.message : undefined });
    }
  };

  const what = pending.name ? t("withName", { name: pending.name }) : t("withoutName");
  return (
    <section role="status" aria-live="polite" className="pane mx-auto mb-4 mt-2 w-full max-w-[1080px] min-w-0 p-5 sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--pane-3)] text-ink-2" aria-hidden>
          <FileText size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.02rem] font-semibold text-ink">{t("title")}</h2>
          <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-3">{t("body", { what })}</p>
          {pending.files.length ? <p className="mt-1 break-words text-[0.9rem] text-ink-4">{pending.files.join(" · ")}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" loading={busy === "claim"} disabled={busy !== null} onClick={() => void decide("claim")}>
              {t("add")}
            </Button>
            <Button variant="ghost" loading={busy === "discard"} disabled={busy !== null} onClick={() => void decide("discard")}>
              {t("discard")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
