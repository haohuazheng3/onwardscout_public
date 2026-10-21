import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, ExternalLink } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ListingCard } from "@/components/seo/ListingCard";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { ButtonLink, Container, Pane, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import {
  CHANNEL_HELP,
  GUIDES_PATH,
  buildProgramGuide,
  formatDay,
  getReadyProgramGuides,
  getSeoData,
  hubIndexable,
  materialChecklist,
  opportunityPath,
  playbookMeta,
  playbookPath,
  programGuidePath,
  publicTypesInOrder,
  resolveGuide,
  timelineFor,
  typeCopy,
  typePath,
  type ChecklistItem,
  type DatedStep,
  type QA,
  renderTime,
} from "@/lib/programmatic";
import { howToLd, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateStaticParams({ params }: { params: { locale?: string } }) {
  if (params?.locale && params.locale !== "en") return [];
  const programs = await getReadyProgramGuides();
  return [
    ...publicTypesInOrder().map((t) => ({ slug: playbookPath(t.slug).slice("/guides/".length) })),
    ...programs.map((l) => ({ slug: programGuidePath(l.slug).slice("/guides/".length) })),
  ];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolveGuide(slug);
  if (!r) return {};
  if (r.kind === "playbook") {
    const { counts } = await getSeoData();
    const meta = playbookMeta(r.def);
    return pageMetadata({ ...meta, path: r.path, englishOnly: true, noindex: !hubIndexable(counts[r.def.id] ?? 0) });
  }
  const g = buildProgramGuide(r.detail);
  return pageMetadata({ title: g.title, description: g.description, path: r.path, englishOnly: true, image: `/og/opportunity/${r.detail.slug}` });
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="mt-4 grid gap-3">
      {items.map((c) => (
        <li key={c.id} className="flex gap-3">
          <Check size={18} aria-hidden className="mt-[3px] shrink-0 text-pine" />
          <span className="min-w-0">
            <span className="block font-medium text-ink">{c.label}</span>
            <span className="block text-[0.88rem] leading-snug text-ink-3">{c.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ steps, anchors = false }: { steps: DatedStep[]; anchors?: boolean }) {
  return (
    <ol className="mt-4 grid gap-3">
      {steps.map((s, i) => (
        <li key={s.title} id={anchors ? `step-${i + 1}` : undefined} className="pane-inset flex min-w-0 scroll-mt-28 gap-4 px-4 py-4 sm:px-5">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.9rem] font-semibold tabular-nums text-accent-text">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[0.82rem] font-semibold text-accent-text">
              {s.by ? `By ${formatDay(s.by)}` : s.daysBefore > 0 ? `${s.daysBefore} days before the deadline` : "On the deadline"}
            </span>
            <span className="mt-0.5 block font-semibold text-ink">{s.title}</span>
            <span className="mt-1 block text-[0.94rem] leading-relaxed text-ink-2">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Questions({ items }: { items: QA[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((qa) => (
        <Pane key={qa.q} pad="md" className="min-w-0">
          <h3 className="title text-[1.1rem] text-ink">{qa.q}</h3>
          <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-2">{qa.a}</p>
        </Pane>
      ))}
    </div>
  );
}

export default async function GuidePage({ params }: Props) {
  const { locale, slug } = await params;
  englishOnly(locale, `${GUIDES_PATH}/${slug}`);
  const r = await resolveGuide(slug);
  if (!r) notFound();
  const now = renderTime();

  if (r.kind === "playbook") {
    const def = r.def;
    const copy = typeCopy(def.id);
    const meta = playbookMeta(def);
    const steps: DatedStep[] = timelineFor(def.id).map((s) => ({ ...s, by: null }));
    const [{ listings }, programs] = await Promise.all([getSeoData(), getReadyProgramGuides()]);
    const examples = listings.filter((l) => l.type === def.id).slice(0, 6);
    const typePrograms = programs.filter((l) => l.type === def.id).slice(0, 8);
    return (
      <>
        <JsonLd
          data={howToLd({
            name: meta.title,
            description: meta.description,
            path: r.path,
            steps: steps.map((s) => ({ name: s.title, text: s.text })),
            supplies: materialChecklist(def.materials).map((c) => c.label),
          })}
        />
        <Container className="pt-8 sm:pt-12">
          <Breadcrumbs items={[{ name: "Guides", path: GUIDES_PATH }, { name: def.plural.en, path: r.path }]} />
          <header className="mt-6 max-w-3xl">
            <p className="eyebrow eyebrow-dot">Playbook</p>
            <h1 className="display mt-3 text-[2.2rem] text-ink sm:text-[3.1rem]">{meta.title}</h1>
            <p className="lede mt-4 sm:text-[1.12rem]">{copy.intro}</p>
          </header>
        </Container>

        <Section className="!pt-10 sm:!pt-12">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow eyebrow-accent">How these are won</h2>
              <ol className="mt-4 grid gap-3">
                {copy.win.map((tip, i) => (
                  <li key={i} className="flex gap-3 text-[1rem] leading-relaxed text-ink-2">
                    <span aria-hidden className="num mt-[1px] w-5 shrink-0 font-semibold text-accent-text">
                      {i + 1}.
                    </span>
                    <span className="min-w-0">{tip}</span>
                  </li>
                ))}
              </ol>
            </Pane>
            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">Materials checklist</h2>
              <Checklist items={materialChecklist(def.materials)} />
            </Pane>
          </div>
        </Section>

        <Section className="!pt-12 sm:!pt-14">
          <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">A preparation timeline</h2>
          <p className="mt-2 max-w-2xl text-[0.96rem] text-ink-3">Counted back from the deadline. Each program guide puts real dates on it.</p>
          <Timeline steps={steps} anchors />
        </Section>

        <Section className="!pt-12 sm:!pt-14">
          <h2 className="headline mb-5 text-[1.5rem] text-ink sm:text-[1.8rem]">Questions you will meet, answered honestly</h2>
          <Questions items={copy.questions} />
          <Pane pad="md" className="mt-4 min-w-0">
            <h2 className="eyebrow eyebrow-accent">How Onward Scout helps</h2>
            <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-2">{CHANNEL_HELP[def.defaultChannel]}</p>
          </Pane>
        </Section>

        {typePrograms.length || examples.length ? (
          <Section className="!pt-12 sm:!pt-14">
            <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">Open now</h2>
            {typePrograms.length ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {typePrograms.map((l) => (
                  <li key={l.slug}>
                    <Link href={programGuidePath(l.slug)} locale="en" className="chip">
                      Guide: {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {examples.length ? (
              <ul className="pane-grid mt-5">
                {examples.map((l) => (
                  <li key={l.slug} className="flex min-w-0">
                    <ListingCard listing={l} now={now} className="w-full" />
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href={typePath(def.slug)} locale="en" className="link mt-6 inline-flex items-center gap-1 text-[0.94rem]">
              All open {def.plural.en.toLowerCase()} <ArrowUpRight size={14} aria-hidden />
            </Link>
          </Section>
        ) : null}

        <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
          <ScoutCta title={`Let Onward Scout prepare your ${def.plural.en.toLowerCase()} applications`} />
        </Section>
      </>
    );
  }

  const d = r.detail;
  const g = buildProgramGuide(d, now);
  const def = getOpportunityType(d.type);
  const listingPath = opportunityPath(d.type, d.slug);
  const officialUrl = d.apply.url ?? d.url;

  return (
    <>
      <JsonLd
        data={howToLd({
          name: g.title,
          description: g.description,
          path: r.path,
          steps: g.steps.map((s) => ({ name: s.name, text: s.text })),
          supplies: g.checklist.map((c) => c.label),
        })}
      />
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Guides", path: GUIDES_PATH }, { name: def.plural.en, path: playbookPath(def.slug) }, { name: d.name, path: r.path }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Program guide</p>
          <h1 className="display mt-3 text-[2.1rem] text-ink sm:text-[3rem]">{g.title}</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">{d.summary}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {officialUrl ? (
              <ButtonLink href={officialUrl} variant="ghost" external icon={<ExternalLink size={16} aria-hidden />}>
                Official page
              </ButtonLink>
            ) : null}
            <ButtonLink href={listingPath} locale="en" variant="quiet">
              Listing details
            </ButtonLink>
          </div>
        </header>
      </Container>

      <Section className="!pt-10 sm:!pt-12">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-4">
            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">Step by step</h2>
              <ol className="mt-4 grid gap-4">
                {g.steps.map((s, i) => (
                  <li key={s.name} id={`step-${i + 1}`} className="flex scroll-mt-28 gap-4">
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.9rem] font-semibold tabular-nums text-accent-text">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{s.name}</span>
                      <span className="mt-1 block text-[0.96rem] leading-relaxed text-ink-2">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Pane>
            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">Timeline</h2>
              <Timeline steps={g.timeline} />
            </Pane>
          </div>
          <aside className="grid min-w-0 content-start gap-4">
            <Pane pad="md" className="min-w-0">
              <h2 className="eyebrow">At a glance</h2>
              <dl className="mt-2">
                {g.facts.map((f, i) => (
                  <div key={`${f.label}-${i}`} className="border-b border-[var(--line)] py-3 last:border-b-0">
                    <dt className="eyebrow">{f.label}</dt>
                    <dd className="mt-1 text-[0.96rem] leading-relaxed text-ink">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </Pane>
            <Pane pad="md" className="min-w-0">
              <h2 className="eyebrow">Who can apply</h2>
              <ul className="mt-3 grid gap-2">
                {g.eligibility.map((e) => (
                  <li key={e} className="flex gap-2.5 text-[0.95rem] leading-relaxed text-ink-2">
                    <Check size={16} aria-hidden className="mt-[4px] shrink-0 text-pine" />
                    <span className="min-w-0">{e}</span>
                  </li>
                ))}
              </ul>
            </Pane>
            <Pane pad="md" className="min-w-0">
              <h2 className="eyebrow">Materials checklist</h2>
              <Checklist items={g.checklist} />
            </Pane>
          </aside>
        </div>
      </Section>

      <Section className="!pt-12 sm:!pt-14">
        <h2 className="headline mb-5 text-[1.5rem] text-ink sm:text-[1.8rem]">Questions you will meet, answered honestly</h2>
        <Questions items={g.questions} />
        <Pane pad="md" className="mt-4 min-w-0">
          <h2 className="eyebrow">What reviewers of {def.plural.en.toLowerCase()} look for</h2>
          <ul className="mt-3 grid gap-2">
            {g.win.map((w) => (
              <li key={w} className="flex gap-2.5 text-[0.96rem] leading-relaxed text-ink-2">
                <Check size={16} aria-hidden className="mt-[4px] shrink-0 text-pine" />
                <span className="min-w-0">{w}</span>
              </li>
            ))}
          </ul>
          <Link href={playbookPath(def.slug)} locale="en" className="link mt-4 inline-flex items-center gap-1 text-[0.92rem]">
            The full playbook for {def.plural.en.toLowerCase()} <ArrowUpRight size={14} aria-hidden />
          </Link>
        </Pane>
        <Pane pad="md" className="mt-4 min-w-0">
          <h2 className="eyebrow eyebrow-accent">How Onward Scout helps</h2>
          <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-2">{g.help}</p>
        </Pane>
      </Section>

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta
          title={`Let Onward Scout prepare your ${d.name} application`}
          body="Drop in your résumé, deck or portfolio. Onward Scout checks the fit, drafts every answer from your own documents with sources, and waits for your tap."
          secondary={{ href: `/app/scout/${d.id}`, label: "Open it in your Scout board" }}
        />
      </Section>
    </>
  );
}
