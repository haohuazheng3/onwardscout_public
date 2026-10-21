import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { TIMING_TONE } from "@/components/seo/ListingCard";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, Section, Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import { GUIDES_PATH, getReadyProgramGuides, getSeoData, playbookMeta, playbookPath, programGuidePath, timingOf, typesByGroup, renderTime } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "How-to-apply guides and playbooks",
    description:
      "Step-by-step guides to applying for real programs, plus a playbook for every kind of opportunity: timelines, materials checklists and honest answers to the questions applicants meet.",
    path: GUIDES_PATH,
    englishOnly: true,
  });
}

export default async function GuidesHub({ params }: Props) {
  const { locale } = await params;
  englishOnly(locale, GUIDES_PATH);
  const [{ counts }, programs] = await Promise.all([getSeoData(), getReadyProgramGuides()]);
  const groups = typesByGroup();
  const now = renderTime();

  return (
    <>
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Guides", path: GUIDES_PATH }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Guides</p>
          <h1 className="display mt-3 text-[2.3rem] text-ink sm:text-[3.3rem]">How to apply, step by step</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            A playbook for every kind of opportunity, and a step-by-step guide for each program whose official details are complete: who can apply, what
            to prepare, when to start and how to answer the questions honestly.
          </p>
        </header>
      </Container>

      {programs.length ? (
        <Section className="!pt-10 sm:!pt-12">
          <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">Program guides</h2>
          <ul className="pane mt-5 divide-y divide-[var(--line)] px-2">
            {programs.map((l) => {
              const timing = timingOf(l, now);
              return (
                <li key={l.slug}>
                  <Link
                    href={programGuidePath(l.slug)}
                    locale="en"
                    className="flex flex-col gap-1.5 rounded-[18px] px-4 py-4 transition-colors hover:bg-pane-2 active:bg-pane-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block text-[1.02rem] font-semibold leading-snug text-ink">How to apply to {l.name}</span>
                      <span className="mt-0.5 block text-[0.86rem] text-ink-3">
                        {getOpportunityType(l.type).label.en}
                        {l.orgName ? ` · ${l.orgName}` : ""}
                      </span>
                    </span>
                    <Tag tone={TIMING_TONE[timing.tone]} className="shrink-0 self-start sm:self-center">
                      {timing.tone === "rolling" ? "Rolling" : timing.label}
                    </Tag>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Section className="!pt-12 sm:!pt-16">
        <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">Playbooks by kind of opportunity</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.group} className="pane min-w-0 p-5 sm:p-6">
              <p className="eyebrow">{g.heading}</p>
              <ul className="mt-3 grid gap-1">
                {g.types.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={playbookPath(t.slug)}
                      locale="en"
                      className="flex items-center justify-between gap-3 rounded-[14px] px-2.5 py-2 text-[0.96rem] text-ink-2 transition-colors hover:bg-pane-2 hover:text-ink active:bg-pane-3"
                    >
                      <span className="min-w-0">{playbookMeta(t).title}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[0.8rem] text-ink-4">
                        {counts[t.id] ? <span className="num">{counts[t.id]} open</span> : null}
                        <ArrowUpRight size={14} aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section className="!pt-16 pb-20 sm:!pt-24 sm:pb-28">
        <ScoutCta title="Rather not do all this by hand?" />
      </Section>
    </>
  );
}
