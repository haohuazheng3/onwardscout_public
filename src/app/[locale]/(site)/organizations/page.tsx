import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, EmptyState, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import { OPPORTUNITIES_PATH, ORGANIZATIONS_PATH, ORG_MIN_ITEMS, getSeoData, orgPath, organizationsOf } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { listings } = await getSeoData();
  const orgs = organizationsOf(listings);
  return pageMetadata({
    title: "Organizations with open opportunities",
    description: "Foundations, accelerators, universities, conferences and agencies running several open programs at once, each with its official links.",
    path: ORGANIZATIONS_PATH,
    englishOnly: true,
    noindex: orgs.length < 3,
  });
}

export default async function OrganizationsHub({ params }: Props) {
  const { locale } = await params;
  englishOnly(locale, ORGANIZATIONS_PATH);
  const { listings } = await getSeoData();
  const orgs = organizationsOf(listings);

  return (
    <>
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Organizations", path: ORGANIZATIONS_PATH }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Organizations</p>
          <h1 className="display mt-3 text-[2.3rem] text-ink sm:text-[3.3rem]">Who is running open programs</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            Organizations with at least {ORG_MIN_ITEMS} programs open right now. Each page lists everything they have open, with deadlines and official
            links.
          </p>
        </header>
      </Container>

      <Section className="!pt-10 sm:!pt-12">
        {orgs.length ? (
          <ul className="pane-grid">
            {orgs.map((o) => (
              <li key={o.slug} className="flex min-w-0">
                <Link href={orgPath(o.slug)} locale="en" className="pane pane-hover flex w-full min-w-0 flex-col p-5 sm:p-6">
                  <span className="title text-[1.1rem] text-ink">{o.name}</span>
                  <span className="mt-2 text-[0.9rem] text-ink-3">
                    {o.count} open · {o.types.map((t) => getOpportunityType(t).plural.en.toLowerCase()).slice(0, 3).join(", ")}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[0.88rem] font-semibold text-ink">
                    See all <ArrowUpRight size={14} aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No organization has several programs open right now"
            body="Organizations appear here when two or more of their programs are open at the same time. Every open listing is still on the opportunities pages."
            action={
              <Link href={OPPORTUNITIES_PATH} locale="en" className="btn btn-ghost btn-sm">
                Browse opportunities
              </Link>
            }
          />
        )}
      </Section>

      <Section className="!pt-16 pb-20 sm:!pt-24 sm:pb-28">
        <ScoutCta />
      </Section>
    </>
  );
}
