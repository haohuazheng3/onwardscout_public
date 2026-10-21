import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ListingCard } from "@/components/seo/ListingCard";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import type { OpportunityTypeId } from "@/lib/core/types";
import { ORGANIZATIONS_PATH, getSeoData, isValidSlug, listingsOfOrg, opportunityPath, orgIndexable, orgPath, organizationsOf, renderTime } from "@/lib/programmatic";
import { itemListLd, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateStaticParams({ params }: { params: { locale?: string } }) {
  if (params?.locale && params.locale !== "en") return [];
  const { listings } = await getSeoData();
  return organizationsOf(listings).map((o) => ({ slug: o.slug }));
}

function typesLine(types: OpportunityTypeId[]): string {
  const names = [...new Set(types)].map((t) => getOpportunityType(t).plural.en.toLowerCase());
  if (names.length <= 1) return names[0] ?? "programs";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidSlug(slug)) return {};
  const listings = await listingsOfOrg(slug);
  if (!listings.length) return {};
  const name = listings[0].orgName ?? slug;
  return pageMetadata({
    title: `${name}: ${listings.length} open ${listings.length === 1 ? "opportunity" : "opportunities"}`,
    description: `Every open ${typesLine(listings.map((l) => l.type))} from ${name}, with deadlines, eligibility and official links, and how to prepare each application.`,
    path: orgPath(slug),
    englishOnly: true,
    noindex: !orgIndexable(listings.length),
  });
}

export default async function OrganizationPage({ params }: Props) {
  const { locale, slug } = await params;
  englishOnly(locale, orgPath(slug));
  if (!isValidSlug(slug)) notFound();
  const listings = await listingsOfOrg(slug);
  // A page exists for organizations with open listings; one listing renders (noindex) so old links keep working.
  if (!listings.length) notFound();
  const name = listings[0].orgName ?? slug;
  const now = renderTime();
  const path = orgPath(slug);
  const { listings: all } = await getSeoData();
  const others = organizationsOf(all)
    .filter((o) => o.slug !== slug && o.types.some((t) => listings.some((l) => l.type === t)))
    .slice(0, 8);

  return (
    <>
      <JsonLd
        data={itemListLd({
          name: `Open opportunities from ${name}`,
          path,
          items: listings.map((l) => ({ name: l.name, path: opportunityPath(l.type, l.slug) })),
        })}
      />
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Organizations", path: ORGANIZATIONS_PATH }, { name, path }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Organization</p>
          <h1 className="display mt-3 text-[2.2rem] text-ink sm:text-[3.1rem]">{name}</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            {listings.length} open {listings.length === 1 ? "opportunity" : "opportunities"}: {typesLine(listings.map((l) => l.type))}. Dates, amounts and rules
            come from each official page; anything not published there says so.
          </p>
        </header>
      </Container>

      <Section className="!pt-10 sm:!pt-12">
        <ul className="pane-grid">
          {listings.map((l) => (
            <li key={l.slug} className="flex min-w-0">
              <ListingCard listing={l} now={now} showType className="w-full" />
            </li>
          ))}
        </ul>
      </Section>

      {others.length ? (
        <Section className="!pt-14 sm:!pt-16">
          <h2 className="eyebrow">Organizations running similar programs</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={orgPath(o.slug)} locale="en" className="chip">
                  {o.name} <span className="num text-[0.8em] opacity-70">{o.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta title={`Applying to ${name}?`} body="Drop in what you already have. Onward Scout checks which of these programs fit you and prepares each application from your own documents, ready for your tap." />
      </Section>
    </>
  );
}
