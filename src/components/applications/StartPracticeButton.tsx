"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/components/Consent";
import { Button, type ButtonVariant } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { call } from "./api";

/** Starts a free practice application against the sandbox form and opens its room at once. */
export function StartPracticeButton({ variant = "ghost", className }: { variant?: ButtonVariant; className?: string }) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      className={className}
      icon={<Play size={16} aria-hidden />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await call<{ applicationId: string }>("/api/applications", { json: { practice: true } }, { network: tc("errors.network"), generic: tc("errors.generic") });
          track("apply_requested", { practice: true });
          router.push(`/app/applications/${r.applicationId}`);
        } catch (err) {
          setBusy(false);
          toast.error(t("toasts.practiceFailed"), { body: err instanceof Error ? err.message : undefined });
        }
      }}
    >
      {busy ? t("board.practiceStarting") : t("board.practice")}
    </Button>
  );
}
