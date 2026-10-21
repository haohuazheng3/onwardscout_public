"use client";

import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/components/Consent";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/components/onboarding/api";

/**
 * "Try a practice application": the whole flow end to end against our own sandbox form —
 * free, nothing leaves Onward Scout. Shown until the person has an application.
 */
export function PracticePane() {
  const t = useTranslations("profile.home.practice");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    track("apply_requested", { practice: true, from: "home" });
    try {
      const res = await api<{ applicationId: string }>("/api/applications", { method: "POST", json: { practice: true } }, { network: tc("errors.network"), generic: tc("errors.generic") });
      router.push(`/app/applications/${res.applicationId}`);
    } catch (err) {
      setPending(false);
      toast.error(t("failed"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <section className="pane min-w-0 p-5 sm:p-6" aria-labelledby="practice-title">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-text">
          <FlaskConical size={17} aria-hidden />
        </span>
        <h2 id="practice-title" className="title text-[1.15rem] text-ink">
          {t("title")}
        </h2>
      </div>
      <p className="mt-3 text-[0.93rem] leading-relaxed text-ink-3">{t("body")}</p>
      <Button className="mt-4" variant="ink" onClick={() => void start()} loading={pending} block>
        {t("cta")}
      </Button>
      <p className="mt-2 text-center text-[0.8rem] text-ink-4">{t("free")}</p>
    </section>
  );
}
