import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { TypeCountTag } from "@/components/seo/TypeHubView";
import { englishOnly } from "@/components/seo/english-only";
import { Container, Section, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { MIN_INDEX_ITEMS, OPPORTUNITIES_PATH, getSeoData, typeCopy, typePath, typesByGroup } from "@/lib/programmatic";
import { itemListLd, pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Props = { params: Promise<{ locale: string }> };

const TITLE = "Opportunities you can apply for, checked at the source";
const DESCRIPTION =
  "Accelerators, grants, fellowships, scholarships, competitions, residencies, calls for papers, speaking slots and more: real programs linked to their official pages, with how to win each kind.";

export async function generateMetadata(): Promise<Metadata> {
  const data = await getSeoData();
  return pageMetadata({ title: TITLE, description: DESCRIPTION, path: OPPORTUNITIES_PATH, englishOnly: true, noindex: data.listings.length < MIN_INDEX_ITEMS });
}

/** The first sentence of a paragraph (hub cards show one line of guidance per type). */
function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text);
  return m ? m[1] : text;
}

export default async function OpportunitiesHub({ params }: Props) {
  const { locale } = await params;
  englishOnly(locale, OPPORTUNITIES_PATH);
  const { listings, counts } = await getSeoData();
  const groups = typesByGroup();
  const withListings = groups.flatMap((g) => g.types).filter((t) => (counts[t.id] ?? 0) > 0);

  return (
    <>
      {withListings.length ? (
        <JsonLd data={itemListLd({ name: "Opportunity types", path: OPPORTUNITIES_PATH, items: withListings.map((t) => ({ name: t.plural.en, path: typePath(t.slug) })) })} />
      ) : null}
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Opportunities", path: OPPORTUNITIES_PATH }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Opportunities</p>
          <h1 className="display mt-3 text-[2.3rem] text-ink sm:text-[3.4rem]">Real openings, checked at the source</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            Every listing here is a real program with its official link: we never invent a deadline, an amount or an eligibility rule, and anything we
            could not confirm says “check the official page”. Pick a kind to see what is open now and how to win it.
          </p>
          <p className="mt-4 text-[0.92rem] text-ink-3">
            {listings.length
              ? `${listings.length} open ${listings.length === 1 ? "listing" : "listings"} across ${withListings.length} ${withListings.length === 1 ? "kind" : "kinds"} of opportunity.`
              : "New listings are being checked against their official pages; each kind below already has its playbook."}
          </p>
        </header>
      </Container>

      {groups.map((g) => (
        <Section key={g.group} className="!pt-12 sm:!pt-16">
          <h2 className="headline text-[1.5rem] text-ink sm:text-[1.8rem]">{g.heading}</h2>
          <ul className="pane-grid mt-5">
            {g.types.map((t) => {
              const count = counts[t.id] ?? 0;
              return (
                <li key={t.id} className="flex min-w-0">
                  <Link
                    href={typePath(t.slug)}
                    locale="en"
                    className={cx("flex w-full min-w-0 flex-col p-5 sm:p-6", count ? "pane pane-hover" : "pane-inset transition-colors hover:bg-pane-3")}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="title text-[1.14rem] text-ink">{t.plural.en}</span>
                      <TypeCountTag count={count} />
                    </span>
                    <span className="mt-2 block text-[0.94rem] leading-relaxed text-ink-3">{firstSentence(typeCopy(t.id).intro)}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[0.88rem] font-semibold text-ink">
                      {count ? "See what is open" : "Read how to win these"} <ArrowUpRight size={14} aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}

      <Section className="!pt-16 pb-20 sm:!pt-24 sm:pb-28">
        <ScoutCta />
      </Section>
    </>
  );
}
