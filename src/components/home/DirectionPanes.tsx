import { ArrowRight, Target } from "lucide-react";
import { ButtonLink, Progress } from "@/components/ui";
import { Link } from "@/i18n/navigation";

/*
 * The top of the dashboard after onboarding: where the person is heading (the directions Onward
 * Scout set from their answers, each with its reason) and what happens next. Server components;
 * strings arrive translated.
 */

export interface DirectionGoal {
  id: string;
  label: string;
  successDefinition: string | null;
  /** Why Onward Scout set this direction (from onboarding's analysis). */
  rationale: string | null;
  milestones: { id: string; title: string; target: number; progress: number }[];
}

export function DirectionPane({
  summary,
  goals,
  strings,
}: {
  summary: string | null;
  goals: DirectionGoal[];
  strings: { eyebrow: string; change: string; empty: string; emptyBody: string; start: string; also: string };
}) {
  if (!goals.length) {
    return (
      <section className="pane-ink min-w-0 p-6 sm:p-8" aria-labelledby="direction-title">
        <p className="eyebrow text-[color:var(--ink-3)]">{strings.eyebrow}</p>
        <h2 id="direction-title" className="headline mt-3 text-[1.6rem] sm:text-[2rem]">
          {strings.empty}
        </h2>
        <p className="mt-2 max-w-lg text-[0.98rem] leading-relaxed opacity-80">{strings.emptyBody}</p>
        <ButtonLink href="/app/start" className="mt-5" variant="primary" iconRight={<ArrowRight size={17} aria-hidden />}>
          {strings.start}
        </ButtonLink>
      </section>
    );
  }
  const [lead, ...rest] = goals;
  return (
    <section className="pane-ink min-w-0 p-6 sm:p-8" aria-labelledby="direction-title">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow flex min-w-0 items-center gap-2 opacity-80">
          <Target size={14} className="shrink-0" aria-hidden />
          <span className="truncate">{strings.eyebrow}</span>
        </p>
        <Link href="/app/start?q=situation" className="link shrink-0 text-[0.86rem] opacity-80">
          {strings.change}
        </Link>
      </div>
      {summary ? <p className="mt-3 max-w-xl text-[0.98rem] leading-relaxed opacity-80">{summary}</p> : null}
      <h2 id="direction-title" className="headline mt-4 text-[1.55rem] leading-tight sm:text-[2rem]">
        {lead!.label}
      </h2>
      {lead!.rationale ? <p className="mt-2 max-w-xl text-[1rem] leading-relaxed">{lead!.rationale}</p> : null}
      {lead!.successDefinition ? <p className="mt-2 text-[0.9rem] opacity-70">{lead!.successDefinition}</p> : null}
      {lead!.milestones.length ? (
        <ul className="mt-6 grid gap-4">
          {lead!.milestones.slice(0, 3).map((m) => (
            <li key={m.id}>
              <Progress value={Math.min(m.progress, m.target)} max={m.target} label={m.title} showValue />
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-[0.84rem] font-semibold uppercase tracking-wide opacity-70">{strings.also}</p>
          <ul className="mt-3 grid gap-3">
            {rest.map((g) => (
              <li key={g.id} className="min-w-0">
                <p className="text-[1.05rem] font-semibold leading-snug">{g.label}</p>
                {g.rationale ? <p className="mt-0.5 text-[0.92rem] leading-relaxed opacity-80">{g.rationale}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** `external`: the href is already a full path (the localized sign-in link), not a page to localize. */
export function NextStepsPane({ title, steps }: { title: string; steps: { text: string; href?: string; cta?: string; external?: boolean }[] }) {
  return (
    <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="next-title">
      <h2 id="next-title" className="title text-[1.2rem] text-ink">
        {title}
      </h2>
      <ol className="mt-4 grid gap-3.5">
        {steps.map((s, i) => (
          <li key={i} className="flex min-w-0 gap-3">
            <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pine-soft text-[0.85rem] font-semibold text-pine">{i + 1}</span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[0.98rem] leading-relaxed text-ink-2">{s.text}</p>
              {s.href && s.cta ? (
                <ButtonLink href={s.href} external={s.external} size="sm" className="mt-2.5" iconRight={<ArrowRight size={15} aria-hidden />}>
                  {s.cta}
                </ButtonLink>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
