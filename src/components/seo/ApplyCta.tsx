import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { ButtonLink, cx } from "@/components/ui";
import { applyPath } from "@/lib/site";
import { UNLOCK_PRICE } from "@/content/plans";
import { applyPromise } from "./apply-promise";

export { applyPromise };

/*
 * "Write my application" on a listing (and its guide): the moment someone reads how to apply is
 * the moment to offer writing it. Starts /app/apply/<id> for THIS programme — signed out, the
 * résumé they drop there gets this programme's materials drafted at once (the free preview);
 * $19 unlocks the full version written with Claude. The official page stays one tap away.
 */

export function ApplyCta({
  opportunityId,
  type,
  officialUrl,
  variant = "pane",
  className,
}: {
  opportunityId: string;
  type: string;
  officialUrl?: string | null;
  /** "pane": its own highlighted block; "inline": the buttons only (inside another pane). */
  variant?: "pane" | "inline";
  className?: string;
}) {
  const buttons = (
    <div className="flex flex-wrap gap-3">
      <ButtonLink href={applyPath(opportunityId)} prefetch={false} iconRight={<ArrowRight size={18} aria-hidden />}>
        Write my application
      </ButtonLink>
      {officialUrl ? (
        <ButtonLink href={officialUrl} variant="ghost" external icon={<ExternalLink size={16} aria-hidden />}>
          Official page
        </ButtonLink>
      ) : null}
    </div>
  );
  if (variant === "inline") return <div className={className}>{buttons}</div>;
  return (
    <div className={cx("rounded-[var(--radius-pane)] border border-accent/30 bg-accent-soft px-5 py-5 sm:px-7 sm:py-6", className)}>
      <p className="flex items-center gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-accent-text">
        <Sparkles size={15} aria-hidden /> Free preview · no account needed · {UNLOCK_PRICE} to unlock
      </p>
      <p className="mt-2 max-w-2xl text-[1.02rem] leading-relaxed text-ink">{applyPromise(type)}</p>
      <div className="mt-4">{buttons}</div>
      <p className="mt-3 text-[0.84rem] text-ink-3">You see the draft first, free. Unlocking has Claude write it in full, with Word/PDF downloads and every answer ready to copy. Nothing is submitted without your tap.</p>
    </div>
  );
}
