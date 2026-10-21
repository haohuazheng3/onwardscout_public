"use client";

import {
  Briefcase,
  Coins,
  Compass,
  GraduationCap,
  HeartHandshake,
  Image as ImageIcon,
  Mic,
  Microscope,
  Pencil,
  Plane,
  Rocket,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Chip, Input, cx } from "@/components/ui";
import { GOAL_FAMILY_DEFS, getGoalFamily } from "@/lib/core/goals";
import { localize } from "@/lib/core/labels";
import { defaultGoalsFor } from "@/lib/core/matrix";
import { INTENSITY_LABELS } from "@/lib/core/playbooks";
import type { GoalFamily, IdentityCode, Intensity, Profile, SubGoalId } from "@/lib/core/types";
import { applicableSubGoals, defaultSubGoal, leadFamilies, snapHorizon, successOptions } from "@/lib/profile/success-params";
import { radioKeys } from "@/components/radio-keys";

/*
 * Step 3, "What do you want next?" (and "Add a goal" on /app/goals): goal families
 * pre-selected from the person's identities, a sub-goal per family, a success definition
 * picked from three (or edited in one line), a horizon and an intensity.
 */

export const FAMILY_ICON: Record<string, LucideIcon> = {
  G1: Briefcase,
  G2: TrendingUp,
  G3: Rocket,
  G4: Microscope,
  G5: GraduationCap,
  G6: ImageIcon,
  G7: Mic,
  G8: Coins,
  G9: Plane,
  G10: UsersRound,
  G11: HeartHandshake,
  G12: Compass,
};

const HORIZONS = [3, 6, 12] as const;
const INTENSITIES: Intensity[] = ["light", "steady", "intense"];

export interface GoalDraft {
  family: GoalFamily;
  sub: SubGoalId;
  templateId: string | null;
  successDefinition: string;
  edited: boolean;
  horizonMonths: (typeof HORIZONS)[number];
  intensity: Intensity;
}

export interface GoalSubmission {
  family: GoalFamily;
  sub: SubGoalId;
  successDefinition: string;
  templateId: string | null;
  horizonMonths: number;
  intensity: Intensity;
}

function draftFor(family: GoalFamily, codes: IdentityCode[], profile: Profile, locale: "en" | "zh", sub?: SubGoalId): GoalDraft {
  const s = sub ?? defaultSubGoal(family, codes);
  const first = successOptions(s, profile, 6, locale)[0];
  const horizon = snapHorizon(first?.horizonMonths ?? 6);
  const opts = successOptions(s, profile, horizon, locale);
  return { family, sub: s, templateId: opts[0]?.templateId ?? null, successDefinition: opts[0]?.text ?? "", edited: false, horizonMonths: horizon, intensity: "steady" };
}

export function GoalChooser({
  codes,
  profile,
  locale,
  preselect = true,
  exclude = [],
  submitLabel,
  onSubmit,
  footnote,
}: {
  codes: IdentityCode[];
  profile: Profile;
  locale: "en" | "zh";
  /** Pre-select the lead families of the person's identities (step 3); off for "add a goal". */
  preselect?: boolean;
  /** Sub-goals the person already pursues (marked, not offered twice). */
  exclude?: SubGoalId[];
  submitLabel: string;
  onSubmit: (goals: GoalSubmission[]) => Promise<void>;
  footnote?: ReactNode;
}) {
  const t = useTranslations("onboarding.goals");
  const { primary, more, hidden } = useMemo(() => defaultGoalsFor(codes), [codes]);
  const [selected, setSelected] = useState<GoalFamily[]>(() => (preselect ? leadFamilies(codes) : []));
  const [drafts, setDrafts] = useState<Partial<Record<GoalFamily, GoalDraft>>>(() => Object.fromEntries((preselect ? leadFamilies(codes) : []).map((f) => [f, draftFor(f, codes, profile, locale)])));
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState<GoalFamily | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const firstFamilies = primary.length ? primary : more.slice(0, 4);
  const otherFamilies = [...more, ...hidden].filter((f) => !firstFamilies.includes(f));

  function toggleFamily(f: GoalFamily) {
    if (selected.includes(f)) {
      setSelected((cur) => cur.filter((x) => x !== f));
      return;
    }
    setSelected((cur) => [...cur, f].slice(-4));
    setDrafts((cur) => (cur[f] ? cur : { ...cur, [f]: draftFor(f, codes, profile, locale) }));
  }

  function patch(f: GoalFamily, next: Partial<GoalDraft>) {
    setDrafts((cur) => {
      const d = cur[f];
      if (!d) return cur;
      const merged = { ...d, ...next };
      // A new sub-goal or horizon re-renders the chosen template (unless the person wrote their own).
      if ((next.sub || next.horizonMonths) && !merged.edited) {
        const opts = successOptions(merged.sub, profile, merged.horizonMonths, locale);
        const keep = next.sub ? opts[0] : (opts.find((o) => o.templateId === d.templateId) ?? opts[0]);
        merged.templateId = keep?.templateId ?? null;
        merged.successDefinition = keep?.text ?? merged.successDefinition;
      }
      return { ...cur, [f]: merged };
    });
  }

  const ready = selected.length > 0 && selected.every((f) => (drafts[f]?.successDefinition.trim().length ?? 0) >= 3);

  async function submit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(
        selected.map((f) => {
          const d = drafts[f]!;
          return { family: f, sub: d.sub, successDefinition: d.successDefinition.trim(), templateId: d.edited ? null : d.templateId, horizonMonths: d.horizonMonths, intensity: d.intensity };
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const familyChip = (f: GoalFamily) => {
    const Icon = FAMILY_ICON[f] ?? Compass;
    return (
      <Chip key={f} selected={selected.includes(f)} onClick={() => toggleFamily(f)} icon={<Icon size={15} aria-hidden />}>
        {localize(getGoalFamily(f).label, locale)}
      </Chip>
    );
  };

  return (
    <div className="grid gap-4">
      <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="goals-families">
        <p className="eyebrow">{t("familiesEyebrow")}</p>
        <h2 id="goals-families" className="title mt-1.5 text-[1.3rem] text-ink">
          {t("familiesTitle")}
        </h2>
        <p className="mt-1 text-[0.92rem] text-ink-3">{t("familiesHint")}</p>
        <div className="mt-4 flex flex-wrap gap-2">{firstFamilies.map(familyChip)}</div>
        {otherFamilies.length ? (
          <div className="mt-3">
            <button type="button" className="link text-[0.9rem]" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
              {showMore ? t("lessGoals") : t("moreGoals", { count: otherFamilies.length })}
            </button>
            {showMore ? <div className="mt-3 flex flex-wrap gap-2 animate-pop">{otherFamilies.map(familyChip)}</div> : null}
          </div>
        ) : null}
      </section>

      {selected.map((f) => {
        const d = drafts[f];
        if (!d) return null;
        const subs = applicableSubGoals(f, codes);
        const options = successOptions(d.sub, profile, d.horizonMonths, locale);
        const Icon = FAMILY_ICON[f] ?? Compass;
        return (
          <section key={f} className="pane min-w-0 p-5 sm:p-7" aria-labelledby={`goal-${f}`}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-pine-soft text-pine">
                <Icon size={17} aria-hidden />
              </span>
              <h3 id={`goal-${f}`} className="title text-[1.2rem] text-ink">
                {localize(getGoalFamily(f).label, locale)}
              </h3>
            </div>

            <p className="mt-5 text-[0.9rem] font-medium text-ink-2">{t("subTitle")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {subs.map((s) => (
                <Chip key={s.id} size="sm" selected={d.sub === s.id} onClick={() => patch(f, { sub: s.id, edited: false })} className="max-w-full">
                  {localize(s.label, locale)}
                  {exclude.includes(s.id) ? ` · ${t("alreadyActive")}` : ""}
                </Chip>
              ))}
            </div>

            <p className="mt-6 text-[0.9rem] font-medium text-ink-2">{t("successTitle")}</p>
            <p className="mt-0.5 text-[0.85rem] text-ink-4">{t("successHint")}</p>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label={t("successTitle")}>
              {options.map((o, i) => {
                const on = !d.edited && d.templateId === o.templateId;
                return (
                  <button
                    key={o.templateId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    {...radioKeys(i, options.length, d.edited ? -1 : options.findIndex((x) => x.templateId === d.templateId), (n) =>
                      patch(f, { templateId: options[n].templateId, successDefinition: options[n].text, edited: false }),
                    )}
                    onClick={() => patch(f, { templateId: o.templateId, successDefinition: o.text, edited: false })}
                    className={cx(
                      "press w-full min-w-0 rounded-[18px] px-4 py-3.5 text-left text-[0.96rem] leading-snug transition-colors",
                      on ? "bg-ink text-void" : "bg-pane-2 text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-pane-3",
                    )}
                  >
                    {o.text}
                  </button>
                );
              })}
              {editing === f || d.edited ? (
                <div className="mt-1">
                  <label htmlFor={`own-${f}`} className="sr-only">
                    {t("ownLabel")}
                  </label>
                  <Input
                    id={`own-${f}`}
                    autoFocus={editing === f}
                    maxLength={300}
                    value={d.successDefinition}
                    onChange={(e) => patch(f, { successDefinition: e.target.value, edited: true, templateId: null })}
                    onBlur={() => setEditing(null)}
                  />
                </div>
              ) : (
                <button type="button" className="link mt-1 inline-flex w-fit items-center gap-1.5 text-[0.9rem]" onClick={() => setEditing(f)}>
                  <Pencil size={14} aria-hidden />
                  {t("editOwn")}
                </button>
              )}
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[0.9rem] font-medium text-ink-2">{t("horizon")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {HORIZONS.map((h) => (
                    <Chip key={h} size="sm" selected={d.horizonMonths === h} onClick={() => patch(f, { horizonMonths: h })}>
                      {t("months", { count: h })}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[0.9rem] font-medium text-ink-2">{t("intensity")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {INTENSITIES.map((i) => (
                    <Chip key={i} size="sm" selected={d.intensity === i} onClick={() => patch(f, { intensity: i })} title={localize(INTENSITY_LABELS[i], locale)}>
                      {t(`intensityOptions.${i}`)}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-[0.84rem] text-ink-4">{localize(INTENSITY_LABELS[d.intensity], locale)}</p>
              </div>
            </div>
          </section>
        );
      })}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[0.88rem] text-ink-3">{selected.length ? footnote : t("pickOne")}</div>
        <Button size="lg" onClick={() => void submit()} loading={submitting} disabled={!ready}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** For lists outside the chooser (goals page): every family in order. */
export const ALL_FAMILIES = GOAL_FAMILY_DEFS.map((d) => d.id);
