"use client";

import { ArrowRight, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/components/Consent";
import { Button, ButtonLink, type ButtonSize } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { signInPath, withLocale } from "@/lib/site";

/**
 * "Apply for me": pressed state at once, POST /api/applications, then straight to the
 * application page (its skeleton renders while it loads). Failure rolls back with a toast;
 * when credits run out the toast offers the billing page. An existing application opens instead.
 * A visitor without an account (the dashboard works signed out) is taken to save their scout
 * with their email first; back on the dashboard the draft is claimed and they apply from there.
 */
export function ApplyButton({
  opportunityId,
  type,
  channel,
  goalId,
  applicationId,
  practice = false,
  size = "md",
  block = false,
  className,
  onStarted,
}: {
  opportunityId: string;
  type: string;
  channel: string;
  goalId?: string | null;
  applicationId?: string | null;
  practice?: boolean;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  onStarted?: (applicationId: string) => void;
}) {
  const t = useTranslations("scout.apply");
  const tc = useTranslations("common");
  const ta = useTranslations("applications");
  const router = useRouter();
  const locale = useLocale() === "zh" ? "zh" : "en";
  const [pending, setPending] = useState(false);

  if (applicationId) {
    return (
      <ButtonLink href={`/app/applications/${applicationId}`} variant="ghost" size={size} block={block} className={className} iconRight={<ArrowRight size={16} aria-hidden />}>
        {t("open")}
      </ButtonLink>
    );
  }

  async function start() {
    if (pending) return;
    setPending(true);
    track("apply_requested", { opportunityId, type, channel, practice });
    let status = 0;
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId, ...(goalId ? { goalId } : {}), ...(practice ? { practice: true } : {}) }),
      });
      status = res.status;
      if (status === 401) {
        window.location.assign(signInPath(locale, withLocale(locale, "/app")));
        return; // stays pressed while the sign-in page loads
      }
      const data = (await res.json().catch(() => null)) as { applicationId?: string; error?: string; code?: string } | null;
      if (!res.ok || !data?.applicationId) {
        // The server's code, in the person's language (applications.errors.*); its English sentence otherwise.
        throw new Error(data?.code && ta.has(`errors.${data.code}`) ? ta(`errors.${data.code}`) : data?.error || tc("errors.generic"));
      }
      onStarted?.(data.applicationId);
      router.push(`/app/applications/${data.applicationId}`);
      // Stay pressed: the application page's skeleton takes over.
    } catch (err) {
      setPending(false);
      const message = err instanceof TypeError ? tc("errors.network") : err instanceof Error ? err.message : tc("errors.generic");
      toast.error(t("failed"), {
        body: message,
        action: status === 402 ? { label: t("getCredits"), onClick: () => router.push("/app/billing") } : undefined,
      });
    }
  }

  return (
    <Button
      variant="primary"
      size={size}
      block={block}
      className={className}
      loading={pending}
      icon={<Send size={16} aria-hidden />}
      onClick={start}
      data-pressed={pending || undefined}
    >
      {pending ? t("starting") : practice ? t("practice") : t("cta")}
    </Button>
  );
}
