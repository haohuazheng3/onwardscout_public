import { Fragment, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { isEnglishOnlyPath } from "@/i18n/paths";
import { cx } from "@/components/ui";
import { parseInline, splitHash } from "./inline-markup";

/**
 * Renders the tiny inline markup of ./inline-markup.ts. Internal paths go through the locale-aware Link
 * (English-only pages keep their canonical English URL); mailto: and https: render plain <a>.
 * Isomorphic and hook-free.
 */
export function Rich({ text, className, linkClassName = "link" }: { text: string; className?: string; linkClassName?: string }) {
  const nodes: ReactNode[] = parseInline(text).map((t, i) => {
    switch (t.kind) {
      case "text":
        return <Fragment key={i}>{t.text}</Fragment>;
      case "bold":
        return (
          <strong key={i} className="font-semibold text-ink">
            {t.text}
          </strong>
        );
      case "code":
        return (
          <code key={i} className="rounded-md bg-pane-2 px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
            {t.text}
          </code>
        );
      case "link": {
        if (t.href.startsWith("/")) {
          const { path, hash } = splitHash(t.href);
          return (
            <Link
              key={i}
              href={`${path}${hash}`}
              locale={isEnglishOnlyPath(path) ? "en" : undefined}
              className={cx(linkClassName)}
            >
              {t.text}
            </Link>
          );
        }
        const external = t.href.startsWith("https:");
        return (
          <a key={i} href={t.href} className={cx(linkClassName)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {t.text}
          </a>
        );
      }
    }
  });
  return className ? <span className={className}>{nodes}</span> : <>{nodes}</>;
}
