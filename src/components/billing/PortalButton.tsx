"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { isStripePortalUrl, portalErrorKey, type PortalErrorKey } from "./checkout-flow";

/**
 * Opens Stripe's billing portal (cancel Pro, invoices, card, billing email). The press shows its
 * pending state at once; a failure rolls back with a toast that says what to do.
 */
export function PortalButton({
  children,
  variant = "ghost",
  size = "md",
  block = false,
  className,
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}) {
  const t = useTranslations("billing.portal");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  // Back from the portal with the browser's Back button: the page comes from bfcache still busy.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function open() {
    if (busy) return;
    setBusy(true);
    let key: PortalErrorKey = "failed";
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ locale: locale === "zh" ? "zh" : "en" }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: unknown; code?: string };
      if (res.ok && isStripePortalUrl(body.url)) {
        window.location.assign(body.url);
        return;
      }
      key = portalErrorKey(res.status, body.code);
    } catch (e) {
      console.warn("[billing] portal failed to open", e);
      key = "network";
    }
    setBusy(false);
    toast.error(t("errorTitle"), { body: t(`errors.${key}`) });
  }

  return (
    <Button variant={variant} size={size} block={block} className={className} loading={busy} onClick={() => void open()}>
      {busy ? t("opening") : (children ?? t("manage"))}
    </Button>
  );
}
