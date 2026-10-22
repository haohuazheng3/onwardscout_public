import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { PostImage } from "@/lib/blog";
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

/** Pexels CDN URL at a given width (compressed, modern format when the browser accepts it). */
export function pexelsAt(src: string, w: number): string {
  return `${src}?auto=compress&cs=tinysrgb&fm=webp&w=${w}`;
}

/**
 * A photo from the article's frontmatter, placed in the body with <Photo n="1" />. Served from
 * the Pexels CDN at the width the layout needs (no image optimisation on our side), with
 * intrinsic size for zero layout shift and the photographer credited as Pexels asks.
 */
export function Photo({ image, priority = false }: { image: PostImage; priority?: boolean }) {
  const widths = [480, 720, 960, 1280];
  return (
    <figure className="my-8">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the Pexels CDN at fixed widths; next/image would proxy and bill it */}
      <img
        src={pexelsAt(image.src, 960)}
        srcSet={widths.map((w) => `${pexelsAt(image.src, w)} ${w}w`).join(", ")}
        sizes="(min-width: 1024px) 760px, calc(100vw - 72px)"
        width={image.width}
        height={image.height}
        alt={image.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="h-auto w-full rounded-[20px] bg-pane-3 object-cover"
        style={{ aspectRatio: `${image.width} / ${image.height}`, maxHeight: "460px" }}
      />
      <figcaption className="mt-2 text-[0.8rem] text-ink-4">
        Photo by{" "}
        <a href={image.photographerUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-ink-3">
          {image.photographer}
        </a>{" "}
        on{" "}
        <a href={image.pexelsUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-line-2 underline-offset-2 hover:text-ink-3">
          Pexels
        </a>
      </figcaption>
    </figure>
  );
}
