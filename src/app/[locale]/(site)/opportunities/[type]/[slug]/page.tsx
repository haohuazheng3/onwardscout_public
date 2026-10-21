import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight, BookOpen, Check, CircleAlert, ExternalLink, MapPin } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ListingCard, ListingRow, TIMING_TONE } from "@/components/seo/ListingCard";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { ButtonLink, Callout, Container, Pane, Section, Tag } from "@/components/ui";
import { Link, permanentRedirect } from "@/i18n/navigation";
import { getOpportunityType } from "@/lib/core/opportunity-types";
import {
  OPPORTUNITIES_PATH,
  benefitLine,
  canonicalRedirect,
  costLines,
  countryName,
  displayTags,
  eligibilityLines,
  eventDatesOf,
  formatDay,
  getListingDetail,
  getSeoData,
  guideReadiness,
  isClosed,
  isShowable,
  isValidSlug,
  lastmodOf,
  listingIndexable,
  materialChecklist,
  opportunityPath,
  orgIndexable,
  orgPath,
  placeLine,
  programGuidePath,
  regionsOf,
  scoutHelpFor,
  shorten,
  timingOf,
  typePath,
  type ListingDetail,
  type PublicListing,
  renderTime,
} from "@/lib/programmatic";
import { absoluteUrl, eventLd, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; type: string; slug: string }> };

/** Prerender the best-documented listings; every other listing renders on its first visit and is cached. */
export async function generateStaticParams({ params }: { params: { locale?: string } }) {
  if (params?.locale && params.locale !== "en") return [];
  const { listings } = await getSeoData();
  return [...listings]
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
    .slice(0, 200)
    .map((l) => ({ type: l.typeSlug, slug: l.slug }));
}

function titleOf(d: ListingDetail): string {
  const org = d.orgName && !d.name.toLowerCase().includes(d.orgName.toLowerCase()) ? ` by ${d.orgName}` : "";
  return shorten(`${d.name}${org}`, 68);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidSlug(slug)) return {};
  const d = await getListingDetail(slug);
  if (!isShowable(d)) return {};
  const now = renderTime();
  const closed = isClosed(d, now);
  const timing = timingOf(d, now);
  const lead = closed ? "This round has closed. " : timing.date ? `${timing.label}. ` : "";
  return pageMetadata({
    title: titleOf(d),
    description: shorten(`${lead}${d.summary ?? getOpportunityType(d.type).description.en}`, 158),
    path: opportunityPath(d.type, d.slug),
    englishOnly: true,
    image: `/og/opportunity/${d.slug}`,
    // Closed rounds behave like a 410: the page explains and points to open ones, out of the index.
    noindex: !listingIndexable(d, now),
  });
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-[var(--line)] py-3 last:border-b-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-[0.98rem] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

function paragraphs(text: string, max = 2400): string[] {
  const t = text.length > max ? shorten(text, max) : text;
  return t
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Similar open listings: same type, same region first, never the listing itself. */
function similarTo(d: ListingDetail, listings: PublicListing[], n = 6): PublicListing[] {
  const regions = new Set(regionsOf(d.geo));
  return listings
    .filter((l) => l.type === d.type && l.slug !== d.slug)
    .map((l) => ({ l, s: regionsOf(l.geo).some((r) => regions.has(r)) ? 1 : 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.l);
}

export default async function ListingPage({ params }: Props) {
  const { locale, type, slug } = await params;
  englishOnly(locale, `/opportunities/${type}/${slug}`);
  if (!isValidSlug(slug)) notFound();
  const d = await getListingDetail(slug);
  if (!isShowable(d)) notFound();
  const redirectTo = canonicalRedirect(type, d);
  if (redirectTo) permanentRedirect({ href: redirectTo, locale: "en" });

  const now = renderTime();
  const def = getOpportunityType(d.type);
  const path = opportunityPath(d.type, d.slug);
  const closed = isClosed(d, now);
  const timing = timingOf(d, now);
  const { listings } = await getSeoData();
  const fromOrg = d.orgSlug ? listings.filter((l) => l.orgSlug === d.orgSlug) : [];
  const orgHasPage = Boolean(d.orgSlug && orgIndexable(fromOrg.length));
  const moreFromOrg = fromOrg.filter((l) => l.slug !== d.slug).slice(0, 5);
  const similar = similarTo(d, listings, closed ? 6 : 4);
  const officialUrl = d.apply.url ?? d.url;
  const eligibility = eligibilityLines(d.eligibility);
  const checklist = materialChecklist(d.requiredMaterials.length ? d.requiredMaterials : def.materials);
  const benefit = benefitLine(d.benefits);
  const costs = costLines(d.cost);
  const place = placeLine(d.geo);
  const tags = displayTags(d.tags);
  const guide = guideReadiness(d, now);
  const modified = lastmodOf(d);
  // The summary is already the lede; the About pane only adds what it doesn't say.
  const summaryText = d.summary?.replace(/\s+/g, " ").trim();
  const about = d.description ? paragraphs(d.description).filter((p) => p !== summaryText) : [];

  const dates = eventDatesOf(d.tags);
  const located = d.geo.remote === "remote" || d.geo.cities.length > 0 || d.geo.countries.length > 0;
  const ld =
    def.schemaOrg === "Event" && dates && located && !closed
      ? eventLd({
          name: d.name,
          description: d.summary ?? undefined,
          path,
          startDate: dates.startDate,
          endDate: dates.endDate,
          attendanceMode: d.geo.remote === "remote" ? (d.geo.countries.length || d.geo.cities.length ? "mixed" : "online") : "offline",
          location: d.geo.remote === "remote" && !d.geo.countries.length ? null : { city: d.geo.cities[0], country: d.geo.countries[0] },
          organizer: d.orgName ? { name: d.orgName } : null,
          url: officialUrl ?? undefined,
          ...(typeof d.cost?.free === "boolean" ? { isAccessibleForFree: d.cost.free } : {}),
        })
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: d.name,
          description: d.summary ?? def.description.en,
          url: absoluteUrl(path),
          inLanguage: "en",
          isPartOf: { "@id": `${SITE.url}/#website` },
          publisher: { "@id": `${SITE.url}/#organization` },
          ...(modified ? { dateModified: modified } : {}),
          about: { "@type": "Thing", name: d.name, ...(officialUrl ? { url: officialUrl } : {}) },
        };

  return (
    <>
      <JsonLd data={ld} />
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs
          items={[
            { name: "Opportunities", path: OPPORTUNITIES_PATH },
            { name: def.plural.en, path: typePath(def.slug) },
            { name: d.name, path },
          ]}
        />

        <header className="mt-6 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={typePath(def.slug)} locale="en" className="tag hover:text-ink">
              {def.label.en}
            </Link>
            <Tag tone={TIMING_TONE[timing.tone]} dot>
              {timing.label}
            </Tag>
          </div>
          <h1 className="display mt-4 text-[2.1rem] text-ink sm:text-[3rem]">{d.name}</h1>
          {d.orgName ? (
            <p className="mt-3 text-[1.02rem] text-ink-3">
              {orgHasPage && d.orgSlug ? (
                <Link href={orgPath(d.orgSlug)} locale="en" className="link">
                  {d.orgName}
                </Link>
              ) : (
                d.orgName
              )}
              {place ? (
                <span className="ml-2 inline-flex items-center gap-1 text-ink-4">
                  <MapPin size={14} aria-hidden /> {place}
                </span>
              ) : null}
            </p>
          ) : null}
          {d.summary ? <p className="lede mt-5 sm:text-[1.12rem]">{d.summary}</p> : null}
        </header>
      </Container>

      {closed ? (
        <Container className="mt-8">
          <Callout tone="warn" title="This round has closed">
            {d.cycle ? `The organiser describes the cycle as: ${d.cycle}. ` : ""}
            The details below are kept for reference. {similar.length ? "These similar ones are open now:" : "Check the official page for the next round."}
          </Callout>
          {similar.length ? (
            <ul className="pane-grid mt-5">
              {similar.map((l) => (
                <li key={l.slug} className="flex min-w-0">
                  <ListingCard listing={l} now={now} className="w-full" />
                </li>
              ))}
            </ul>
          ) : null}
        </Container>
      ) : null}

      <Section className="!pt-10 sm:!pt-12">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-4">
            {about.length ? (
              <Pane pad="lg" className="min-w-0">
                <h2 className="eyebrow">About</h2>
                <div className="prose-ui mt-3">
                  {about.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </Pane>
            ) : null}

            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">Who can apply</h2>
              {eligibility.length ? (
                <ul className="mt-4 grid gap-2.5">
                  {eligibility.map((e) => (
                    <li key={e} className="flex gap-3 text-[0.98rem] leading-relaxed text-ink-2">
                      <Check size={18} aria-hidden className="mt-[3px] shrink-0 text-pine" />
                      <span className="min-w-0">{e}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[0.98rem] text-ink-2">The organiser&rsquo;s eligibility rules are not recorded here yet: check the official page before applying.</p>
              )}
            </Pane>

            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">What you will need</h2>
              {!d.requiredMaterials.length ? (
                <p className="mt-2 text-[0.9rem] text-ink-3">Typical for {def.plural.en.toLowerCase()}; the official page has the exact list.</p>
              ) : null}
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
            </Pane>

            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow">How to apply</h2>
              <p className="mt-3 text-[0.98rem] leading-relaxed text-ink-2">
                {officialUrl ? "Applications go through the official page" : "The organiser has not published an application link here"}
                {d.apply.platform ? ` (${d.apply.platform.replace(/[_-]+/g, " ")})` : ""}
                {d.requiresAccount ? ", which needs an account in your name" : ""}.{" "}
                {timing.date && !closed ? `The deadline is ${formatDay(timing.date)}.` : ""}
              </p>
              {d.apply.instructions ? (
                <blockquote className="mt-4 border-l-[3px] border-pine pl-4 text-[0.95rem] leading-relaxed text-ink-2">{shorten(d.apply.instructions, 600)}</blockquote>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                {officialUrl ? (
                  <ButtonLink href={officialUrl} variant="ghost" external icon={<ExternalLink size={16} aria-hidden />}>
                    Official page
                  </ButtonLink>
                ) : null}
                {guide.ready ? (
                  <ButtonLink href={programGuidePath(d.slug)} locale="en" variant="quiet" icon={<BookOpen size={16} aria-hidden />}>
                    Step-by-step guide
                  </ButtonLink>
                ) : null}
              </div>
            </Pane>

            <Pane pad="lg" className="min-w-0">
              <h2 className="eyebrow eyebrow-accent">How Onward Scout helps</h2>
              <p className="mt-3 text-[1rem] leading-relaxed text-ink-2">{scoutHelpFor(d)}</p>
              <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-3">
                Every answer is drafted from your own documents and cites where each fact came from; anything we can&rsquo;t source is flagged for you, never invented.
              </p>
            </Pane>
          </div>

          <aside className="grid min-w-0 content-start gap-4">
            <Pane pad="md" className="min-w-0">
              <h2 className="eyebrow">Key facts</h2>
              <dl className="mt-2">
                <Fact label="Timing">{timing.label}</Fact>
                {d.cycle && timing.tone !== "cycle" ? <Fact label="Cycle">{d.cycle}</Fact> : null}
                {benefit ? <Fact label="What you get">{benefit}</Fact> : null}
                {d.benefits?.perks.length ? <Fact label="Also included">{d.benefits.perks.slice(0, 6).join(" · ")}</Fact> : null}
                {costs.length ? <Fact label="Cost">{costs.join(" · ")}</Fact> : null}
                {place ? <Fact label="Where">{place}</Fact> : null}
                {d.languages.length ? <Fact label="Language">{d.languages.map((l) => l.toUpperCase()).join(", ")}</Fact> : null}
                {d.eligibility?.nationality.length ? <Fact label="Nationality">{d.eligibility.nationality.map(countryName).join(", ")}</Fact> : null}
                {d.verifiedAt ? (
                  <Fact label="Last checked">
                    <time dateTime={d.verifiedAt}>{new Date(d.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>
                  </Fact>
                ) : null}
              </dl>
              {tags.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              ) : null}
              <p className="mt-4 flex gap-2 text-[0.8rem] leading-snug text-ink-4">
                <CircleAlert size={14} aria-hidden className="mt-[2px] shrink-0" />
                Programs change their terms. The official page is the final word on dates, amounts and rules.
              </p>
            </Pane>

            {moreFromOrg.length ? (
              <Pane pad="sm" className="min-w-0">
                <h2 className="eyebrow px-3 pt-1">More from {d.orgName ?? "this organization"}</h2>
                <ul className="mt-1">
                  {moreFromOrg.map((l) => (
                    <ListingRow key={l.slug} listing={l} now={now} />
                  ))}
                </ul>
                {orgHasPage && d.orgSlug ? (
                  <Link href={orgPath(d.orgSlug)} locale="en" className="mx-3 mb-2 mt-1 inline-flex items-center gap-1 text-[0.88rem] font-semibold text-ink">
                    All of them <ArrowUpRight size={14} aria-hidden />
                  </Link>
                ) : null}
              </Pane>
            ) : null}

            {!closed && similar.length ? (
              <Pane pad="sm" className="min-w-0">
                <h2 className="eyebrow px-3 pt-1">Similar {def.plural.en.toLowerCase()}</h2>
                <ul className="mt-1">
                  {similar.map((l) => (
                    <ListingRow key={l.slug} listing={l} now={now} />
                  ))}
                </ul>
              </Pane>
            ) : null}
          </aside>
        </div>
      </Section>

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta
          title={closed ? "Be ready when the next round opens" : `Let Onward Scout prepare this application`}
          body={
            closed
              ? "Drop in what you already have. Onward Scout keeps a sourced profile ready and tells you when rounds like this one open, with the application prepared for your tap."
              : `Drop in your résumé, deck or portfolio. Onward Scout checks whether you fit ${d.name}, prepares every answer from your own documents and waits for your tap.`
          }
          secondary={{ href: `/app/scout/${d.id}`, label: "Open it in your Scout board" }}
        />
      </Section>
    </>
  );
}
