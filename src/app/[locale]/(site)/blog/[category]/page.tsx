import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryView } from "@/components/blog/CategoryView";
import { englishOnly, forEnglish } from "@/components/seo/english-only";
import { CATEGORIES, categoryBySlug } from "@/content/categories";
import { categoryPageUrl, paginate, postsInCategory } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)
/** The values are a fixed list (types / blog categories from code): anything else is a static 404, not a render. */
export const dynamicParams = false;

type Props = { params: Promise<{ locale: string; category: string }> };

export function generateStaticParams({ params }: { params: { locale?: string } }) {
  return forEnglish(params?.locale, () => CATEGORIES.map((c) => ({ category: c.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const cat = categoryBySlug(category);
  if (!cat) return {};
  // An empty hub is thin content: keep it out of the index until it has articles.
  return pageMetadata({ title: cat.title, description: cat.description, path: categoryPageUrl(cat.slug, 1), englishOnly: true, noindex: postsInCategory(cat.slug).length === 0 });
}

export default async function CategoryPage({ params }: Props) {
  const { locale, category } = await params;
  englishOnly(locale, `/blog/${category}`);
  const cat = categoryBySlug(category);
  if (!cat) notFound();
  const slice = paginate(postsInCategory(cat.slug), 1);
  if (!slice) notFound();
  return <CategoryView cat={cat} slice={slice} />;
}
