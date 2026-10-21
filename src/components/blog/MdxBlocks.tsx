import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Callout as UiCallout, type CalloutTone } from "@/components/ui";
import { Link } from "@/i18n/navigation";

/*
 * The building blocks available inside content/blog/**.mdx. All copy comes from the article
 * file; these components only give it the site's shape. Attributes are plain strings (the
 * MDX renderer blocks JavaScript expressions), so authors write <Callout tone="tip" …>.
 */

type MdxTone = "note" | "tip" | "warn";

const TONES: Record<MdxTone, CalloutTone> = { note: "info", tip: "ok", warn: "warn" };

/** An aside: context (note), a shortcut (tip) or a costly mistake (warn). */
export function Callout({ title, tone = "note", children }: { title?: string; tone?: MdxTone | string; children?: ReactNode }) {
  const t = TONES[(tone as MdxTone) in TONES ? (tone as MdxTone) : "note"];
  return (
    <UiCallout tone={t} title={title} className="my-7">
      {children}
    </UiCallout>
  );
}

/**
 * The answer-first block that sits right under an H2: one to three sentences (≤ 60 words,
 * checked at build) that answer the heading's question before the explanation starts.
 */
export function Answer({ children }: { children?: ReactNode }) {
  return (
    <div className="pane-inset relative my-6 overflow-hidden px-5 py-4 before:absolute before:inset-y-4 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent sm:px-6">
      <p className="eyebrow eyebrow-accent">In short</p>
      <div className="mt-1.5 text-[1.06rem] font-medium leading-relaxed text-ink [&_p+p]:mt-2">{children}</div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/**
 * A sourced number: `<DataPoint value="11,000" source="https://…" label="NSF">new awards a
 * year</DataPoint>`. The figure is set in tabular numerals, the sentence stays in the
 * paragraph and the citation follows as a small link to the source (required, checked at build).
 */
export function DataPoint({ value, source, label, children }: { value?: string; source?: string; label?: string; children?: ReactNode }) {
  const href = source && /^https:\/\//.test(source) ? source : null;
  return (
    <span className="text-ink">
      {value ? <strong className="num font-semibold text-ink">{value}</strong> : null}
      {value && children ? " " : null}
      {children}
      {href ? (
        <a
          href={href}
          rel="noopener noreferrer"
          target="_blank"
          className="ml-1 whitespace-nowrap align-baseline text-[0.78rem] font-semibold text-ink-4 no-underline hover:text-accent-text"
        >
          [{label ?? hostOf(href)}]
        </a>
      ) : null}
    </span>
  );
}

/** Links in article bodies: internal paths through the locale-aware Link (English-only pages), others open the source in a new tab. */
export function MdxLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} locale="en" {...rest}>
        {children}
      </Link>
    );
  }
  if (typeof href === "string" && href.startsWith("#")) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
