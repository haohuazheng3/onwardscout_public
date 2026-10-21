import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeHubView, regionCounts } from "@/components/seo/TypeHubView";
import { englishOnly } from "@/components/seo/english-only";
import { opportunityTypeBySlug, publicOpportunityTypes } from "@/lib/core/opportunity-types";
import { REGION_LABELS, getSeoData, hubIndexable, isRegionId, regionPath, regionPhrase, regionsOf, shorten, typeCopy, renderTime } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; type: string; region: string }> };

/** Region pages that have listings (the rest render on demand, as noindex empty states). */
export async function generateStaticParams({ params }: { params: { locale?: string } }) {
  if (params?.locale && params.locale !== "en") return [];
  const { listings } = await getSeoData();
  const out: { type: string; region: string }[] = [];
  for (const t of publicOpportunityTypes()) {
    for (const { region } of regionCounts(listings.filter((l) => l.type === t.id))) out.push({ type: t.slug, region });
  }
  return out;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type, region } = await params;
  const def = opportunityTypeBySlug(type);
  if (!def || !isRegionId(region)) return {};
  const { listings } = await getSeoData();
  const count = listings.filter((l) => l.type === def.id && regionsOf(l.geo).includes(region)).length;
  const what = `${def.plural.en} ${regionPhrase(region)}`;
  return pageMetadata({
    title: count ? `${what}: ${count} open now` : what,
    description: shorten(`${count ? `${count} open ${def.plural.en.toLowerCase()} ${regionPhrase(region)}, with official links. ` : ""}${typeCopy(def.id).intro}`, 160),
    path: regionPath(def.slug, region),
    englishOnly: true,
    noindex: !hubIndexable(count),
  });
}

export default async function TypeRegionPage({ params }: Props) {
  const { locale, type, region } = await params;
  const def = opportunityTypeBySlug(type);
  englishOnly(locale, def && isRegionId(region) ? regionPath(def.slug, region) : `/opportunities/${type}/in/${region}`);
  if (!def || !isRegionId(region) || !REGION_LABELS[region]) notFound();
  const { listings } = await getSeoData();
  const all = listings.filter((l) => l.type === def.id);
  const shown = all.filter((l) => regionsOf(l.geo).includes(region));
  return <TypeHubView def={def} all={all} shown={shown} page={1} totalPages={1} region={region} now={renderTime()} />;
}
