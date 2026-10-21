"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/components/Consent";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/components/onboarding/api";

/** "Looks right": marks the profile confirmed (a new version), at once. */
export function ConfirmProfileButton({ locale }: { locale: "en" | "zh" }) {
  const t = useTranslations("profile.page");
  const tc = useTranslations("common");
  const router = useRouter();
  const [done, setDone] = useState(false);
  async function confirm() {
    setDone(true);
    try {
      await api("/api/profile", { method: "PATCH", json: { patch: { op: "confirm" }, locale } }, { network: tc("errors.network"), generic: tc("errors.generic") });
      track("profile_confirmed", { from: "profile" });
      router.refresh();
    } catch (err) {
      setDone(false);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }
  return (
    <Button size="sm" variant={done ? "ghost" : "primary"} icon={<Check size={16} aria-hidden />} onClick={() => void confirm()} disabled={done}>
      {done ? t("confirmed") : t("looksRight")}
    </Button>
  );
}
