"use client";

import { Briefcase, Compass, GraduationCap, Microscope, Palette, Rocket, type LucideIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { track } from "@/components/Consent";
import { api, ENDPOINTS } from "@/components/onboarding/api";
import { cx, ScoutDot } from "@/components/ui";
import { toast } from "@/components/ui-client";
import { Link, useRouter } from "@/i18n/navigation";
import type { LifePath } from "@/lib/llm/types";

/*
 * The top of the dashboard: the path Onward Scout planned (work, startup, research, study,
 * create), the destination in a few words and why, and the compass — how clearly the person's
 * profile points to each path. Tapping another path plans that one instead (Claude when on): the
 * press shows at once, the plan arrives in place, a failure rolls back with a toast.
 */

export const PATH_ICONS: Record<LifePath, LucideIcon> = {
  work: Briefcase,
  startup: Rocket,
  research: Microscope,
  study: GraduationCap,
  create: Palette,
  explore: Compass,
};

export interface PathHeroProps {
  signedIn: boolean;
  locale: "en" | "zh";
  path: LifePath;
  headline: string;
  reason: string;
  summary: string;
  scores: Array<{ path: LifePath; score: number }>;
  strings: {
    eyebrow: string;
    change: string;
    compass: string;
    current: string;
    choose: string;
    planning: string;
    failed: string;
    footer: string;
    paths: Record<LifePath, string>;
  };
}

export function PathHero({ signedIn, locale, path, headline, reason, summary, scores, strings }: PathHeroProps) {
  const router = useRouter();
  const [target, setTarget] = useState<LifePath | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const busy = target !== null || refreshing;
  const Icon = PATH_ICONS[path];
  const rows = scores.some((s) => s.path === path) ? scores : [...scores, { path, score: 0 }];

  async function choose(next: LifePath) {
    if (busy || next === path) return;
    setTarget(next);
    try {
      await api(ENDPOINTS[signedIn ? "user" : "draft"].finish, { method: "POST", json: { locale, confirm: false, path: next } }, { network: strings.failed, generic: strings.failed });
      track("path_changed", { from: path, to: next });
      startRefresh(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : strings.failed);
    } finally {
      setTarget(null);
    }
  }

  return (
    <section className="pane-ink relative min-w-0 overflow-hidden p-6 sm:p-8" aria-labelledby="path-title" aria-busy={busy}>
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex min-w-0 items-center gap-2 opacity-80">
          <ScoutDot live={busy} />
          <span className="truncate">{busy ? strings.planning : strings.eyebrow}</span>
        </p>
        <Link href="/app/start?q=situation" className="link shrink-0 text-[0.86rem] opacity-80">
          {strings.change}
        </Link>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
        <div className={cx("min-w-0 transition-opacity duration-300", busy && "opacity-40")}>
          <p className="flex items-center gap-2.5 text-[0.95rem] font-semibold">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
              <Icon size={19} aria-hidden />
            </span>
            {strings.paths[path]}
          </p>
          <h2 id="path-title" className="display mt-4 text-[2rem] leading-[1.06] sm:text-[2.6rem]">
            {headline}
          </h2>
          {reason ? <p className="mt-3 max-w-xl text-[1rem] leading-relaxed opacity-85">{reason}</p> : null}
          <p className="mt-5 max-w-xl text-[0.86rem] leading-relaxed opacity-60">
            {summary} · {strings.footer}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[0.8rem] font-semibold uppercase tracking-wide opacity-70">{strings.compass}</p>
          <ul className="mt-3 grid gap-1.5">
            {rows.map((s) => {
              const RowIcon = PATH_ICONS[s.path];
              const current = s.path === path;
              const pending = target === s.path;
              return (
                <li key={s.path}>
                  <button
                    type="button"
                    onClick={() => choose(s.path)}
                    disabled={busy && !pending}
                    aria-pressed={current}
                    className={cx(
                      "w-full rounded-[18px] px-3.5 py-2.5 text-left transition-colors duration-200 disabled:cursor-default",
                      current || pending ? "bg-[color:var(--pane-3)]" : "hover:bg-[color:var(--pane-2)] active:bg-[color:var(--pane-3)]",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3 text-[0.95rem]">
                      <span className="flex min-w-0 items-center gap-2">
                        <RowIcon size={16} className="shrink-0 opacity-80" aria-hidden />
                        <span className="truncate font-medium">{strings.paths[s.path]}</span>
                      </span>
                      <span className={cx("shrink-0 text-[0.78rem]", current ? "text-[color:var(--accent-2)]" : "opacity-60")}>
                        {pending ? strings.planning : current ? strings.current : strings.choose}
                      </span>
                    </span>
                    <span className="mt-2 block h-1.5 rounded-full bg-[color:var(--pane-3)]" aria-hidden>
                      <span
                        className="block h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${Math.max(4, Math.round(s.score * 100))}%`, background: current ? "var(--accent)" : "var(--ink-4)" }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
