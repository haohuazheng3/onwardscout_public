"use client";

import { ArrowRight, Check, Lock, ShieldCheck, Sparkles, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, Callout, Pane, ScoutDot, Skeleton, SkeletonText, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { offerName, UNLOCK_PRICE } from "@/content/plans";
import { RequestError } from "./api";
import { startUnlockCheckout } from "./unlock-flow";

/*
 * The paywall, said plainly (owner decision 2026-11-03): the preview is free and drafted by the
 * template engine; unlocking — $19 once, or a credit of a season pass — has Claude write every
 * document in full and opens downloads, copy-ready answers and the submission. Shown in the room
 * (signed in: pay or use a credit) and on the signed-out apply page (pay; save first is the
 * free alternative). Every press reacts at once.
 */

export interface UnlockPaneProps {
  applicationId: string;
  locale: string;
  /** Signed in: a credit (pass or pack) may pay instead of money. */
  signedIn: boolean;
  /** Credits this application could use (null = unknown). */
  available?: number | null;
  /** A season pass covering this application's type. */
  pass?: { sku: "season_returnship" | "season_startup"; remaining: number } | null;
  /** The room's "use a credit" action; returns null when it failed (the hook already toasted). */
  onCredit?: () => Promise<unknown>;
  busy?: string | null;
  /** Signed-out: where "save it first" goes (sign-in that returns here). */
  saveHref?: string;
  /** Claude is writing the unlocked application right now. */
  writing?: boolean;
  /** Already unlocked (and not writing): a short confirmation instead of the offer. */
  unlocked?: boolean;
  /** Back from Stripe before the bank confirmed: say so and keep checking. */
  pending?: boolean;
  messages: { network: string; generic: string };
  className?: string;
  /** Fewer words: the apply page already explains the preview above. */
  compact?: boolean;
}

export function UnlockPane(p: UnlockPaneProps) {
  const t = useTranslations("applications.unlock");
  const [paying, setPaying] = useState(false);
  const lang = p.locale === "zh" ? "zh" : "en";
  const creditBusy = p.busy === "unlock";

  const pay = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await startUnlockCheckout(p.applicationId, lang, p.messages);
      // The browser is on its way to Stripe: stay pressed.
    } catch (err) {
      setPaying(false);
      toast.error(t("payFailed"), { body: err instanceof RequestError || err instanceof Error ? err.message : undefined });
    }
  };

  if (p.writing) {
    return (
      <Pane pad="md" className={cx("min-w-0", p.className)} aria-live="polite" aria-busy="true">
        <p className="flex items-center gap-2.5 font-medium text-ink">
          <ScoutDot live />
          {t("writingTitle")}
        </p>
        <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-2">{t("writingBody")}</p>
        <div className="mt-5 grid gap-3">
          <Skeleton className="block h-4 w-2/5 rounded-full" />
          <SkeletonText lines={3} />
        </div>
      </Pane>
    );
  }
  if (p.unlocked) {
    return (
      <Pane pad="md" className={cx("min-w-0", p.className)}>
        <p className="flex items-center gap-2 font-medium text-ink">
          <Check size={18} className="text-ok" aria-hidden />
          {t("unlockedTitle")}
        </p>
        <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-3">{t("doneBody")}</p>
      </Pane>
    );
  }

  const passLabel = p.pass ? offerName(p.pass.sku, lang) : null;
  const creditFirst = p.signedIn && ((p.pass && p.pass.remaining > 0) || (p.available ?? 0) > 0);

  return (
    <Pane pad="md" id="unlock-pane" className={cx("min-w-0 scroll-mt-24 shadow-[0_0_0_2px_var(--accent-soft)]", p.className)} aria-labelledby="unlock-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="unlock-title" className="title flex items-center gap-2 text-[1.25rem] text-ink">
          <Lock size={18} className="text-accent-text" aria-hidden />
          {t("title")}
        </h2>
        <p className="num text-[1.35rem] font-semibold text-ink">
          {UNLOCK_PRICE} <span className="text-[0.8rem] font-medium text-ink-4">{t("once")}</span>
        </p>
      </div>
      <p className="mt-2 text-[0.94rem] leading-relaxed text-ink-2">{t("lede")}</p>
      <ul className="mt-3 grid gap-1.5 text-[0.9rem] leading-snug text-ink-2">
        {(["claude", "files", "answers", "submit"] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <Check size={15} className="mt-[3px] shrink-0 text-pine" aria-hidden />
            <span className="min-w-0">{t(`includes.${k}`)}</span>
          </li>
        ))}
      </ul>
      {!p.compact ? <p className="mt-3 text-[0.86rem] leading-relaxed text-ink-3">{t("previewNote")}</p> : null}

      {p.pending ? (
        <Callout tone="info" className="mt-4" title={t("pendingTitle")}>
          {t("pendingBody")}
        </Callout>
      ) : null}

      <div className="mt-5 grid gap-2">
        {creditFirst && p.onCredit ? (
          <>
            <Button size="lg" block icon={<Unlock size={18} aria-hidden />} loading={creditBusy} disabled={paying} onClick={() => void p.onCredit?.()}>
              {creditBusy ? t("working") : p.pass && p.pass.remaining > 0 ? t("usePass", { name: passLabel ?? "" }) : t("useCredit")}
            </Button>
            <p className="text-center text-[0.84rem] text-ink-3">{p.pass && p.pass.remaining > 0 ? t("passLeft", { count: p.pass.remaining }) : t("creditsLeft", { count: p.available ?? 0 })}</p>
            <Button size="md" block variant="ghost" loading={paying} disabled={creditBusy} onClick={() => void pay()}>
              {paying ? t("opening") : t("payInstead", { price: UNLOCK_PRICE })}
            </Button>
          </>
        ) : (
          <Button size="lg" block icon={<Sparkles size={18} aria-hidden />} loading={paying} onClick={() => void pay()}>
            {paying ? t("opening") : t("pay", { price: UNLOCK_PRICE })}
          </Button>
        )}
        {!p.signedIn && p.saveHref ? (
          <ButtonLink href={p.saveHref} prefetch={false} variant="quiet" size="md" block iconRight={<ArrowRight size={16} aria-hidden />}>
            {t("saveFirst")}
          </ButtonLink>
        ) : null}
      </div>
      <p className="mt-3 flex gap-2 text-[0.82rem] leading-snug text-ink-3">
        <ShieldCheck size={15} className="mt-[1px] shrink-0" aria-hidden />
        <span>{t("fine")}</span>
      </p>
    </Pane>
  );
}

/** After a signed-out payment: the application is theirs by email; one sign-in opens it. */
export function PaidSignIn({ email, signInHref, writing = false, className }: { email: string | null; signInHref: string; writing?: boolean; className?: string }) {
  const t = useTranslations("applications.unlock");
  return (
    <Pane ink pad="lg" className={cx("min-w-0", className)} role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.08em] opacity-80">
        <Check size={15} aria-hidden /> {t("paidTag")}
      </p>
      <h2 className="headline mt-3 text-[1.4rem] sm:text-[1.7rem]">{t("paidSignInTitle")}</h2>
      <p className="mt-2 text-[0.98rem] leading-relaxed opacity-80">{writing ? (email ? t("paidSignInBody", { email }) : t("paidSignInBodyNoEmail")) : email ? t("paidSignInBodyDone", { email }) : t("paidSignInBodyNoEmailDone")}</p>
      <div className="mt-6">
        <ButtonLink href={signInHref} prefetch={false} iconRight={<ArrowRight size={18} aria-hidden />}>
          {t("paidSignIn")}
        </ButtonLink>
      </div>
      <p className="mt-5 text-[0.84rem] opacity-60">{t("paidNote")}</p>
    </Pane>
  );
}
