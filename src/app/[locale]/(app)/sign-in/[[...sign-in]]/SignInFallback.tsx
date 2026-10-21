"use client";

import { ClerkFailed } from "@clerk/nextjs";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

/** Shown inside the sign-in card only if Clerk's script fails to load (network, blocker, outage). */
export function SignInFallback() {
  const t = useTranslations("common.auth");
  return (
    <ClerkFailed>
      <div role="alert">
        <p className="title text-[1.3rem] text-ink">{t("failedTitle")}</p>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-3">{t("failedBody")}</p>
        <Button className="mt-6" block icon={<RotateCcw size={17} aria-hidden />} onClick={() => window.location.reload()}>
          {t("failedRetry")}
        </Button>
      </div>
    </ClerkFailed>
  );
}
