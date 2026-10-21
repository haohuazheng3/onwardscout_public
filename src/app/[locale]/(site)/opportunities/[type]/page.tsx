import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeHubView } from "@/components/seo/TypeHubView";
import { englishOnly, forEnglish } from "@/components/seo/english-only";
import { opportunityTypeBySlug, publicOpportunityTypes } from "@/lib/core/opportunity-types";
import { LIST_PAGE_SIZE, getSeoData, hubIndexable, shorten, typeCopy, typePath, renderTime } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)
/** The values are a fixed list (types / blog categories from code): anything else is a static 404, not a render. */
export const dynamicParams = false;

type Props = { params: Promise<{ locale: string; type: string }> };

export function generateStaticParams({ params }: { params: { locale?: string } }) {
  return forEnglish(params?.locale, () => publicOpportunityTypes().map((t) => ({ type: t.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const def = opportunityTypeBySlug(type);
  if (!def) return {};
  const { counts } = await getSeoData();
  const count = counts[def.id] ?? 0;
  const plural = def.plural.en;
  return pageMetadata({
    title: count ? `${plural} open now: ${count} to apply for` : `${plural}: how to find and win them`,
    description: shorten(`${typeCopy(def.id).intro} ${count ? `Browse ${count} open ${count === 1 ? "listing" : "listings"} with official links.` : ""}`, 160),
    path: typePath(def.slug),
    englishOnly: true,
    // A hub with fewer than three live listings is thin: it still helps visitors, out of the index.
    noindex: !hubIndexable(count),
  });
}

export default async function TypeHubPage({ params }: Props) {
  const { locale, type } = await params;
  const def = opportunityTypeBySlug(type);
  englishOnly(locale, def ? typePath(def.slug) : `/opportunities/${type}`);
  if (!def) notFound();
  const { listings } = await getSeoData();
  const all = listings.filter((l) => l.type === def.id);
  const totalPages = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  return <TypeHubView def={def} all={all} shown={all.slice(0, LIST_PAGE_SIZE)} page={1} totalPages={totalPages} region={null} now={renderTime()} />;
}
