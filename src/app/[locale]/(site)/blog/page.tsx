import type { Metadata } from "next";
import { PostCard } from "@/components/blog/PostCard";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { englishOnly } from "@/components/seo/english-only";
import { Container, EmptyState, Section, Tag, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { categoriesWithCounts, postUrl, publishedPosts } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: "Blog: applications, careers, funding and research",
    description:
      "Practical guides to winning applications: jobs and career moves, funding and startup programs, academic submissions, scholarships and fellowships, and creative open calls.",
    path: "/blog",
    englishOnly: true,
    // A hub with nothing in it is thin: noindex until the first article is live.
    noindex: publishedPosts().length === 0,
  });
}

/** The blog hub: topic navigation, featured articles, the latest ones. */
export default async function BlogHub({ params }: Props) {
  const { locale } = await params;
  englishOnly(locale, "/blog");
  const posts = publishedPosts();
  const cats = categoriesWithCounts(posts);
  const featured = posts.filter((p) => p.featured).slice(0, 3);
  const latest = posts.filter((p) => !featured.includes(p)).slice(0, 8);

  return (
    <>
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: "Blog", path: "/blog" }]} />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">Blog</p>
          <h1 className="display mt-3 text-[2.4rem] text-ink sm:text-[3.5rem]">Applications that get accepted</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">
            Specific, practical guides to the applications people make every year: jobs, programs for founders, research submissions, scholarships and
            fellowships, creative calls. Written by Onward Scout, the team building your scout.
          </p>
        </header>
        <nav aria-label="Topics" className="mt-7">
          <ul className="scroll-row -mx-4 px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {cats.map((c) =>
              c.count ? (
                <li key={c.slug}>
                  <Link href={`/blog/${c.slug}`} locale="en" className="chip">
                    {c.name} <span className="num text-[0.8em] opacity-70">{c.count}</span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </nav>
      </Container>

      {featured.length ? (
        <Section className="!pt-10 sm:!pt-12">
          <h2 className="eyebrow">Start here</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {featured.map((p) => (
              <PostCard key={postUrl(p)} post={p} showCategory />
            ))}
          </div>
        </Section>
      ) : null}

      <Section className="!pt-12 sm:!pt-14">
        <h2 className="eyebrow">Browse by topic</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => {
            const inner = (
              <>
                <span className="flex items-start justify-between gap-3">
                  <span className="headline text-[1.2rem] text-ink">{c.name}</span>
                  <Tag tone={c.count ? "accent" : "default"} className="shrink-0">
                    {c.count ? `${c.count} ${c.count === 1 ? "article" : "articles"}` : "Coming"}
                  </Tag>
                </span>
                <span className="mt-3 block text-[0.94rem] leading-relaxed text-ink-3">{c.description}</span>
              </>
            );
            // Empty topics stay visible but are not links: their hubs are noindex and out of the sitemap.
            return c.count ? (
              <Link key={c.slug} href={`/blog/${c.slug}`} locale="en" className="pane pane-hover flex min-w-0 flex-col p-6">
                {inner}
              </Link>
            ) : (
              <div key={c.slug} className={cx("pane-inset flex min-w-0 flex-col p-6")}>
                {inner}
              </div>
            );
          })}
        </div>
      </Section>

      <Section className="!pt-12 sm:!pt-14">
        {latest.length ? (
          <>
            <h2 className="eyebrow">Latest</h2>
            <ul className="pane mt-4 divide-y divide-[var(--line)] px-2">
              {latest.map((p) => (
                <li key={postUrl(p)}>
                  <Link
                    href={postUrl(p)}
                    locale="en"
                    className="flex flex-col gap-1 rounded-[18px] px-4 py-4 transition-colors hover:bg-pane-2 active:bg-pane-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="text-[1.02rem] font-semibold leading-snug text-ink">{p.title}</span>
                    <span className="shrink-0 text-[0.85rem] text-ink-4">{cats.find((c) => c.slug === p.category)?.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : featured.length ? null : (
          <EmptyState
            title="The first articles are being written"
            body="They land here as they are published. Meanwhile, the playbooks explain how every kind of application is judged, and the opportunity pages list what is open now."
            action={
              <>
                <Link href="/guides" locale="en" className="btn btn-ghost btn-sm">
                  Application guides
                </Link>
                <Link href="/opportunities" locale="en" className="btn btn-quiet btn-sm">
                  Open opportunities
                </Link>
              </>
            }
          />
        )}
      </Section>

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta />
      </Section>
    </>
  );
}
