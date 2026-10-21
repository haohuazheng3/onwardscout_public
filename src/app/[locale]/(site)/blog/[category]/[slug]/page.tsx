import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/blog/ArticleView";
import { englishOnly, forEnglish } from "@/components/seo/english-only";
import { getPost, postUrl, publishedPosts } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

// Articles are static files; the hourly refresh only keeps their automatic internal links current.
export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Props = { params: Promise<{ locale: string; category: string; slug: string }> };

export function generateStaticParams({ params }: { params: { locale?: string } }) {
  return forEnglish(params?.locale, () => publishedPosts().map((p) => ({ category: p.category, slug: p.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, slug } = await params;
  const post = getPost(category, slug);
  if (!post) return {};
  const meta = pageMetadata({
    title: post.title,
    description: post.description,
    path: postUrl(post),
    englishOnly: true,
    type: "article",
    image: `/og/blog/${post.category}/${post.slug}`,
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
  });
  return {
    ...meta,
    keywords: post.keywords,
    authors: [{ name: SITE.name, url: SITE.url }],
    openGraph: { ...meta.openGraph, type: "article", publishedTime: post.publishedAt, modifiedTime: post.updatedAt, authors: [SITE.name] },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { locale, category, slug } = await params;
  englishOnly(locale, `/blog/${category}/${slug}`);
  const post = getPost(category, slug);
  if (!post) notFound();
  return <ArticleView post={post} />;
}
