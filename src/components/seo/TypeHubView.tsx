import { ArrowRight, BookOpen, Check } from "lucide-react";
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
  materialChecklist,
  opportunityPath,
  playbookPath,
  regionPath,
  regionPhrase,
  regionsOf,
  timelineFor,
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
 * static region pages, so filtering is instant and crawlable), the paginated grid, "how to win
 * these", the questions applicants meet, and the playbook link.
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
  const checklist = materialChecklist(def.materials);
  const steps = timelineFor(def.id);
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

      <Section className="!pt-14 sm:!pt-20">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Pane pad="lg" className="min-w-0">
            <p className="eyebrow eyebrow-accent">How to win these</p>
            <h2 className="headline mt-3 text-[1.6rem] text-ink sm:text-[1.9rem]">What reviewers of {plural.toLowerCase()} look for</h2>
            <ol className="mt-6 grid gap-3">
              {copy.win.map((tip, i) => (
                <li key={i} className="pane-inset flex gap-4 px-4 py-4 sm:px-5">
                  <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.9rem] font-semibold tabular-nums text-accent-text">
                    {i + 1}
                  </span>
                  <span className="min-w-0 text-[0.98rem] leading-relaxed text-ink-2">{tip}</span>
                </li>
              ))}
            </ol>
          </Pane>
          <Pane pad="lg" className="min-w-0">
            <p className="eyebrow">What you will usually need</p>
            <ul className="mt-4 grid gap-3">
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
            <Link href={playbookPath(def.slug)} locale="en" className="btn btn-ghost btn-sm mt-6">
              <BookOpen size={16} aria-hidden />
              <span className="btn-label">Full playbook for {plural.toLowerCase()}</span>
            </Link>
          </Pane>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {copy.questions.map((qa) => (
            <Pane key={qa.q} pad="md" className="min-w-0">
              <p className="eyebrow">A question you will meet</p>
              <h3 className="title mt-2 text-[1.12rem] text-ink">{qa.q}</h3>
              <p className="mt-2 text-[0.96rem] leading-relaxed text-ink-2">{qa.a}</p>
            </Pane>
          ))}
        </div>

        <Pane pad="md" className="mt-4 min-w-0">
          <p className="eyebrow">A typical preparation timeline</p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.title} className="pane-inset min-w-0 px-4 py-4">
                <span className="num text-[0.82rem] font-semibold text-accent-text">{s.daysBefore > 0 ? `${s.daysBefore} days before` : "Deadline day"}</span>
                <span className="mt-1 block font-semibold text-ink">{s.title}</span>
                <span className="mt-1 block text-[0.9rem] leading-snug text-ink-3">{s.text}</span>
              </li>
            ))}
          </ol>
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
