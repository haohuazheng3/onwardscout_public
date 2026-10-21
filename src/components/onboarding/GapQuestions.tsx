"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Chip, cx } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { localize } from "@/lib/core/labels";
import type { GapQuestion } from "@/lib/profile/gaps";

/*
 * "3 things I still need": choice questions answered by tapping. A single-choice question
 * saves on the tap (optimistic: it folds away at once and comes back with a toast if the
 * save fails); a multi-choice one saves when "Save" is pressed. The next open question
 * slides in from the server's answer.
 */

export function GapQuestions({
  questions,
  locale,
  onAnswer,
  title,
  className,
}: {
  questions: GapQuestion[];
  locale: "en" | "zh";
  /** Saves the answer; resolves with the fresh list of open questions. */
  onAnswer: (q: GapQuestion, values: string[]) => Promise<GapQuestion[] | void>;
  title?: string;
  className?: string;
}) {
  const t = useTranslations("onboarding.gaps");
  const tc = useTranslations("common");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const remaining = questions.filter((q) => !hidden.has(q.id));
  const visible = remaining.slice(0, 3);

  async function save(q: GapQuestion, values: string[]) {
    setHidden((cur) => new Set(cur).add(q.id));
    setSaving(q.id);
    try {
      await onAnswer(q, values);
      toast.success(t("saved"), { duration: 1800 });
    } catch (err) {
      setHidden((cur) => {
        const n = new Set(cur);
        n.delete(q.id);
        return n;
      });
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(null);
    }
  }

  if (!visible.length) {
    return (
      <section className={cx("pane min-w-0 p-5 sm:p-6", className)}>
        <p className="eyebrow">{title ?? t("title")}</p>
        <p className="mt-2 flex items-center gap-2 text-[0.98rem] text-ink-2">
          <Check size={18} className="text-pine" aria-hidden />
          {t("allSet")}
        </p>
      </section>
    );
  }

  return (
    <section className={cx("min-w-0", className)} aria-labelledby="gaps-title">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 id="gaps-title" className="title text-[1.2rem] text-ink">
          {title ?? t("title")}
        </h2>
        <span className="num text-[0.85rem] text-ink-4">{t("count", { count: Math.min(3, remaining.length) })}</span>
      </div>
      <div className="grid gap-3">
        {visible.map((q) => {
          const selected = picks[q.id] ?? [];
          return (
            <fieldset key={q.id} className="pane min-w-0 p-5 sm:p-6" aria-busy={saving === q.id || undefined}>
              <legend className="sr-only">{localize(q.prompt, locale)}</legend>
              <p className="text-[1.02rem] font-semibold leading-snug text-ink" aria-hidden="true">
                {localize(q.prompt, locale)}
              </p>
              <p className="mt-1 text-[0.88rem] text-ink-3">{localize(q.why, locale)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {q.options.map((o) => {
                  const on = selected.includes(o.value);
                  return (
                    <Chip
                      key={o.value}
                      selected={on}
                      className="max-w-full"
                      onClick={() => {
                        if (!q.multi) {
                          setPicks((cur) => ({ ...cur, [q.id]: [o.value] }));
                          void save(q, [o.value]);
                          return;
                        }
                        setPicks((cur) => {
                          const now = cur[q.id] ?? [];
                          const next = now.includes(o.value) ? now.filter((v) => v !== o.value) : now.length >= q.maxPicks ? [...now.slice(1), o.value] : [...now, o.value];
                          return { ...cur, [q.id]: next };
                        });
                      }}
                    >
                      {localize(o.label, locale)}
                    </Chip>
                  );
                })}
              </div>
              {q.multi ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[0.84rem] text-ink-4">{t("pickUpTo", { count: q.maxPicks })}</span>
                  <Button size="sm" disabled={!selected.length} onClick={() => void save(q, selected)}>
                    {tc("buttons.save")}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
