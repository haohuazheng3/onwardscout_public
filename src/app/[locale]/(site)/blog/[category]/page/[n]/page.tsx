import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryView } from "@/components/blog/CategoryView";
import { englishOnly, forEnglish } from "@/components/seo/english-only";
import { CATEGORIES, categoryBySlug } from "@/content/categories";
import { categoryPageUrl, pageCount, paginate, postsInCategory } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)
/** The values are a fixed list (types / blog categories from code): anything else is a static 404, not a render. */
export const dynamicParams = false;

type Props = { params: Promise<{ locale: string; category: string; n: string }> };

export function generateStaticParams({ params }: { params: { locale?: string } }) {
  return forEnglish(params?.locale, () =>
    CATEGORIES.flatMap((c) => {
      const pages = pageCount(postsInCategory(c.slug).length);
      return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({ category: c.slug, n: String(i + 2) }));
    }),
  );
}

/** Page numbers ≥ 2 (page 1 is the hub itself). */
function pageNumber(n: string): number | null {
  if (!/^[1-9]\d{0,3}$/.test(n)) return null;
  const v = Number(n);
  return v >= 2 ? v : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, n } = await params;
  const cat = categoryBySlug(category);
  const page = pageNumber(n);
  if (!cat || !page) return {};
  return pageMetadata({ title: `${cat.title} (page ${page})`, description: cat.description, path: categoryPageUrl(cat.slug, page), englishOnly: true });
}

export default async function CategoryPaged({ params }: Props) {
  const { locale, category, n } = await params;
  englishOnly(locale, `/blog/${category}/page/${n}`);
  const cat = categoryBySlug(category);
  const page = pageNumber(n);
  if (!cat || !page) notFound();
  const slice = paginate(postsInCategory(cat.slug), page);
  if (!slice) notFound();
  return <CategoryView cat={cat} slice={slice} />;
}
