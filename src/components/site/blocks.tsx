import { ArrowRight, ArrowUpRight, Check, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { LogoMark } from "@/components/Logo";
import { ButtonLink, Container, cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { breadcrumbLd, localizedPath } from "@/lib/seo";
import type { Locale } from "@/lib/site";
import { Rich } from "./Rich";

/*
 * Building blocks shared by the marketing and trust pages. Server-safe, no hooks, no client JS:
 * everything here ships as static HTML.
 */

/* ------------------------------------------------------------------ breadcrumbs */

export interface Crumb {
  name: string;
  /** Unprefixed path ("/pricing"); the last crumb is the current page. */
  path: string;
}

/** Visible breadcrumbs plus their BreadcrumbList JSON-LD (paths localized for the page's locale). */
export function Breadcrumbs({ items, locale, label, className }: { items: Crumb[]; locale: Locale; label: string; className?: string }) {
  return (
    <>
      <JsonLd data={breadcrumbLd(items.map((c) => ({ name: c.name, path: localizedPath(locale, c.path) })))} />
      <nav aria-label={label} className={cx("text-[0.86rem] text-ink-3", className)}>
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={c.path} className="flex min-w-0 items-center gap-1">
                {last ? (
                  <span aria-current="page" className="truncate text-ink-2">
                    {c.name}
                  </span>
                ) : (
                  <>
                    <Link href={c.path} className="press rounded-full py-1 transition-colors hover:text-ink">
                      {c.name}
                    </Link>
                    <ChevronRight size={14} className="shrink-0 text-ink-4" aria-hidden />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ page hero */

/** The top of every inner page: crumbs, eyebrow, the one <h1>, a lede and optional actions. */
export function PageHero({
  crumbs,
  eyebrow,
  title,
  lede,
  actions,
  children,
  align = "left",
  className,
}: {
  crumbs?: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <Container className={cx("pt-8 sm:pt-12", className)}>
      {crumbs}
      <div className={cx("mt-8 sm:mt-10", centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl")}>
        <p className={cx("eyebrow eyebrow-dot eyebrow-accent", centered && "justify-center")}>{eyebrow}</p>
        <h1 className="display mt-5 text-[2.5rem] text-ink sm:text-[3.6rem] lg:text-[4.1rem]">{title}</h1>
        {lede ? <p className="dek mt-6 max-w-2xl text-[1.1rem] sm:text-[1.22rem]">{lede}</p> : null}
        {actions ? <div className={cx("mt-8 flex flex-col gap-3 sm:flex-row", centered && "sm:justify-center")}>{actions}</div> : null}
        {children}
      </div>
    </Container>
  );
}

/* ------------------------------------------------------------------ call to action */

/** The closing pane of a page: always dark, one clear next step. */
export function CtaPane({
  title,
  body,
  primary,
  secondary,
  footnote,
}: {
  title: ReactNode;
  body?: ReactNode;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
  footnote?: ReactNode;
}) {
  return (
    <div className="pane-ink overflow-hidden px-6 py-12 text-center sm:px-12 sm:py-16">
      <div className="mx-auto w-fit">
        <LogoMark size={40} tone="light" />
      </div>
      <h2 className="display mx-auto mt-6 max-w-2xl text-[2.1rem] text-ink sm:text-[3rem]">{title}</h2>
      {body ? <p className="mx-auto mt-4 max-w-xl text-[1.04rem] leading-relaxed text-ink-3">{body}</p> : null}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink href={primary.href} prefetch={false} size="lg" iconRight={<ArrowUpRight size={18} aria-hidden />}>
          {primary.label}
        </ButtonLink>
        {secondary ? (
          <ButtonLink href={secondary.href} variant="ghost" size="lg">
            {secondary.label}
          </ButtonLink>
        ) : null}
      </div>
      {footnote ? <p className="mx-auto mt-6 max-w-lg text-[0.86rem] leading-relaxed text-ink-4">{footnote}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ lists */

/** A list with a small check in a pine dot: for "what's included" style lists. */
export function CheckList({ items, className, tone = "pine" }: { items: ReactNode[]; className?: string; tone?: "pine" | "accent" }) {
  return (
    <ul className={cx("space-y-2.5", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[0.97rem] leading-relaxed text-ink-2">
          <span
            aria-hidden
            className={cx(
              "mt-[3px] grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full",
              tone === "pine" ? "bg-pine-soft text-pine" : "bg-accent-soft text-accent-text",
            )}
          >
            <Check size={13} strokeWidth={2.6} />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A plain list with the scout dot as the marker. */
export function DotList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx("space-y-2.5", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[0.97rem] leading-relaxed text-ink-2">
          <span aria-hidden className="mt-[0.62em] h-1.5 w-1.5 shrink-0 rounded-full bg-pine" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ FAQ */

export interface FaqItem {
  id: string;
  q: string;
  a: string;
  more?: { href: string; label: string };
}

/**
 * Questions as native <details> (works without JavaScript; each has an anchor). Opening one
 * by URL hash is handled by <FaqHashOpener>.
 */
export function FaqList({ items, className }: { items: FaqItem[]; className?: string }) {
  return (
    <div className={cx("pane divide-y divide-[var(--line)] px-2 sm:px-3", className)}>
      {items.map((f) => (
        <details key={f.id} id={f.id} className="group scroll-mt-28 px-3 sm:px-4">
          <summary className="press flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[1.02rem] font-semibold leading-snug text-ink [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{f.q}</span>
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-pane-2 text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] transition-transform duration-300 group-open:rotate-45"
            >
              <Plus size={16} />
            </span>
          </summary>
          <div className="pb-5 pr-2 sm:pr-12">
            <p className="text-[0.98rem] leading-relaxed text-ink-3">
              <Rich text={f.a} />
            </p>
            {f.more ? (
              <Link
                href={f.more.href}
                locale={f.more.href.startsWith("/opportunities") ? "en" : undefined}
                className="press mt-3 inline-flex min-h-[40px] items-center gap-1.5 text-[0.92rem] font-medium text-accent-text"
              >
                {f.more.label}
                <ArrowRight size={15} aria-hidden />
              </Link>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ small typographic pieces */

/** Section number in display type: "01". */
export function StepNumber({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cx("num font-display text-[1.5rem] font-semibold leading-none text-accent-text", className)}>
      {String(n).padStart(2, "0")}
    </span>
  );
}
