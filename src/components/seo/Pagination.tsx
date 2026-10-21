import { ArrowLeft, ArrowRight } from "lucide-react";
import { cx } from "@/components/ui";
import { Link } from "@/i18n/navigation";

/** Window of page numbers around the current one: 1 … 4 5 [6] 7 8 … 12. */
function pageWindow(page: number, total: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  const add = (n: number) => {
    if (n >= 1 && n <= total && !out.includes(n)) out.push(n);
  };
  add(1);
  if (page - 2 > 2) out.push("gap");
  for (let n = page - 2; n <= page + 2; n++) add(n);
  if (page + 2 < total - 1) out.push("gap");
  add(total);
  return out;
}

/** Numbered pagination for English-only hubs; `href(n)` gives each page's unprefixed path. */
export function Pagination({ page, totalPages, href, className }: { page: number; totalPages: number; href: (n: number) => string; className?: string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className={cx("flex flex-wrap items-center justify-center gap-2", className)}>
      {page > 1 ? (
        <Link href={href(page - 1)} locale="en" rel="prev" className="btn btn-ghost btn-sm">
          <ArrowLeft size={16} aria-hidden />
          <span className="btn-label">Previous</span>
        </Link>
      ) : null}
      {pageWindow(page, totalPages).map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} aria-hidden className="px-1 text-ink-4">
            …
          </span>
        ) : (
          <Link
            key={n}
            href={href(n)}
            locale="en"
            aria-current={n === page ? "page" : undefined}
            className={cx(
              "grid h-11 min-w-11 place-items-center rounded-full px-3 text-[0.92rem] font-semibold tabular-nums transition-transform active:scale-95",
              n === page ? "bg-ink text-void" : "bg-pane-2 text-ink-3 hover:text-ink",
            )}
          >
            {n}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={href(page + 1)} locale="en" rel="next" className="btn btn-ghost btn-sm">
          <span className="btn-label">Next</span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}
