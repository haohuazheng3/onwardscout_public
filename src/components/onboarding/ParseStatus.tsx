"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoutDot, Skeleton, cx } from "@/components/ui";
import type { DraftStatusView } from "./api";
import { useCountsPhrase } from "./CountsLine";

/*
 * The live line under the drop zone: "Reading your CV… found 3 roles, 2 projects, 1 paper",
 * then "Building your profile…", then what was found — with chips for the newest facts, and
 * shimmering chip skeletons while more are on their way.
 */

export function ParseStatus({ status, className }: { status: DraftStatusView | null; className?: string }) {
  const t = useTranslations("onboarding.status");
  const phrase = useCountsPhrase();
  if (!status || status.phase === "empty") return null;
  const reading = status.documents.filter((d) => d.status === "uploaded" || d.status === "parsing");
  const counts = status.profile?.counts ?? {};
  const found = phrase(counts, 4);
  const busy = status.phase === "reading" || status.phase === "building";
  const first = reading[0];
  const headline =
    status.phase === "reading"
      ? first?.source === "link"
        ? t("readingLink", { name: (first.sourceUrl ?? first.filename ?? "").replace(/^https?:\/\//, "").slice(0, 60) })
        : t("readingFile", { name: (first?.filename ?? "").slice(0, 60), more: Math.max(0, reading.length - 1) })
      : status.phase === "building"
        ? t("building")
        : found
          ? t("ready")
          : t("readyEmpty");

  return (
    <section className={cx("pane min-w-0 p-5 sm:p-6", className)} aria-live="polite" aria-busy={busy || undefined}>
      <div className="flex items-start gap-3">
        <span className="mt-1.5 shrink-0">{busy ? <ScoutDot live /> : <CircleCheck size={18} className="text-pine" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.02rem] font-semibold leading-snug text-ink">{headline}</p>
          {found ? <p className="mt-0.5 text-[0.92rem] text-ink-3">{found}</p> : busy ? <p className="mt-0.5 text-[0.92rem] text-ink-4">{t("hint")}</p> : null}
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {status.facts.slice(0, 10).map((f) => (
          <li key={f.id} className="min-w-0 max-w-full animate-pop">
            <span className="inline-flex min-h-[32px] max-w-full items-center rounded-full bg-pane-2 px-3 text-[0.84rem] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
              <span className="truncate">{f.claim}</span>
            </span>
          </li>
        ))}
        {busy
          ? [96, 140, 72, 120].slice(0, status.facts.length ? 2 : 4).map((w, i) => (
              <li key={`sk${i}`} aria-hidden="true">
                <Skeleton className="block h-8 rounded-full" width={w} />
              </li>
            ))
          : null}
      </ul>
    </section>
  );
}
