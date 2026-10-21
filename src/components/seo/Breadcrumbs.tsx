import { ChevronRight } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";
import { cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { breadcrumbLd, localizedPath } from "@/lib/seo";

export interface Crumb {
  name: string;
  /** Unprefixed path ("/opportunities/grants"). English-only pages pass English paths. */
  path: string;
}

/**
 * Visible breadcrumbs plus the matching BreadcrumbList JSON-LD (one source for both, so they
 * never disagree). The last crumb is the current page: shown, not linked. Long trails scroll
 * inside themselves on phones instead of wrapping into a wall of text.
 */
export function Breadcrumbs({
  items,
  className,
  ld = true,
  locale = "en",
}: {
  items: Crumb[];
  className?: string;
  /** Emit BreadcrumbList structured data (default true). */
  ld?: boolean;
  /** "en" for the English-only SEO pages (links render unprefixed). */
  locale?: "en" | "zh";
}) {
  const trail: Crumb[] = items[0]?.path === "/" ? items : [{ name: "Home", path: "/" }, ...items];
  return (
    <>
      {ld ? <JsonLd data={breadcrumbLd(trail.map((c) => ({ name: c.name, path: localizedPath(locale, c.path) })))} /> : null}
      <nav aria-label="Breadcrumb" className={cx("min-w-0", className)}>
        <ol className="scroll-row items-center gap-1 text-[0.86rem] text-ink-3">
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${c.path}-${i}`} className="flex min-w-0 items-center gap-1">
                {last ? (
                  <span aria-current="page" className="max-w-[16rem] truncate font-medium text-ink-2 sm:max-w-[28rem]">
                    {c.name}
                  </span>
                ) : (
                  <Link href={c.path} locale={locale} className="rounded-full px-1 py-1 hover:text-ink">
                    {c.name}
                  </Link>
                )}
                {last ? null : <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-4" />}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
