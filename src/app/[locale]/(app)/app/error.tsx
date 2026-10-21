"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button, ButtonLink, Pane } from "@/components/ui";

/** Reports a rendering error to the self-hosted error inbox. */
function report(error: Error & { digest?: string }) {
  try {
    const body = JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: "error-boundary",
      route: location.pathname,
      severity: "error",
      userAgent: navigator.userAgent,
    });
    if (!navigator.sendBeacon?.("/api/errors", new Blob([body], { type: "application/json" }))) {
      fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch((e: unknown) => {
        console.warn("[errors] report failed", e);
      });
    }
  } catch (e) {
    console.warn("[errors] report failed", e);
  }
}

/**
 * Error boundary inside the app shell: a page under /app that fails keeps the navigation, the
 * credit badge and the providers; only the page area shows the error. "Try again" re-fetches the
 * server render (`retry`), and the way out leads to the app home, not the marketing site.
 */
export default function AppError({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  const t = useTranslations("common");

  useEffect(() => {
    report(error);
  }, [error]);

  return (
    <Pane pad="lg" className="mx-auto mt-4 w-full max-w-xl min-w-0 text-center">
      <p className="eyebrow eyebrow-dot">{t("errors.pageEyebrow")}</p>
      <h1 className="headline mt-3 text-[1.7rem] text-ink sm:text-[2rem]">{t("errors.pageTitle")}</h1>
      <p className="mx-auto mt-3 max-w-sm text-[0.97rem] leading-relaxed text-ink-3">{t("errors.pageBody")}</p>
      {error.digest ? <p className="mt-3 font-mono text-[0.8rem] text-ink-3">{t("errors.reference", { digest: error.digest })}</p> : null}
      <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
        <Button onClick={() => (retry ? retry() : reset())} icon={<RotateCcw size={17} aria-hidden />}>
          {t("buttons.retry")}
        </Button>
        <ButtonLink href="/app" variant="ghost">
          {t("buttons.goHome")}
        </ButtonLink>
      </div>
    </Pane>
  );
}
