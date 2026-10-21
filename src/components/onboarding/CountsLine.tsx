"use client";

import { useTranslations } from "next-intl";

/** The order sections are named in ("Found 3 roles, 2 projects, 1 paper"). */
export const COUNT_KEYS = ["experience", "ventures", "education", "projects", "publications", "achievements", "certifications", "skills"] as const;

/** "Found 3 roles, 2 projects, 1 paper" from per-section counts; `fallback` when there is nothing. */
export function useCountsPhrase() {
  const t = useTranslations("onboarding.counts");
  return (counts: Record<string, number>, max = 3): string | null => {
    const parts = COUNT_KEYS.filter((k) => (counts[k] ?? 0) > 0)
      .slice(0, max)
      .map((k) => t(k, { count: counts[k] ?? 0 }));
    if (!parts.length) return null;
    return t("found", { list: parts.join(t("separator")) });
  };
}

export function CountsLine({ counts, fallback }: { counts: Record<string, number>; fallback?: string }) {
  const phrase = useCountsPhrase();
  const text = phrase(counts);
  return <span>{text ?? fallback ?? null}</span>;
}
