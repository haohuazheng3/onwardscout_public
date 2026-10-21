import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TypeHubView } from "@/components/seo/TypeHubView";
import { englishOnly, forEnglish } from "@/components/seo/english-only";
import { opportunityTypeBySlug } from "@/lib/core/opportunity-types";
import { LIST_PAGE_SIZE, getSeoData, typeCopy, typePath, shorten, renderTime } from "@/lib/programmatic";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Props = { params: Promise<{ locale: string; type: string; n: string }> };

/** Later pages of each hub that has more than one page. */
export async function generateStaticParams() {
  const { listings } = await getSeoData();
  const perType = new Map<string, number>();
  for (const l of listings) perType.set(l.typeSlug, (perType.get(l.typeSlug) ?? 0) + 1);
  return forEnglish(undefined, () =>
    [...perType.entries()].flatMap(([type, count]) =>
      Array.from({ length: Math.max(0, Math.ceil(count / LIST_PAGE_SIZE) - 1) }, (_, i) => ({ type, n: String(i + 2) })),
    ),
  );
}

function pageNumber(n: string): number | null {
  if (!/^[1-9]\d{0,3}$/.test(n)) return null;
  const v = Number(n);
  return Number.isInteger(v) && v >= 2 ? v : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type, n } = await params;
  const def = opportunityTypeBySlug(type);
  const page = pageNumber(n);
  if (!def || !page) return {};
  return pageMetadata({
    title: `${def.plural.en} open now (page ${page})`,
    description: shorten(typeCopy(def.id).intro, 160),
    path: typePath(def.slug, page),
    englishOnly: true,
  });
}

export default async function TypeHubPaged({ params }: Props) {
  const { locale, type, n } = await params;
  const def = opportunityTypeBySlug(type);
  const page = pageNumber(n);
  englishOnly(locale, def && page ? typePath(def.slug, page) : `/opportunities/${type}/page/${n}`);
  if (!def || !page) notFound();
  const { listings } = await getSeoData();
  const all = listings.filter((l) => l.type === def.id);
  const totalPages = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  if (page > totalPages) notFound();
  return (
    <TypeHubView
      def={def}
      all={all}
      shown={all.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE)}
      page={page}
      totalPages={totalPages}
      region={null}
      now={renderTime()}
    />
  );
}
