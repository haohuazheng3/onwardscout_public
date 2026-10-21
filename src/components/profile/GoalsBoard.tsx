"use client";

import { Compass, Pause, Pencil, Play, Plus, Trophy, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { track } from "@/components/Consent";
import { Button, Chip, EmptyState, Input, Progress, Tag, cx } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { getGoalFamily } from "@/lib/core/goals";
import { localize } from "@/lib/core/labels";
import type { GoalStatus, IdentityCode, Intensity, Profile, SubGoalId } from "@/lib/core/types";
import { api } from "@/components/onboarding/api";
import { FAMILY_ICON, GoalChooser, type GoalSubmission } from "@/components/onboarding/GoalChooser";
import { retimeDefinition } from "@/lib/profile/success-params";

/*
 * /app/goals: each goal with its success definition, milestone progress, horizon and
 * intensity (all editable in place), pause / resume / achieved / drop, and "add a goal"
 * with the same chooser as step 3 of /app/start.
 */

export interface GoalView {
  id: string;
  family: string;
  sub: string | null;
  label: string;
  successDefinition: string | null;
  horizonMonths: number;
  intensity: Intensity | null;
  status: GoalStatus;
  milestones: { id: string; title: string; target: number; progress: number; dueAt: string | null; status: string }[];
}

const HORIZONS = [3, 6, 12];
const INTENSITIES: Intensity[] = ["light", "steady", "intense"];

export function GoalsBoard({ goals: initial, codes, profile, locale }: { goals: GoalView[]; codes: IdentityCode[]; profile: Profile; locale: "en" | "zh" }) {
  const t = useTranslations("profile.goals");
  const to = useTranslations("onboarding.goals");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [goals, setGoals] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setGoals(initial);
  }
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [dropping, setDropping] = useState<GoalView | null>(null);
  const msgs = { network: tc("errors.network"), generic: tc("errors.generic") };

  async function patch(goal: GoalView, change: Partial<Pick<GoalView, "status" | "successDefinition" | "horizonMonths" | "intensity">>) {
    const before = goals;
    const text = change.horizonMonths && !change.successDefinition && goal.successDefinition ? retimeDefinition(goal.successDefinition, change.horizonMonths) : null;
    setGoals((cur) => cur.map((g) => (g.id === goal.id ? { ...g, ...change, ...(text ? { successDefinition: text } : {}) } : g)));
    try {
      const res = await api<{ goal: { milestones?: GoalView["milestones"] } & Record<string, unknown> }>("/api/goals", { method: "PATCH", json: { id: goal.id, ...change, locale } }, msgs);
      if (res.goal.milestones) {
        const ms = res.goal.milestones.map((m) => ({ ...m, dueAt: m.dueAt ? new Date(m.dueAt).toISOString() : null }));
        setGoals((cur) => cur.map((g) => (g.id === goal.id ? { ...g, milestones: ms } : g)));
      }
      if (change.status === "achieved") toast.success(t("achievedToast"));
      if (change.status === "active") track("goal_set", { goalId: goal.id, family: goal.family, sub: goal.sub, resumed: true });
    } catch (err) {
      setGoals(before);
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  async function add(submissions: GoalSubmission[]) {
    try {
      const res = await api<{ goals: { id: string; family: string; sub: string | null }[] }>("/api/goals", { method: "POST", json: { goals: submissions, locale } }, msgs);
      for (const g of res.goals) track("goal_set", { goalId: g.id, family: g.family, sub: g.sub });
      setAdding(false);
      toast.success(t("addedToast"));
      router.refresh();
    } catch (err) {
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  const activeSubs = goals.filter((g) => g.status === "active" || g.status === "paused").map((g) => g.sub).filter(Boolean) as SubGoalId[];
  const visible = goals.filter((g) => g.status !== "dropped");

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button icon={<Plus size={17} aria-hidden />} onClick={() => setAdding(true)}>
          {t("add")}
        </Button>
      </div>

      {!visible.length ? (
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={<Button onClick={() => setAdding(true)}>{t("add")}</Button>} />
      ) : null}

      {visible.map((g) => {
        const Icon = FAMILY_ICON[g.family] ?? Compass;
        const fam = (() => {
          try {
            return localize(getGoalFamily(g.family as Parameters<typeof getGoalFamily>[0]).label, locale);
          } catch {
            return g.family;
          }
        })();
        const dim = g.status === "paused" || g.status === "achieved";
        return (
          <article key={g.id} className={cx("pane min-w-0 p-5 sm:p-7", dim && "opacity-90")} aria-labelledby={`goal-${g.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pine-soft text-pine">
                  <Icon size={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="eyebrow">{fam}</p>
                  <h2 id={`goal-${g.id}`} className="title truncate text-[1.15rem] text-ink">
                    {g.label}
                  </h2>
                </div>
              </div>
              <Tag tone={g.status === "active" ? "pine" : g.status === "achieved" ? "ok" : "default"} dot>
                {t(`status.${g.status}`)}
              </Tag>
            </div>

            <div className="mt-4">
              {editing?.id === g.id ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = editing.text.trim();
                    if (text.length < 3) return;
                    setEditing(null);
                    void patch(g, { successDefinition: text });
                  }}
                >
                  <label htmlFor={`sd-${g.id}`} className="sr-only">
                    {to("ownLabel")}
                  </label>
                  <Input id={`sd-${g.id}`} autoFocus maxLength={300} value={editing.text} onChange={(e) => setEditing({ id: g.id, text: e.target.value })} className="min-w-0 flex-1" />
                  <div className="flex gap-2">
                    <Button type="submit">{tc("buttons.save")}</Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>
                      {tc("buttons.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <button type="button" onClick={() => setEditing({ id: g.id, text: g.successDefinition ?? "" })} className="press group flex w-full min-w-0 items-start gap-2 rounded-[18px] bg-pane-2 px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)]">
                  <span className="min-w-0 flex-1 text-[1rem] font-medium leading-snug text-ink">{g.successDefinition ?? t("noDefinition")}</span>
                  <Pencil size={15} className="mt-1 shrink-0 text-ink-4 group-hover:text-ink" aria-hidden />
                  <span className="sr-only">{t("editDefinition")}</span>
                </button>
              )}
            </div>

            {g.milestones.length ? (
              <ul className="mt-5 grid gap-4">
                {g.milestones.map((m) => (
                  <li key={m.id} className="min-w-0">
                    <Progress value={Math.min(m.progress, m.target)} max={m.target} label={m.title} showValue tone={m.status === "done" ? "pine" : "accent"} />
                    {m.dueAt ? <p className="mt-1 text-[0.8rem] text-ink-4">{t("due", { date: format.dateTime(new Date(m.dueAt), { dateStyle: "medium" }) })}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[0.86rem] font-medium text-ink-2">{to("horizon")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...new Set([...HORIZONS, g.horizonMonths])].sort((a, b) => a - b).map((h) => (
                    <Chip key={h} size="sm" selected={g.horizonMonths === h} onClick={() => g.horizonMonths !== h && void patch(g, { horizonMonths: h })}>
                      {to("months", { count: h })}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[0.86rem] font-medium text-ink-2">{to("intensity")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {INTENSITIES.map((i) => (
                    <Chip key={i} size="sm" selected={(g.intensity ?? "steady") === i} onClick={() => (g.intensity ?? "steady") !== i && void patch(g, { intensity: i })}>
                      {to(`intensityOptions.${i}`)}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              {g.status === "active" ? (
                <Button variant="quiet" size="sm" icon={<Pause size={15} aria-hidden />} onClick={() => void patch(g, { status: "paused" })}>
                  {t("pause")}
                </Button>
              ) : (
                <Button variant="quiet" size="sm" icon={<Play size={15} aria-hidden />} onClick={() => void patch(g, { status: "active" })}>
                  {g.status === "achieved" ? t("reopen") : t("resume")}
                </Button>
              )}
              {g.status !== "achieved" ? (
                <Button variant="quiet" size="sm" icon={<Trophy size={15} aria-hidden />} onClick={() => void patch(g, { status: "achieved" })}>
                  {t("achieved")}
                </Button>
              ) : null}
              <Button variant="quiet" size="sm" icon={<X size={15} aria-hidden />} onClick={() => setDropping(g)}>
                {t("drop")}
              </Button>
            </div>
          </article>
        );
      })}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t("addTitle")} description={t("addLede")} width={720}>
        {adding ? <GoalChooser codes={codes} profile={profile} locale={locale} preselect={!visible.length} exclude={activeSubs} submitLabel={t("addSubmit")} onSubmit={add} /> : null}
      </Dialog>

      <Dialog
        open={Boolean(dropping)}
        onClose={() => setDropping(null)}
        title={t("dropTitle")}
        description={t("dropBody")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDropping(null)}>
              {tc("buttons.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const g = dropping;
                setDropping(null);
                if (g) void patch(g, { status: "dropped" });
              }}
            >
              {t("drop")}
            </Button>
          </>
        }
      />
    </div>
  );
}
