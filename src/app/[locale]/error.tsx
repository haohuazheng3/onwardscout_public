"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { SlimHeader } from "@/components/Header";
import { LogoMark } from "@/components/Logo";
import { Button, ButtonLink } from "@/components/ui";

/** Reports a rendering error to the self-hosted error inbox without depending on any other module. */
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

/** Error boundary for every localized page: the layout (header, providers) stays, the page is replaced. */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");

  useEffect(() => {
    report(error);
  }, [error]);

  return (
    <>
      <SlimHeader />
      <main id="main" className="safe-x pt-10 sm:px-6 sm:pt-20">
        <div className="pane mx-auto max-w-xl px-6 py-12 text-center sm:px-10 sm:py-14">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-pane-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <LogoMark size={34} />
          </div>
          <p className="eyebrow eyebrow-dot mt-6">{t("errors.pageEyebrow")}</p>
          <h1 className="display mt-4 text-[2.1rem] text-ink sm:text-[2.6rem]">{t("errors.pageTitle")}</h1>
          <p className="lede mx-auto mt-4 max-w-sm">{t("errors.pageBody")}</p>
          {error.digest ? <p className="mt-3 font-mono text-[0.8rem] text-ink-4">{t("errors.reference", { digest: error.digest })}</p> : null}
          <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
            <Button onClick={() => reset()} icon={<RotateCcw size={17} aria-hidden />}>
              {t("buttons.retry")}
            </Button>
            <ButtonLink href="/" variant="ghost">
              {t("buttons.goHome")}
            </ButtonLink>
          </div>
        </div>
      </main>
    </>
  );
}
