"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui-client";

/*
 * For a visitor who never signed in: delete everything this browser started (a shared computer,
 * a change of mind). Two taps, confirmed in place (no browser dialog); then a fresh start.
 */
export function DiscardDraft() {
  const t = useTranslations("profile.home.discard");
  const tc = useTranslations("common");
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");

  async function discard() {
    setStep("busy");
    try {
      const res = await fetch("/api/drafts/discard", { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || tc("errors.generic"));
      }
      toast.success(t("done"));
      window.location.assign(window.location.pathname.startsWith("/zh") ? "/zh/app/start" : "/app/start");
    } catch (err) {
      setStep("confirm");
      toast.error(t("failed"), { body: err instanceof Error ? err.message : tc("errors.generic") });
    }
  }

  if (step === "idle") {
    return (
      <Button variant="quiet" size="sm" icon={<Trash2 size={15} aria-hidden />} onClick={() => setStep("confirm")}>
        {t("cta")}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("confirmLabel")}>
      <span className="text-[0.86rem] text-ink-2">{t("confirm")}</span>
      <Button variant="ghost" size="sm" loading={step === "busy"} onClick={() => void discard()}>
        {t("yes")}
      </Button>
      <Button variant="quiet" size="sm" disabled={step === "busy"} onClick={() => setStep("idle")}>
        {t("no")}
      </Button>
    </div>
  );
}
