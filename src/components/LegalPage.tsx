import type { Metadata } from "next";
import { ArrowRight, ListTree } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { JsonLd } from "@/components/JsonLd";
import { Callout, Container, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { absoluteUrl, htmlLang, localizedPath, pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE, type Locale } from "@/lib/site";
import { Breadcrumbs } from "./site/blocks";
import { LEGAL_DOC_KEYS, LEGAL_DOCS, fillLegalDoc, legalVars, readLegalDoc, type LegalBlock, type LegalDoc, type LegalDocKey } from "./site/legal-doc";
import { Rich } from "./site/Rich";
import { fillVars, plainInline } from "./site/inline-markup";

/*
 * The shared shell of the five trust pages (privacy, terms, acceptable use, cookies, refunds).
 * The text lives in messages/<locale>/legal.json as structured blocks, so the translation pass
 * edits JSON, never JSX; `{email}`-style placeholders are filled from the single sources of
 * truth (SITE, plans). Layout: the title and the visible "Last updated" date in the field, the
 * short version in a pane, then the full text in one wide pane with a table of contents beside
 * it on large screens and above it on phones. Static, no client JavaScript.
 */

/** The document for a locale, parsed and filled. A malformed translation fails loudly at build time. */
export async function loadLegalDoc(locale: Locale, key: LegalDocKey): Promise<LegalDoc> {
  const t = await getTranslations({ locale, namespace: "legal" });
  return fillLegalDoc(readLegalDoc(t.raw(key), `${locale}/legal.${key}`), legalVars(locale));
}

export async function legalMetadata(locale: Locale, key: LegalDocKey): Promise<Metadata> {
  const doc = await loadLegalDoc(locale, key);
  return pageMetadata({ title: doc.metaTitle, description: plainInline(doc.metaDescription), path: LEGAL_DOCS[key], locale });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <p>
        <Rich text={block} />
      </p>
    );
  }
  if ("h3" in block) return <h3>{block.h3}</h3>;
  if ("note" in block) {
    return (
      <Callout tone="accent" className="not-prose">
        <Rich text={block.note} />
      </Callout>
    );
  }
  if ("ul" in block) {
    return (
      <ul>
        {block.ul.map((item, i) => (
          <li key={i}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  const { head, rows } = block.table;
  return (
    <>
      {/* Phones: one card per row, label beside value; no sideways scrolling. */}
      <div className="grid gap-2 sm:hidden">
        {rows.map((row, r) => (
          <dl key={r} className="rounded-[var(--radius-inner)] bg-pane-2 px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
            {row.map((cell, c) => (
              <div key={c} className={cx(c > 0 && "mt-1.5")}>
                {c === 0 ? (
                  <dt className="text-[0.95rem] font-semibold leading-snug text-ink">
                    <Rich text={cell} />
                  </dt>
                ) : (
                  <>
                    <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-4">{head[c]}</dt>
                    <dd className="text-[0.93rem] leading-relaxed text-ink-2">
                      <Rich text={cell} />
                    </dd>
                  </>
                )}
              </div>
            ))}
          </dl>
        ))}
      </div>
      <table className="!hidden sm:!table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className="font-semibold">
                    <Rich text={cell} />
                  </th>
                ) : (
                  <td key={c}>
                    <Rich text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export async function LegalPage({ locale, docKey }: { locale: Locale; docKey: LegalDocKey }) {
  const [doc, t, format] = await Promise.all([
    loadLegalDoc(locale, docKey),
    getTranslations({ locale, namespace: "legal.shell" }),
    getFormatter({ locale }),
  ]);
  const path = LEGAL_DOCS[docKey];
  const updated = format.dateTime(new Date(`${CONTENT_UPDATED}T12:00:00Z`), { year: "numeric", month: "long", day: "numeric" });
  const others = LEGAL_DOC_KEYS.filter((k) => k !== docKey);
  const vars = legalVars(locale);

  const toc = (
    <ol className="space-y-0.5">
      {doc.sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className="press flex min-h-[38px] items-baseline gap-2.5 rounded-[12px] px-2.5 py-1.5 text-[0.9rem] leading-snug text-ink-3 transition-colors hover:bg-pane-2 hover:text-ink"
          >
            <span className="num w-5 shrink-0 text-[0.78rem] text-ink-4">{i + 1}</span>
            <span className="min-w-0">{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: doc.title,
          description: plainInline(doc.metaDescription),
          url: absoluteUrl(localizedPath(locale, path)),
          inLanguage: htmlLang(locale),
          dateModified: CONTENT_UPDATED,
          isPartOf: { "@id": `${SITE.url}/#website` },
          publisher: { "@id": `${SITE.url}/#organization` },
        }}
      />
      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs
          locale={locale}
          label={t("home")}
          items={[
            { name: t("home"), path: "/" },
            { name: doc.title, path },
          ]}
        />
        <div className="mt-8 max-w-3xl sm:mt-10">
          <h1 className="display text-[2.4rem] text-ink sm:text-[3.4rem]">{doc.title}</h1>
          <p className="mt-4 text-[0.92rem] text-ink-3">
            {t("lastUpdated")} <time dateTime={CONTENT_UPDATED}>{updated}</time>
          </p>
        </div>

        <section aria-labelledby="short-version" className="pane mt-8 max-w-3xl p-6 sm:p-8">
          <h2 id="short-version" className="eyebrow eyebrow-dot eyebrow-accent">
            {t("shortVersion")}
          </h2>
          <ul className="mt-4 space-y-3">
            {doc.summary.map((line, i) => (
              <li key={i} className="flex gap-3 text-[1rem] leading-relaxed text-ink-2">
                <span aria-hidden className="mt-[0.62em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0">
                  <Rich text={line} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8">
          <nav aria-label={t("onThisPage")} className="min-w-0">
            <details className="pane group px-3 py-2 lg:hidden">
              <summary className="press flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-2 text-[0.95rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <ListTree size={17} className="text-pine" aria-hidden />
                {t("onThisPage")}
              </summary>
              <div className="pb-2">{toc}</div>
            </details>
            <div className="sticky top-28 hidden lg:block">
              <p className="eyebrow px-2.5">{t("onThisPage")}</p>
              <div className="mt-3">{toc}</div>
            </div>
          </nav>

          <article className="pane min-w-0 px-5 py-7 sm:px-10 sm:py-10">
            <div className="prose-scout max-w-[68ch]">
              {doc.sections.map((s, i) => (
                <Fragment key={s.id}>
                  <h2 id={s.id} className={cx("scroll-mt-28", i === 0 && "!mt-0")}>
                    {s.title}
                  </h2>
                  {s.body.map((b, j) => (
                    <Block key={j} block={b} />
                  ))}
                </Fragment>
              ))}
            </div>
          </article>
        </div>

        <div className="mt-6 grid gap-4 lg:ml-[282px] lg:grid-cols-2">
          <div className="pane-inset min-w-0 px-5 py-5 sm:px-6">
            <p className="text-[0.95rem] leading-relaxed text-ink-2">
              <Rich text={fillVars(t.raw("questions") as string, vars)} />
            </p>
          </div>
          <div className="pane-inset min-w-0 px-5 py-5 sm:px-6">
            <p className="eyebrow">{t("otherPolicies")}</p>
            <ul className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {others.map((k) => (
                <li key={k}>
                  <Link
                    href={LEGAL_DOCS[k]}
                    className="press group inline-flex min-h-[40px] items-center gap-1.5 text-[0.93rem] text-ink-2 hover:text-ink"
                  >
                    {t(k)}
                    <ArrowRight size={14} className="text-ink-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </>
  );
}
