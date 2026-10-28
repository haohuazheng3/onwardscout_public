"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { track } from "@/components/Consent";
import { Button, ScoutDot } from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import { api, ENDPOINTS } from "@/components/onboarding/api";

/*
 * The dashboard right after the questions (/app?plan=1): Onward Scout plans here. It works out
 * the person's path from their answers and files, sets its directions up as goals and starts
 * matching (POST …/finish), then the dashboard reloads with the plan. A failure says so and
 * offers to try again; nothing is lost, the answers are already saved. `manual`: someone with a
 * profile but no plan yet (from before plans existed) starts it with a tap — never on page load,
 * so a plan that fails to save can't loop.
 */
export function PlanningPane({ signedIn, locale, manual = false }: { signedIn: boolean; locale: "en" | "zh"; manual?: boolean }) {
  const t = useTranslations("profile.home.planning");
  const tn = useTranslations("profile.home.plan.none");
  const tc = useTranslations("common");
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(manual ? -1 : 0);
  const started = useRef(-1);

  useEffect(() => {
    if (attempt < 0) return; // manual: waits for the tap
    if (started.current === attempt) return; // once per attempt (React may run effects twice in development)
    started.current = attempt;
    (async () => {
      try {
        const res = await api<{ goals: { id: string; family: string; sub: string | null }[] }>(
          ENDPOINTS[signedIn ? "user" : "draft"].finish,
          { method: "POST", json: { locale, confirm: !manual } },
          { network: tc("errors.network"), generic: tc("errors.generic") },
        );
        for (const g of res.goals) track("goal_set", { goalId: g.id, family: g.family, sub: g.sub, via: "onboarding" });
        router.replace("/app");
      } catch (err) {
        setFailed(err instanceof Error ? err.message : tc("errors.generic"));
      }
    })();
  }, [attempt, manual, signedIn, locale, router, tc]);

  if (attempt < 0) {
    return (
      <section className="pane-ink min-w-0 p-6 sm:p-8" aria-labelledby="plan-none-title">
        <h2 id="plan-none-title" className="headline text-[1.55rem] leading-tight sm:text-[2rem]">
          {tn("title")}
        </h2>
        <p className="mt-2 max-w-lg text-[0.98rem] leading-relaxed opacity-80">{tn("body")}</p>
        <Button variant="primary" className="mt-5" iconRight={<ArrowRight size={17} aria-hidden />} onClick={() => setAttempt(0)}>
          {tn("cta")}
        </Button>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="pane-ink min-w-0 p-6 sm:p-8" role="alert">
        <h2 className="headline text-[1.5rem] sm:text-[1.8rem]">{t("failed")}</h2>
        <p className="mt-2 max-w-lg text-[0.98rem] leading-relaxed opacity-80">{failed}</p>
        <Button
          variant="primary"
          className="mt-5"
          icon={<RotateCcw size={16} aria-hidden />}
          onClick={() => {
            setFailed(null);
            setAttempt((n) => n + 1);
          }}
        >
          {t("retry")}
        </Button>
      </section>
    );
  }

  return (
    <section className="pane-ink min-w-0 p-6 sm:p-8" aria-live="polite" aria-busy="true">
      <p className="eyebrow flex items-center gap-2 opacity-80">
        <ScoutDot live />
        {t("eyebrow")}
      </p>
      <h2 className="headline mt-3 text-[1.55rem] leading-tight sm:text-[2rem]">{t("title")}</h2>
      <p className="mt-2 max-w-lg text-[0.98rem] leading-relaxed opacity-80">{t("body")}</p>
      <ul className="mt-6 grid gap-3 text-[0.95rem]" aria-hidden="true">
        {(["step1", "step2", "step3"] as const).map((k) => (
          <li key={k} className="flex items-center gap-3 opacity-80">
            <span className="skeleton block h-2.5 w-2.5 shrink-0 rounded-full" />
            {t(k)}
          </li>
        ))}
      </ul>
    </section>
  );
}
