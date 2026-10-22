import { ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { Photo } from "@/components/blog/MdxBlocks";
import { ToolCtaStrip } from "@/components/tools/ToolCta";
import { ToolRunner } from "@/components/tools/ToolRunner";
import { getTool } from "@/content/tools";
import { LogoMark } from "@/components/Logo";
import { PostCard } from "@/components/blog/PostCard";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { ButtonLink, Container } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { categoryBySlug } from "@/content/categories";
import { SITE_TERMS, blogTerms, careerTerms, opportunityTypeTerms } from "@/lib/autolink";
import { categoriesWithCounts, formatPostDate, postUrl, publishedPosts, relatedPosts, type Post, type PostHeading } from "@/lib/blog";
import { renderMdx } from "@/lib/mdx";
import { getIndexableTargets } from "@/lib/programmatic";
import { absoluteUrl, articleLd, faqLd, webApplicationLd } from "@/lib/seo";

function Toc({ headings, className }: { headings: PostHeading[]; className?: string }) {
  return (
    <nav aria-label="On this page" className={className}>
      <p className="eyebrow">On this page</p>
      <ol className="mt-3 space-y-0.5 text-[0.92rem]">
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className="block rounded-[12px] px-2 py-1.5 text-ink-3 transition-colors hover:bg-pane-2 hover:text-ink active:bg-pane-3">
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The article template: breadcrumbs, a header with visible published/updated dates and reading
 * time, a table of contents (inline on phones, sticky on desktop) when the article has three or
 * more sections, the MDX body in one reading pane, the call to action and related articles.
 * The author is always the organization; Article JSON-LD says the same.
 */
export async function ArticleView({ post }: { post: Post }) {
  const cat = categoryBySlug(post.category);
  const path = postUrl(post);
  const targets = await getIndexableTargets();
  const posts = publishedPosts();
  const terms = [
    ...blogTerms(posts, categoriesWithCounts(posts)),
    ...opportunityTypeTerms(targets.types.map((t) => t.slug)),
    ...careerTerms(targets.careers.map((c) => c.code)),
    ...SITE_TERMS,
  ];
  const body = await renderMdx(post.body, {
    autolink: terms,
    self: path,
    components: {
      Photo: ({ n }) => {
        const image = post.images[Number(n) - 1];
        return image ? <Photo image={image} /> : null;
      },
    },
  });
  const related = relatedPosts(post, 3, posts);
  const tool = post.level === "A" ? getTool(post.tool) : null;
  const tocItems = post.faq.length ? [...post.headings, { id: "faq", text: "FAQ" }] : post.headings;
  const showToc = post.headings.length >= 3;

  return (
    <>
      <JsonLd
        data={articleLd(
          {
            title: post.title,
            description: post.description,
            publishedAt: post.publishedAt,
            updatedAt: post.updatedAt,
            keywords: post.keywords,
            wordCount: post.wordCount,
            image: `/og/blog/${post.category}/${post.slug}`,
            section: cat?.name,
            locale: "en",
          },
          path,
        )}
      />
      {post.faq.length ? <JsonLd data={faqLd(post.faq)} /> : null}
      {tool ? <JsonLd data={webApplicationLd({ name: tool.schemaName ?? tool.title, description: tool.lede, path })} /> : null}
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs
          items={[
            { name: "Blog", path: "/blog" },
            ...(cat ? [{ name: cat.name, path: `/blog/${cat.slug}` }] : []),
            { name: post.title, path },
          ]}
        />
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="min-w-0">
            <header className="max-w-3xl">
              {cat ? (
                <Link href={`/blog/${cat.slug}`} locale="en" className="eyebrow eyebrow-accent hover:underline">
                  {cat.name}
                </Link>
              ) : null}
              <h1 className="display mt-4 text-[2.2rem] text-ink sm:text-[3.1rem]">{post.title}</h1>
              <p className="dek mt-4 text-[1.16rem] leading-snug">{post.description}</p>
              <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[0.86rem] text-ink-4">
                <span>
                  By{" "}
                  <Link href="/about" className="text-ink-3 hover:text-ink">
                    Onward Scout
                  </Link>
                </span>
                <span>
                  Published <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
                </span>
                {post.updatedAt !== post.publishedAt ? (
                  <span>
                    Updated <time dateTime={post.updatedAt}>{formatPostDate(post.updatedAt)}</time>
                  </span>
                ) : null}
                <span>{post.readingMinutes} min read</span>
              </p>
            </header>

            {tool ? (
              <>
                <div className="pane mt-8 px-5 py-6 sm:px-8 sm:py-8" id="tool">
                  <ToolRunner tool={tool} pageUrl={absoluteUrl(path)} />
                </div>
                <div className="mt-4">
                  <ToolCtaStrip tool={tool} headline={post.cta?.toolHeadline} note={post.cta?.toolNote} />
                </div>
              </>
            ) : null}

            {post.level === "B" && post.verdict ? (
              <aside aria-label="The short answer" className="pane relative mt-8 overflow-hidden px-6 py-6 before:absolute before:inset-y-5 before:left-0 before:w-[4px] before:rounded-r-full before:bg-accent sm:px-8 sm:py-7">
                <p className="eyebrow eyebrow-accent">The short answer</p>
                <p className="headline mt-2 text-[1.45rem] leading-snug text-ink sm:text-[1.7rem]">{post.verdict.title}</p>
                <p className="mt-3 max-w-3xl text-[1.02rem] leading-relaxed text-ink-2">{post.verdict.body}</p>
                <ButtonLink href={post.verdict.ctaHref ?? "/app/start"} prefetch={false} size="sm" className="mt-5" iconRight={<ArrowRight size={16} aria-hidden />}>
                  {post.verdict.ctaLabel ?? "Start free with what you have"}
                </ButtonLink>
              </aside>
            ) : null}

            {showToc ? <Toc headings={tocItems} className="pane-inset mt-8 p-5 lg:hidden" /> : null}

            <div className="pane mt-8 px-5 py-8 sm:px-10 sm:py-12">
              {/* An explicit capture marker: analytics records only the article text, never the tool pane above it. */}
              <div className="prose-scout" data-fw-capture="article">
                {body}
              </div>
            </div>

            {post.faq.length ? (
              <section aria-labelledby="faq" className="pane mt-8 px-5 py-8 sm:px-10 sm:py-10">
                <h2 id="faq" className="headline text-[1.6rem] text-ink sm:text-[1.9rem]">
                  Frequently asked questions
                </h2>
                <div className="mt-5 divide-y divide-line">
                  {post.faq.map((f) => (
                    <div key={f.q} className="py-4 first:pt-0 last:pb-0">
                      <h3 className="text-[1.06rem] font-semibold leading-snug text-ink">{f.q}</h3>
                      <p className="mt-1.5 text-[1rem] leading-relaxed text-ink-2">{f.a}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="mt-10">
              <ScoutCta title={post.cta?.title} body={post.cta?.body} />
            </div>

            {related.length ? (
              <section className="mt-12" aria-labelledby="related">
                <h2 id="related" className="eyebrow">
                  Keep reading
                </h2>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {related.map((r) => (
                    <PostCard key={postUrl(r)} post={r} showCategory />
                  ))}
                </div>
              </section>
            ) : null}
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-28 space-y-4">
              {showToc ? <Toc headings={tocItems} className="pane p-5" /> : null}
              <div className="pane p-5">
                <LogoMark size={28} />
                <p className="mt-3 text-[0.98rem] font-semibold text-ink">Your scout for every opportunity</p>
                <p className="mt-1 text-[0.86rem] leading-relaxed text-ink-3">Drop in what you have. Onward Scout finds openings you can win and prepares each application for your tap.</p>
                <ButtonLink href="/app/start" prefetch={false} size="sm" block className="mt-4">
                  Start free
                </ButtonLink>
              </div>
            </div>
          </aside>
        </div>
      </Container>
      <div aria-hidden className="pb-20 sm:pb-28" />
    </>
  );
}
