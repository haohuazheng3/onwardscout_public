import { ArrowRight, BookOpen } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs, type Crumb } from "@/components/seo/Breadcrumbs";
import { ListingCard } from "@/components/seo/ListingCard";
import { Pagination } from "@/components/seo/Pagination";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { Container, EmptyState, Pane, Section, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import type { OpportunityTypeDef } from "@/lib/core/opportunity-types";
import {
  LIST_PAGE_SIZE,
  OPPORTUNITIES_PATH,
  REGION_IDS,
  REGION_LABELS,
  opportunityPath,
  playbookPath,
  regionPath,
  regionPhrase,
  regionsOf,
  typeCopy,
  typePath,
  type PublicListing,
  type RegionId,
} from "@/lib/programmatic";
import { itemListLd } from "@/lib/seo";

/** Regions present in a set of listings, with counts, in the fixed region order. */
export function regionCounts(listings: PublicListing[]): { region: RegionId; count: number }[] {
  const counts = new Map<RegionId, number>();
  for (const l of listings) for (const r of regionsOf(l.geo)) counts.set(r, (counts.get(r) ?? 0) + 1);
  return REGION_IDS.filter((r) => counts.has(r)).map((r) => ({ region: r, count: counts.get(r) ?? 0 }));
}

/**
 * /opportunities/<type>, its later pages and its region pages: intro, region filter (links to
 * static region pages, so filtering is instant and crawlable), the paginated grid and the link
 * to the type's playbook (which alone carries the advice, so hub and playbook never duplicate).
 */
export function TypeHubView({
  def,
  all,
  shown,
  page,
  totalPages,
  region,
  now,
}: {
  def: OpportunityTypeDef;
  /** Every live listing of the type (for region counts). */
  all: PublicListing[];
  /** The listings on this page. */
  shown: PublicListing[];
  page: number;
  totalPages: number;
  region: RegionId | null;
  now: number;
}) {
  const copy = typeCopy(def.id);
  const plural = def.plural.en;
  const regions = regionCounts(all);
  const selfPath = region ? regionPath(def.slug, region) : typePath(def.slug, page);
  const heading = region ? `${plural} ${regionPhrase(region)}` : plural;
  const crumbs: Crumb[] = [
    { name: "Opportunities", path: OPPORTUNITIES_PATH },
    { name: plural, path: typePath(def.slug) },
    ...(region ? [{ name: REGION_LABELS[region], path: selfPath }] : page > 1 ? [{ name: `Page ${page}`, path: selfPath }] : []),
  ];
  const offset = (page - 1) * LIST_PAGE_SIZE;

  return (
    <>
      {shown.length ? (
        <JsonLd
          data={itemListLd({
            name: heading,
            path: selfPath,
            items: shown.map((l) => ({ name: l.name, path: opportunityPath(l.type, l.slug) })),
          })}
        />
      ) : null}
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={crumbs} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">{region ? REGION_LABELS[region] : "Opportunities"}</p>
          <h1 className="display mt-3 text-[2.2rem] text-ink sm:text-[3.1rem]">{heading}</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">{copy.intro}</p>
          <p className="mt-4 text-[0.92rem] text-ink-3">
            {all.length === 0
              ? "Nothing is open in this category right now."
              : region
                ? `${shown.length} open ${shown.length === 1 ? "listing" : "listings"} here, out of ${all.length} in this category.`
                : `${all.length} open ${all.length === 1 ? "listing" : "listings"}, each checked against its official page.`}
          </p>
        </header>

        {regions.length > 1 || region ? (
          <nav aria-label="Filter by region" className="mt-7">
            <ul className="scroll-row -mx-4 px-4 pb-1 sm:mx-0 sm:px-0">
              <li>
                <Link href={typePath(def.slug)} locale="en" className="chip" data-selected={region ? undefined : "true"} aria-current={region ? undefined : "page"}>
                  All regions <span className="num text-[0.8em] opacity-70">{all.length}</span>
                </Link>
              </li>
              {regions.map(({ region: r, count }) => (
                <li key={r}>
                  <Link
                    href={regionPath(def.slug, r)}
                    locale="en"
                    className="chip"
                    data-selected={r === region ? "true" : undefined}
                    aria-current={r === region ? "page" : undefined}
                  >
                    {REGION_LABELS[r]} <span className="num text-[0.8em] opacity-70">{count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </Container>

      <Section className="!pt-8 sm:!pt-10">
        {shown.length ? (
          <>
            <ol className="pane-grid" start={offset + 1}>
              {shown.map((l) => (
                <li key={l.slug} className="flex min-w-0">
                  <ListingCard listing={l} now={now} className="w-full" />
                </li>
              ))}
            </ol>
            <Pagination className="mt-8" page={page} totalPages={totalPages} href={(n) => typePath(def.slug, n)} />
          </>
        ) : (
          <EmptyState
            title={region ? `No ${plural.toLowerCase()} ${regionPhrase(region)} are open right now` : `No ${plural.toLowerCase()} are open right now`}
            body="Listings appear here as soon as their official pages have been checked. The playbook below explains how these are judged, so you can prepare before the next round opens."
            action={
              <>
                <Link href={playbookPath(def.slug)} locale="en" className="btn btn-ghost btn-sm">
                  Read the playbook
                </Link>
                <Link href={OPPORTUNITIES_PATH} locale="en" className="btn btn-quiet btn-sm">
                  All opportunity types
                </Link>
              </>
            }
          />
        )}
      </Section>

      {/* The advice (what reviewers look for, materials, questions, timeline) lives on one page,
          the playbook; the hub carries the listings and points there, so the two never duplicate. */}
      <Section className="!pt-14 sm:!pt-20">
        <Pane pad="lg" className="min-w-0">
          <p className="eyebrow eyebrow-accent">How to win these</p>
          <h2 className="headline mt-3 text-[1.6rem] text-ink sm:text-[1.9rem]">The playbook for {plural.toLowerCase()}</h2>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-ink-2">
            What reviewers look for, the materials you will usually need, the questions you will meet and a preparation timeline, on one page.
          </p>
          <Link href={playbookPath(def.slug)} locale="en" className="btn btn-ghost btn-sm mt-6">
            <BookOpen size={16} aria-hidden />
            <span className="btn-label">Read the playbook for {plural.toLowerCase()}</span>
          </Link>
        </Pane>
      </Section>

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta title={`Let Onward Scout prepare your ${plural.toLowerCase()} applications`} />
        <p className="mt-6 text-center text-[0.9rem] text-ink-3">
          <Link href={OPPORTUNITIES_PATH} locale="en" className={cx("link inline-flex items-center gap-1")}>
            Browse every kind of opportunity <ArrowRight size={14} aria-hidden />
          </Link>
        </p>
      </Section>
    </>
  );
}

export function TypeCountTag({ count }: { count: number }) {
  return <Tag tone={count ? "pine" : "default"}>{count ? `${count} open` : "None open now"}</Tag>;
}
