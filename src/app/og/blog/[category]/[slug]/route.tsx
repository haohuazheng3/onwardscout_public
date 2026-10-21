import { categoryBySlug } from "@/content/categories";
import { getPost } from "@/lib/blog";
import { SITE } from "@/lib/site";
import { ogCard } from "../../../card";

/** Per-article share image: /og/blog/<category>/<slug> (the brand card with the article's title). */
export async function GET(_req: Request, ctx: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await ctx.params;
  const post = getPost(category, slug);
  return ogCard({
    eyebrow: categoryBySlug(category)?.name ?? `${SITE.name} blog`,
    title: post?.title ?? SITE.tagline,
    subtitle: post?.description ?? null,
    badge: post ? `${post.readingMinutes} min read` : null,
  });
}
