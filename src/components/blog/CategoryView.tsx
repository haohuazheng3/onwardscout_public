import { JsonLd } from "@/components/JsonLd";
import { PostCard } from "@/components/blog/PostCard";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { Pagination } from "@/components/seo/Pagination";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { Container, EmptyState, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import type { Category } from "@/content/categories";
import { PAGE_SIZE, categoriesWithCounts, categoryPageUrl, postUrl, type PageSlice, type Post } from "@/lib/blog";
import { absoluteUrl } from "@/lib/seo";

/** One category hub page: page 1 at /blog/<category>, later pages at /blog/<category>/page/<n>. */
export function CategoryView({ cat, slice }: { cat: Category; slice: PageSlice<Post> }) {
  const { page, totalPages, items } = slice;
  const selfPath = categoryPageUrl(cat.slug, page);
  // Only hubs with articles are linked: empty hubs are noindex and stay out of the link graph.
  const others = categoriesWithCounts().filter((c) => c.slug !== cat.slug && c.count > 0);

  return (
    <>
      {items.length ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: page > 1 ? `${cat.title} (page ${page})` : cat.title,
            description: cat.description,
            url: absoluteUrl(selfPath),
            inLanguage: "en",
            mainEntity: {
              "@type": "ItemList",
              itemListElement: items.map((p, i) => ({
                "@type": "ListItem",
                position: (page - 1) * PAGE_SIZE + i + 1,
                url: absoluteUrl(postUrl(p)),
                name: p.title,
              })),
            },
          }}
        />
      ) : null}
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs
          items={[
            { name: "Blog", path: "/blog" },
            { name: cat.name, path: categoryPageUrl(cat.slug, 1) },
            ...(page > 1 ? [{ name: `Page ${page}`, path: selfPath }] : []),
          ]}
        />
        <header className="mt-6 max-w-3xl">
          <p className="eyebrow eyebrow-dot">{cat.name}</p>
          <h1 className="display mt-3 text-[2.2rem] text-ink sm:text-[3.1rem]">{cat.title}</h1>
          <p className="lede mt-4 sm:text-[1.12rem]">{cat.intro}</p>
        </header>
      </Container>

      <Section className="!pt-10 sm:!pt-12">
        {items.length ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((p) => (
                <PostCard key={postUrl(p)} post={p} />
              ))}
            </div>
            <Pagination className="mt-8" page={page} totalPages={totalPages} href={(n) => categoryPageUrl(cat.slug, n)} />
          </>
        ) : (
          <EmptyState
            title="Articles for this topic are being written"
            body="They appear here as they are published. Until then, the opportunity playbooks cover how each kind of application is judged."
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

      {others.length ? (
        <Section className="!pt-14">
          <h2 className="eyebrow">Other topics</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((c) => (
              <li key={c.slug}>
                <Link href={`/blog/${c.slug}`} locale="en" className="chip">
                  {c.name} <span className="num text-[0.8em] opacity-70">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section className="!pt-14 pb-20 sm:!pt-20 sm:pb-28">
        <ScoutCta />
      </Section>
    </>
  );
}
