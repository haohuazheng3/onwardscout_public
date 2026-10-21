import { categoryBySlug } from "@/content/categories";
import { cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { formatPostDate, postUrl, type Post } from "@/lib/blog";

/** One article in a grid: title, standfirst, reading time and the date it was last updated. */
export function PostCard({ post, showCategory = false, className }: { post: Post; showCategory?: boolean; className?: string }) {
  const cat = showCategory ? categoryBySlug(post.category) : null;
  return (
    <Link href={postUrl(post)} locale="en" className={cx("pane pane-hover flex min-w-0 flex-col p-6 sm:p-7", className)}>
      {cat ? <span className="text-[0.8rem] font-semibold text-accent-text">{cat.name}</span> : null}
      <span className={cx("headline block text-[1.3rem] text-ink", cat && "mt-2")}>{post.title}</span>
      <span className="mt-3 block text-[0.96rem] leading-relaxed text-ink-3">{post.description}</span>
      <span className="mt-auto block pt-5 text-[0.82rem] text-ink-4">
        {post.readingMinutes} min read · Updated <time dateTime={post.updatedAt}>{formatPostDate(post.updatedAt)}</time>
      </span>
    </Link>
  );
}
