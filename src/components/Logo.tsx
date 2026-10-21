import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/*
 * The mark — "the scout ahead". A bold forward chevron (the direction: onward) and a small
 * dot ahead of it on the same line of travel (the scout who went first and found the way).
 * 32-unit grid; round caps and joins; one colour or two, never a gradient. Reads at 16 px.
 *
 * scripts/gen-icons.mjs parses these three constants out of this file, so every raster
 * icon, the favicon and the OG image are drawn from exactly this geometry.
 */
export const MARK_CHEVRON = "M6.5 7 L16.5 16 L6.5 25";
export const MARK_STROKE = 5.5;
export const MARK_DOT = { cx: 25.5, cy: 16, r: 3.25 } as const;

export type LogoTone = "ink" | "light" | "accent" | "mono";

const TONES: Record<Exclude<LogoTone, "mono">, { chevron: string; dot: string }> = {
  ink: { chevron: "var(--ink)", dot: "var(--pine)" },
  /** On always-dark surfaces (.pane-ink), in both site themes. */
  light: { chevron: "#F2F4F1", dot: "#5FC2A0" },
  accent: { chevron: "var(--accent)", dot: "var(--pine)" },
};

/** The mark alone. `tone="mono"` draws chevron and dot in `currentColor`. */
export function LogoMark({
  size = 28,
  tone = "ink",
  className = "",
  title,
}: {
  size?: number;
  tone?: LogoTone;
  className?: string;
  /** Accessible name; omit when the mark sits next to visible text (it is then decorative). */
  title?: string;
}) {
  const c = tone === "mono" ? { chevron: "currentColor", dot: "currentColor" } : TONES[tone];
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        d={MARK_CHEVRON}
        fill="none"
        stroke={c.chevron}
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill={c.dot} />
    </svg>
  );
}

/** The wordmark, set in Bricolage Grotesque: tight, slightly condensed, confident. */
export function Wordmark({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap font-display font-bold leading-none tracking-[-0.03em] ${light ? "text-[#F2F4F1]" : "text-ink"} ${className}`}
      style={{ fontVariationSettings: '"opsz" 32, "wdth" 92' }}
    >
      Onward Scout
    </span>
  );
}

/** Mark + wordmark as one unit (not a link). */
export function Logo({ size = 28, className = "", light = false }: { size?: number; className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} tone={light ? "light" : "ink"} className="shrink-0" />
      <Wordmark className="text-[1.14rem]" light={light} />
    </span>
  );
}

/**
 * The logo as a home link (localized: "/" in English, "/zh" in Chinese). Pass
 * `wordmark={false}` where only the mark fits.
 */
export function LogoLink({
  href = "/",
  size = 28,
  className = "",
  light = false,
  label,
  wordmark = true,
}: {
  href?: string;
  size?: number;
  className?: string;
  light?: boolean;
  /** Accessible name; defaults to "Onward Scout, home". */
  label?: string;
  wordmark?: boolean;
}) {
  const t = useTranslations("common.a11y");
  return (
    <Link
      href={href}
      aria-label={label ?? t("home")}
      className={`press group inline-flex min-h-[44px] items-center gap-2 rounded-full pr-1 ${className}`}
    >
      <LogoMark size={size} tone={light ? "light" : "ink"} className="shrink-0 transition-transform duration-500 ease-out group-hover:translate-x-[2px]" />
      {wordmark ? <Wordmark className="text-[1.14rem]" light={light} /> : null}
    </Link>
  );
}
