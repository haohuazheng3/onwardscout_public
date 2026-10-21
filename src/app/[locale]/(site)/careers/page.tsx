import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, Pane, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { OCCUPATIONS } from "@/lib/core/occupations";
import { CAREERS_PATH, careerPath, occupationsByFunction, occupationsByIndustry } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "Careers: what every role can apply for",
    description:
      "Pick your role to see the programs, funding, events and calls people in it can apply for, the materials each application needs, and how Onward Scout prepares them.",
    path: CAREERS_PATH,
    englishOnly: true,
  });
}

function slugId(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export default async function CareersHub({ params }: Props) {
  const { locale } = await params;
  englishOnly(locale, CAREERS_PATH);
  const industries = occupationsByIndustry();
  const functions = occupationsByFunction();

  return (
    <>
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Careers", path: CAREERS_PATH }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Careers</p>
          <h1 className="display mt-3 text-[2.3rem] text-ink sm:text-[3.4rem]">What your role can apply for</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            {OCCUPATIONS.length} roles across {industries.length} industries. Each page shows what people in that role typically go after, from
            certifications and fellowships to speaking slots and grants, what every application asks for, and which listings are open right now.
          </p>
        </header>

        <nav aria-label="Jump to an industry" className="mt-7">
          <ul className="scroll-row -mx-4 px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {industries.map((g) => (
              <li key={g.industry}>
                <a href={`#ind-${slugId(g.industry)}`} className="chip">
                  {g.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <Section className="!pt-10 sm:!pt-14">
        <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">By industry</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {industries.map((g) => (
            <Pane key={g.industry} pad="md" className="min-w-0 scroll-mt-28" id={`ind-${slugId(g.industry)}`}>
              <h3 className="title text-[1.14rem] text-ink">{g.label}</h3>
              <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-1">
                {g.occupations.map((o) => (
                  <li key={o.code}>
                    <Link href={careerPath(o.code)} locale="en" className="inline-block rounded-full px-2.5 py-1.5 text-[0.92rem] text-ink-2 transition-colors hover:bg-pane-2 hover:text-ink active:bg-pane-3">
                      {o.label.en}
                    </Link>
                  </li>
                ))}
              </ul>
            </Pane>
          ))}
        </div>
      </Section>

      <Section className="!pt-14 sm:!pt-20">
        <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">By function</h2>
        <p className="mt-2 max-w-2xl text-[0.98rem] text-ink-3">The same kind of work shows up in many industries. A few roles per function:</p>
        <ul className="pane-grid mt-5">
          {functions.map((f) => (
            <li key={f.fn} className="pane min-w-0 p-5">
              <p className="flex items-baseline justify-between gap-3">
                <span className="title text-[1.06rem] text-ink">{f.label}</span>
                <span className="num text-[0.84rem] text-ink-4">{f.occupations.length} roles</span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
                {f.occupations.slice(0, 6).map((o) => (
                  <li key={o.code}>
                    <Link href={careerPath(o.code)} locale="en" className="inline-block rounded-full px-2 py-1 text-[0.88rem] text-ink-3 hover:bg-pane-2 hover:text-ink">
                      {o.label.en}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section className="!pt-16 pb-20 sm:!pt-24 sm:pb-28">
        <ScoutCta title="Not sure what your role can go after?" body="Drop in your résumé. Onward Scout maps your role, industry and goals, and shows the openings you can actually win, with every application prepared for your tap." />
      </Section>
    </>
  );
}
