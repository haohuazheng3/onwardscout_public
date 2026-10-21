import { clsx, type ClassValue } from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
  ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";
import { Link } from "@/i18n/navigation";

/*
 * Design-system primitives. This module has no hooks and no server-only imports, so it is
 * safe in server AND client components. Interactive pieces that need state (Dialog, Tabs,
 * Toasts, CopyButton) live in ./ui-client.tsx.
 *
 * Instant-interaction rule: every press changes state immediately — buttons scale on
 * :active, chips flip `data-selected` in the caller's optimistic state, `loading` shows a
 * spinner without disabling the visual weight. Data aligns afterwards.
 */

/**
 * Class names: falsy parts dropped, Tailwind conflicts resolved (the last one wins), so a
 * caller's `className` reliably overrides a component's defaults (e.g. `hidden md:inline-flex`).
 */
export function cx(...parts: ClassValue[]): string {
  return twMerge(clsx(parts));
}

/* ------------------------------------------------------------------ layout */

const CONTAINER_WIDTH = { sm: "max-w-[760px]", md: "max-w-[1180px]", lg: "max-w-[1320px]" } as const;

/** Page-width wrapper with the 16px mobile gutter (safe-area aware). */
export function Container({
  children,
  className,
  size = "md",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof CONTAINER_WIDTH;
  as?: ElementType;
}) {
  return <Tag className={cx("safe-x mx-auto w-full sm:px-6", CONTAINER_WIDTH[size], className)}>{children}</Tag>;
}

/** Vertical rhythm for marketing sections: lots of air between floating panes. */
export function Section({ children, className, id, size = "md" }: { children: ReactNode; className?: string; id?: string; size?: keyof typeof CONTAINER_WIDTH }) {
  return (
    <section id={id} className={cx("scroll-mt-28 pt-20 sm:pt-28", className)}>
      <Container size={size}>{children}</Container>
    </section>
  );
}

/** Section heading: it lives in the field, deliberately quiet, so the panes below carry the weight. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
  as: Heading = "h2",
  className,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  className?: string;
  /** Optional link/button aligned to the right on wide screens (left-aligned headings only). */
  action?: ReactNode;
}) {
  const centered = align === "center";
  return (
    <div
      className={cx(
        "mb-8 sm:mb-10",
        centered ? "mx-auto max-w-2xl text-center" : action ? "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" : "max-w-2xl",
        className,
      )}
    >
      <div className={cx("min-w-0", !centered && action ? "max-w-2xl" : undefined)}>
        {eyebrow ? <p className={cx("eyebrow eyebrow-dot", centered && "justify-center")}>{eyebrow}</p> : null}
        <Heading className="headline mt-3 text-[1.9rem] text-ink sm:text-[2.5rem]">{title}</Heading>
        {lede ? <p className="lede mt-3 sm:text-[1.1rem]">{lede}</p> : null}
      </div>
      {!centered && action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Header of a signed-in page: eyebrow, title, one line of context, actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between sm:pb-8", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow eyebrow-dot">{eyebrow}</p> : null}
        <h1 className="headline mt-2.5 text-[1.85rem] text-ink sm:text-[2.35rem]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[1rem] leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ panes */

type PaneOwnProps<T extends ElementType> = {
  as?: T;
  children?: ReactNode;
  className?: string;
  /** Lifts on hover, sinks on press (clickable cards). */
  hover?: boolean;
  /** Nested pane (20px radius, sunk into its parent). */
  inset?: boolean;
  /** Always-dark pane (both themes). */
  ink?: boolean;
  /** Frosted pane for floating chrome (headers, toolbars). */
  glass?: boolean;
  /** Inner padding preset. */
  pad?: "none" | "sm" | "md" | "lg";
};

const PAD = { none: "", sm: "p-4 sm:p-5", md: "p-5 sm:p-7", lg: "p-6 sm:p-10" } as const;

/** The floating module. Renders a <div> unless `as` says otherwise; other props pass through. */
export function Pane<T extends ElementType = "div">({
  as,
  children,
  className,
  hover = false,
  inset = false,
  ink = false,
  glass = false,
  pad = "none",
  ...rest
}: PaneOwnProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof PaneOwnProps<T>>) {
  const Tag = (as ?? "div") as ElementType;
  const base = ink ? "pane-ink" : inset ? "pane-inset" : glass ? "pane pane-glass" : "pane";
  return (
    <Tag className={cx(base, hover && "pane-hover", PAD[pad], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** One number with a label. Numerals in Geist with tabular figures. Pass `href` to make it a link. */
export function StatPane({
  label,
  value,
  hint,
  tone = "default",
  href,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "pine";
  href?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const valueColor = tone === "accent" ? "text-accent-text" : tone === "pine" ? "text-pine" : "text-ink";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {icon ? <span className="text-ink-4">{icon}</span> : null}
      </div>
      <p className={cx("num mt-3 text-[2.15rem] font-semibold leading-none tracking-[-0.03em]", valueColor)}>{value}</p>
      {hint ? <p className="mt-2.5 text-[0.88rem] leading-snug text-ink-3">{hint}</p> : null}
    </>
  );
  const classes = cx("pane block min-w-0 px-5 py-5 sm:px-6 sm:py-6", className);
  if (href) {
    return (
      <Link href={href} prefetch={false} className={cx(classes, "pane-hover")}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}

/* ------------------------------------------------------------------ buttons */

export type ButtonVariant = "primary" | "ghost" | "quiet" | "ink" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClasses({
  variant = "primary",
  size = "md",
  block = false,
  iconOnly = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconOnly?: boolean;
  className?: string;
} = {}): string {
  return cx(
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
    block && "btn-block",
    iconOnly && "btn-icon",
    className,
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cx("spinner", className)} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}

type ButtonProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner in place of the icon, sets aria-busy and blocks repeat presses. */
  loading?: boolean;
  /** Leading icon (lucide icon element). */
  icon?: ReactNode;
  /** Trailing icon. */
  iconRight?: ReactNode;
  /** Icon-only round button: give it an aria-label. */
  iconOnly?: boolean;
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  icon,
  iconRight,
  iconOnly = false,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, iconOnly, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {iconOnly ? null : children !== undefined ? <span className="btn-label">{children}</span> : null}
      {!loading && iconRight ? iconRight : null}
    </button>
  );
}

type LinkHref = ComponentPropsWithoutRef<typeof Link>["href"];

/**
 * A link that looks like a button. Internal paths go through the locale-aware Link;
 * absolute URLs, mailto: and tel: render a plain <a>.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  block = false,
  icon,
  iconRight,
  className,
  children,
  prefetch,
  locale,
  external,
  ...rest
}: Omit<ComponentPropsWithoutRef<"a">, "href" | "children"> & {
  href: LinkHref;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  prefetch?: boolean;
  /** Force a locale (e.g. "en" for English-only pages). */
  locale?: "en" | "zh";
  /** Open in a new tab (adds rel=noopener). */
  external?: boolean;
}) {
  const classes = buttonClasses({ variant, size, block, className });
  const content = (
    <>
      {icon}
      {children !== undefined ? <span className="btn-label">{children}</span> : null}
      {iconRight}
    </>
  );
  if (typeof href === "string" && /^(https?:|mailto:|tel:)/.test(href)) {
    return (
      <a href={href} className={classes} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={prefetch} locale={locale} className={classes} {...rest}>
      {content}
    </Link>
  );
}

/* ------------------------------------------------------------------ chips & tags */

/** A choice. Flip `selected` optimistically on press; it renders `data-selected` + aria-pressed. */
export function Chip({
  selected = false,
  size = "md",
  icon,
  count,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ComponentPropsWithRef<"button">, "children"> & {
  selected?: boolean;
  size?: "sm" | "md";
  icon?: ReactNode;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={cx("chip", size === "sm" && "chip-sm", className)}
      data-selected={selected ? "true" : undefined}
      aria-pressed={selected}
      {...rest}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {typeof count === "number" ? <span className={cx("num text-[0.8em]", selected ? "opacity-70" : "text-ink-4")}>{count}</span> : null}
    </button>
  );
}

export type TagTone = "default" | "accent" | "pine" | "ok" | "warn" | "bad" | "ink";

/** A label (status, type, source). Not interactive. */
export function Tag({
  tone = "default",
  dot = false,
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"span"> & { tone?: TagTone; dot?: boolean }) {
  return (
    <span className={cx("tag", tone !== "default" && `tag-${tone}`, dot && "tag-dot", className)} {...rest}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

export function Input({ invalid, className, ...rest }: ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  return <input className={cx("input", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ invalid, className, ...rest }: ComponentPropsWithRef<"textarea"> & { invalid?: boolean }) {
  return <textarea className={cx("textarea", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ invalid, className, children, ...rest }: ComponentPropsWithRef<"select"> & { invalid?: boolean }) {
  return (
    <select className={cx("select", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

/** ids to put in a control's aria-describedby for the hint/error a <Field> renders. */
export function fieldDescribedBy(id: string, { hint, error }: { hint?: ReactNode; error?: ReactNode }): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/**
 * Label + control + hint + error. Give the control `id={id}` and
 * `aria-describedby={fieldDescribedBy(id, { hint, error })}`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Small "optional" marker after the label (pass the localized word). */
  optional?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-ink-4">{optional}</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          <CircleAlert size={15} className="mt-[2px] shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A switch row: label + optional description + the switch. The switch thumb is the scout dot. */
export function Switch({
  label,
  description,
  className,
  id,
  ...rest
}: Omit<ComponentPropsWithRef<"input">, "type"> & { label: ReactNode; description?: ReactNode; id: string }) {
  return (
    <label htmlFor={id} className={cx("flex min-h-[52px] cursor-pointer items-center justify-between gap-4", className)}>
      <span className="min-w-0">
        <span className="block text-[0.98rem] font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-[0.86rem] leading-snug text-ink-3">{description}</span> : null}
      </span>
      <input id={id} type="checkbox" role="switch" className="switch" {...rest} />
    </label>
  );
}

/* ------------------------------------------------------------------ feedback */

/** Shimmer placeholder in the shape of what is loading. */
export function Skeleton({
  className,
  width,
  height,
  circle = false,
  style,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  style?: CSSProperties;
}) {
  return <span aria-hidden="true" className={cx("skeleton", circle && "skeleton-circle", className)} style={{ width, height, ...style }} />;
}

/** `lines` shimmering text bars of varied width. */
export function SkeletonText({ lines = 3, className, widths }: { lines?: number; className?: string; widths?: string[] }) {
  const fallback = ["100%", "94%", "78%", "88%", "64%", "90%"];
  return (
    <span className={cx("block space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="skeleton skeleton-text h-3.5" style={{ width: widths?.[i] ?? fallback[i % fallback.length] }} />
      ))}
    </span>
  );
}

/**
 * Progress along the trail: the fill is pine (or blaze), its leading end is the scout dot.
 * `value` and `max` are numbers; the bar clamps.
 */
export function Progress({
  value,
  max = 100,
  label,
  tone = "pine",
  showValue = false,
  className,
}: {
  value: number;
  max?: number;
  /** Accessible name (required for meaning). */
  label: string;
  tone?: "pine" | "accent";
  /** Prints "value / max" next to the label. */
  showValue?: boolean;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  return (
    <div className={cx("min-w-0", className)}>
      {showValue ? (
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[0.86rem]">
          <span className="truncate text-ink-2">{label}</span>
          <span className="num shrink-0 font-semibold text-ink">
            {clamped}
            <span className="font-normal text-ink-4"> / {safeMax}</span>
          </span>
        </div>
      ) : null}
      <div
        className="progress"
        data-tone={tone === "accent" ? "accent" : undefined}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export type CalloutTone = "info" | "ok" | "warn" | "bad" | "accent";

const CALLOUT: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: "bg-pine-soft text-ink", icon: <Info size={18} className="text-pine" aria-hidden /> },
  ok: { box: "bg-ok-soft text-ink", icon: <CircleCheck size={18} className="text-ok" aria-hidden /> },
  warn: { box: "bg-warn-soft text-ink", icon: <TriangleAlert size={18} className="text-warn" aria-hidden /> },
  bad: { box: "bg-bad-soft text-ink", icon: <CircleAlert size={18} className="text-bad" aria-hidden /> },
  accent: { box: "bg-accent-soft text-ink", icon: <Info size={18} className="text-accent-text" aria-hidden /> },
};

/** An inline note: honesty notices ("drafted from your profile"), warnings, confirmations. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = CALLOUT[tone];
  return (
    <div
      className={cx("flex gap-3 rounded-[var(--radius-inner)] px-4 py-3.5 sm:px-5", t.box, className)}
      role={tone === "bad" ? "alert" : undefined}
    >
      <span className="mt-[2px] shrink-0">{icon ?? t.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-[0.96rem] font-semibold leading-snug text-ink">{title}</p> : null}
        {children ? <div className={cx("text-[0.92rem] leading-relaxed text-ink-2", title ? "mt-1" : undefined)}>{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/** The trail drawing used by empty states: a dotted path that ends at the scout. */
export function TrailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 88 40" width={88} height={40} className={className} aria-hidden="true" focusable="false">
      <path
        d="M4 32 C 20 32, 22 12, 40 14 S 60 26, 70 18"
        fill="none"
        stroke="var(--line-2)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="0.1 7"
      />
      <path d="M66 11 L73.5 18 L66 25" fill="none" stroke="var(--ink-3)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="81" cy="18" r="3.2" fill="var(--pine)" />
    </svg>
  );
}

/** Nothing to show yet: say why, and offer the one next step. */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
  compact = false,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx("pane-inset text-center", compact ? "px-5 py-8" : "px-6 py-12 sm:px-10 sm:py-14", className)}>
      <div className="mx-auto flex w-fit justify-center">{icon ?? <TrailMark />}</div>
      <p className={cx("title mt-5 text-ink", compact ? "text-[1.12rem]" : "text-[1.3rem]")}>{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-[0.96rem] leading-relaxed text-ink-3">{body}</p> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("hairline", className)} />;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** A small status dot. `live` pulses gently (a running job, a scout at work). */
export function ScoutDot({ live = false, className }: { live?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx("scout-dot", live && "scout-dot-live", className)} />;
}
