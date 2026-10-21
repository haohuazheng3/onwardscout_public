import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ListingCard } from "@/components/seo/ListingCard";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, Pane, Section, Tag } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import { needsAn } from "@/lib/core/success";
import { topLevelIndustry } from "@/lib/core/industries";
import {
  CAREERS_PATH,
  careerPath,
  careerProfile,
  careerQualityFor,
  functionName,
  getIndexableTargets,
  getSeoData,
  industryName,
  materialChecklist,
  typePath,
  renderTime,
} from "@/lib/programmatic";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; occupation: string }> };

/** Prerender the careers that pass the quality rule; the rest render on first visit. */
export async function generateStaticParams({ params }: { params: { locale?: string } }) {
  if (params?.locale && params.locale !== "en") return [];
  const { careers } = await getIndexableTargets();
  return careers.map((c) => ({ occupation: c.code }));
}

function article(label: string): string {
  return `${needsAn(label) ? "an" : "a"} ${label}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { occupation } = await params;
  const profile = careerProfile(occupation);
  if (!profile) return {};
  const data = await getSeoData();
  const quality = careerQualityFor(profile, data);
  const label = profile.occupation.label.en;
  return pageMetadata({
    title: `${label}: what to apply for and how to win it`,
    description: `Programs, funding, events and calls open to anyone working as ${article(label)}, the materials each application needs, and how Onward Scout prepares them from your résumé.`,
    path: careerPath(profile.occupation.code),
    englishOnly: true,
    // Quality rule (careerQuality): indexed only with role-specific live listings behind it.
    noindex: !quality.indexable,
  });
}

export default async function CareerPage({ params }: Props) {
  const { locale, occupation } = await params;
  englishOnly(locale, careerPath(occupation));
  const profile = careerProfile(occupation);
  if (!profile) notFound();
  const data = await getSeoData();
  const { matched } = careerQualityFor(profile, data);
  const occ = profile.occupation;
  const label = occ.label.en;
  const path = careerPath(occ.code);
  const now = renderTime();
  const checklist = materialChecklist(profile.materials.slice(0, 8));
  const industry = industryName(topLevelIndustry(occ.industry));
  const sub = occ.industry.includes(".") ? industryName(occ.industry) : null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `${label}: what to apply for`,
          url: absoluteUrl(path),
          inLanguage: "en",
          isPartOf: { "@id": `${SITE.url}/#website` },
          publisher: { "@id": `${SITE.url}/#organization` },
          about: { "@type": "Occupation", name: label, occupationalCategory: functionName(occ.function) },
        }}
      />
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Careers", path: CAREERS_PATH }, { name: label, path }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">
            {sub ?? industry} · {functionName(occ.function)}
          </p>
          <h1 className="display mt-3 text-[2.2rem] text-ink sm:text-[3.1rem]">{label}</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            What people working as {article(label)} can apply for, what each application asks for, and how Onward Scout prepares it from the résumé you
            already have.
          </p>
        </header>
      </Container>

      {matched.length ? (
        <Section className="!pt-10 sm:!pt-12">
          <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">Open now and relevant to this role</h2>
          <p className="mt-2 max-w-2xl text-[0.96rem] text-ink-3">Matched by field and subject from each listing&rsquo;s own description. Each one links to its official page.</p>
          <ul className="pane-grid mt-5">
            {matched.slice(0, 9).map((l) => (
              <li key={l.slug} className="flex min-w-0">
                <ListingCard listing={l} now={now} showType className="w-full" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section className="!pt-12 sm:!pt-16">
        <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">What you can go after</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {profile.goals.map((g) => (
            <Pane key={g.family} pad="md" className="min-w-0">
              <p className="eyebrow">{g.label}</p>
              <ul className="mt-3 grid gap-3">
                {g.subGoals.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <span className="block font-medium text-ink">{s.label}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {s.types.map((t) => {
                        const def = getOpportunityType(t);
                        const count = data.counts[t] ?? 0;
                        return def.publicSeo ? (
                          <Link key={t} href={typePath(def.slug)} locale="en" className="tag hover:text-ink">
                            {def.plural.en}
                            {count ? <span className="num ml-1 text-ink-4">{count}</span> : null}
                          </Link>
                        ) : (
                          <Tag key={t} tone="ink" title="Matched privately inside your Scout board">
                            {def.plural.en}
                          </Tag>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </Pane>
          ))}
        </div>
        {profile.privateTypes.length ? (
          <p className="mt-4 max-w-3xl text-[0.9rem] leading-relaxed text-ink-3">
            Dark labels ({profile.privateTypes.map((t) => getOpportunityType(t).plural.en.toLowerCase()).slice(0, 4).join(", ")}
            {profile.privateTypes.length > 4 ? "…" : ""}) are matched inside your own Scout board from live company postings and contacts, not listed publicly.
          </p>
        ) : null}
      </Section>

      <Section className="!pt-12 sm:!pt-16">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Pane pad="lg" className="min-w-0">
            <p className="eyebrow eyebrow-accent">Typical materials</p>
            <h2 className="headline mt-3 text-[1.5rem] text-ink sm:text-[1.8rem]">What these applications ask for, and who prepares it</h2>
            <ul className="mt-5 grid gap-3">
              {checklist.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Check size={18} aria-hidden className="mt-[3px] shrink-0 text-pine" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{c.label}</span>
                    <span className="block text-[0.88rem] leading-snug text-ink-3">{c.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Pane>
          <Pane pad="lg" className="min-w-0">
            <p className="eyebrow">Related roles</p>
            <ul className="mt-3">
              {profile.related.map((r) => (
                <li key={r.code}>
                  <Link
                    href={careerPath(r.code)}
                    locale="en"
                    className="flex items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 text-[0.98rem] text-ink-2 transition-colors hover:bg-pane-2 hover:text-ink active:bg-pane-3"
                  >
                    <span className="min-w-0 truncate">{r.label.en}</span>
                    <ArrowUpRight size={15} aria-hidden className="shrink-0 text-ink-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </Pane>
        </div>
      </Section>

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta
          title={`Applying as ${article(label)}? Let your scout prepare it.`}
          body="Drop in your résumé. Onward Scout builds a sourced profile, finds the openings you can win and prepares each application from your own facts. You approve every one with a tap."
        />
      </Section>
    </>
  );
}
