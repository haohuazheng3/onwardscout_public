import { JsonLd } from "@/components/JsonLd";
import { PostCard } from "@/components/blog/PostCard";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { Pagination } from "@/components/seo/Pagination";
import { ScoutCta } from "@/components/seo/ScoutCta";
import { Container, EmptyState, Section } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import type { Category } from "@/content/categories";
import { PAGE_SIZE, categoriesWithCounts, categoryPageUrl, postUrl, publishedPosts, type PageSlice, type Post } from "@/lib/blog";
import { SITE_TERMS, blogTerms, opportunityTypeTerms } from "@/lib/autolink";
import { getHub } from "@/lib/hubs";
import { renderMdx } from "@/lib/mdx";
import { getIndexableTargets, typePath } from "@/lib/programmatic";
import { OPPORTUNITY_TYPES } from "@/lib/core/opportunity-types";
import { absoluteUrl, faqLd } from "@/lib/seo";

/**
 * One category hub page: page 1 at /blog/<category>, later pages at /blog/<category>/page/<n>.
 * Page 1 is built as a pillar: the article list, live opportunity types for the audience, the
 * framework copy from content/hubs/<category>.mdx and its FAQ (with FAQPage JSON-LD).
 */
export async function CategoryView({ cat, slice }: { cat: Category; slice: PageSlice<Post> }) {
  const { page, totalPages, items } = slice;
  const selfPath = categoryPageUrl(cat.slug, page);
  // Only hubs with articles are linked: empty hubs are noindex and stay out of the link graph.
  const others = categoriesWithCounts().filter((c) => c.slug !== cat.slug && c.count > 0);
  const hub = page === 1 && items.length ? getHub(cat.slug) : null;
  const targets = page === 1 ? await getIndexableTargets() : { types: [], regions: [], careers: [] };
  const live = new Map(targets.types.map((t) => [t.slug, t]));
  const types = cat.opportunityTypes.filter((slug) => live.has(slug)).map((slug) => ({ slug, def: OPPORTUNITY_TYPES.find((t) => t.slug === slug) }));
  const posts = hub ? publishedPosts() : [];
  const hubBody = hub
    ? await renderMdx(hub.body, { autolink: [...blogTerms(posts, categoriesWithCounts(posts)), ...opportunityTypeTerms(targets.types.map((t) => t.slug)), ...SITE_TERMS], self: selfPath })
    : null;

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
      {hub ? <JsonLd data={faqLd(hub.faq)} /> : null}
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

      {types.length ? (
        <Section className="!pt-12">
          <h2 className="eyebrow">Open now on Onward Scout</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {types.map((t) => (
              <li key={t.slug}>
                <Link href={typePath(t.slug)} locale="en" className="chip">
                  {t.def?.plural.en ?? t.slug}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {hub && hubBody ? (
        <Section className="!pt-12">
          <div className="pane px-5 py-8 sm:px-10 sm:py-12">
            <div className="prose-scout">{hubBody}</div>
          </div>
          <section aria-labelledby="hub-faq" className="pane mt-6 px-5 py-8 sm:px-10 sm:py-10">
            <h2 id="hub-faq" className="headline text-[1.6rem] text-ink sm:text-[1.9rem]">
              Frequently asked questions
            </h2>
            <div className="mt-5 divide-y divide-line">
              {hub.faq.map((f) => (
                <div key={f.q} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="text-[1.06rem] font-semibold leading-snug text-ink">{f.q}</h3>
                  <p className="mt-1.5 text-[1rem] leading-relaxed text-ink-2">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        </Section>
      ) : null}

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
