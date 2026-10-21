"use client";

import { Check, CircleAlert, CircleCheck, Copy, Info, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { buttonClasses, cx, type ButtonSize, type ButtonVariant } from "./ui";

/* ======================================================================= Dialog */

/**
 * Modal built on the native <dialog> (focus trap, Esc, top layer for free). Bottom sheet on
 * phones, centered floating pane from 640px. Controlled: `open` + `onClose`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  className,
  hideClose = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions row (pinned under the body). */
  footer?: ReactNode;
  /** Max width in px on wide screens. */
  width?: number;
  className?: string;
  hideClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const t = useTranslations("common.a11y");
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const root = document.documentElement;
      const prev = root.style.overflow;
      root.style.overflow = "hidden";
      return () => {
        root.style.overflow = prev;
      };
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      style={{ "--dialog-w": `${width}px` } as CSSProperties}
      onClose={() => onCloseRef.current()}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      {open ? (
        <div className={cx("dialog-panel pane flex flex-col", className)}>
          <div className="px-5 pt-3 sm:px-7 sm:pt-6">
            <div className="sheet-grip mb-3" aria-hidden="true" />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id={titleId} className="title text-[1.3rem] text-ink">
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-3">
                    {description}
                  </p>
                ) : null}
              </div>
              {hideClose ? null : (
                <button
                  type="button"
                  onClick={() => onCloseRef.current()}
                  className={buttonClasses({ variant: "quiet", size: "sm", iconOnly: true, className: "-mr-2 -mt-1 shrink-0" })}
                  aria-label={t("close")}
                >
                  <X size={18} aria-hidden />
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 px-5 pb-5 pt-4 sm:px-7 sm:pb-7">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-7">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/* ======================================================================= Tabs */

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

/**
 * Accessible tabs (roving focus, ←/→/Home/End). Switching is instant: the active state
 * flips on press. Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
 * Pass `panels` (id → content) to let Tabs render the tabpanel.
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  panels,
  label,
  className,
  size = "md",
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  panels?: Record<string, ReactNode>;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? "");
  const active = value ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.id === active);
    let next: TabItem | undefined;
    if (e.key === "ArrowRight") next = enabled[(idx + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div className={cx("min-w-0", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="scroll-row w-fit max-w-full rounded-full bg-pane-2 p-1 shadow-[inset_0_0_0_1px_var(--line)]"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={panels ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              onKeyDown={onKey}
              className={cx(
                "press inline-flex items-center gap-2 rounded-full font-medium transition-colors disabled:opacity-40",
                size === "sm" ? "min-h-[34px] px-3 text-[0.86rem]" : "min-h-[40px] px-4 text-[0.93rem]",
                selected ? "bg-pane text-ink shadow-[0_0_0_1px_var(--line-2),0_4px_10px_-6px_rgba(18,22,20,0.3)]" : "text-ink-3 hover:text-ink",
              )}
            >
              {item.label}
              {typeof item.count === "number" ? (
                <span className={cx("num rounded-full px-1.5 text-[0.78rem]", selected ? "bg-pane-2 text-ink-2" : "text-ink-4")}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {panels ? (
        <div role="tabpanel" id={`${baseId}-panel-${active}`} aria-labelledby={`${baseId}-tab-${active}`} className="mt-5 min-w-0" tabIndex={0}>
          {panels[active]}
        </div>
      ) : null}
    </div>
  );
}

/* ======================================================================= Toasts */

export type ToastTone = "info" | "success" | "error" | "warn";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** ms; default 4500 (errors 7000). 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends Required<Pick<ToastInput, "title" | "tone" | "duration">> {
  id: string;
  body?: string;
  action?: ToastInput["action"];
}

let toasts: ToastItem[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 0;

function emitToasts() {
  for (const l of toastListeners) l();
}

/**
 * Show a toast from anywhere (no provider needed): `toast("Saved")`,
 * `toast.error("That didn't save")`, `toast({ title, body, action })`. Returns its id.
 */
function showToast(input: string | ToastInput): string {
  const i = typeof input === "string" ? { title: input } : input;
  const tone = i.tone ?? "info";
  const item: ToastItem = {
    id: `t${++toastSeq}`,
    title: i.title,
    body: i.body,
    tone,
    duration: i.duration ?? (tone === "error" ? 7000 : 4500),
    action: i.action,
  };
  toasts = [...toasts.slice(-3), item];
  emitToasts();
  return item.id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

export const toast = Object.assign(showToast, {
  success: (title: string, opts: Omit<ToastInput, "title" | "tone"> = {}) => showToast({ ...opts, title, tone: "success" }),
  error: (title: string, opts: Omit<ToastInput, "title" | "tone"> = {}) => showToast({ ...opts, title, tone: "error" }),
  warn: (title: string, opts: Omit<ToastInput, "title" | "tone"> = {}) => showToast({ ...opts, title, tone: "warn" }),
  info: (title: string, opts: Omit<ToastInput, "title" | "tone"> = {}) => showToast({ ...opts, title, tone: "info" }),
  dismiss: dismissToast,
});

/** Hook form of `toast` (stable identity), for components that prefer hooks. */
export function useToast() {
  return toast;
}

function subscribeToasts(cb: () => void) {
  toastListeners.add(cb);
  return () => {
    toastListeners.delete(cb);
  };
}
const EMPTY: ToastItem[] = [];

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info size={18} className="text-[#5FC2A0]" aria-hidden />,
  success: <CircleCheck size={18} className="text-[#5CC98F]" aria-hidden />,
  warn: <TriangleAlert size={18} className="text-[#E0B44C]" aria-hidden />,
  error: <CircleAlert size={18} className="text-[#FF8A5B]" aria-hidden />,
};

function ToastView({ item, dismissLabel }: { item: ToastItem; dismissLabel: string }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => dismissToast(item.id), 180);
  }, [item.id]);

  const start = useCallback(() => {
    if (item.duration <= 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(close, item.duration);
  }, [close, item.duration]);

  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  useEffect(() => {
    start();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [start]);

  return (
    <div
      className="toast pane-ink flex items-start gap-3 rounded-[20px] px-4 py-3.5"
      data-leaving={leaving ? "true" : undefined}
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <span className="mt-[1px] shrink-0">{TONE_ICON[item.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] font-semibold leading-snug text-ink">{item.title}</p>
        {item.body ? <p className="mt-0.5 text-[0.88rem] leading-snug text-ink-3">{item.body}</p> : null}
        {item.action ? (
          <button
            type="button"
            className="press mt-2 text-[0.88rem] font-semibold text-accent-text underline-offset-4 hover:underline"
            onClick={() => {
              item.action?.onClick();
              close();
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={dismissLabel}
        className="press -mr-1 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-pane-2 hover:text-ink"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Renders the toast stack. Mounted once per area by the `(app)` and `(site)` layouts.
 * On phones it sits above the signed-in tab bar automatically (CSS `--toast-offset`);
 * `offset` (px) overrides that.
 */
export function Toaster({ offset }: { offset?: number }) {
  const items = useSyncExternalStore(subscribeToasts, () => toasts, () => EMPTY);
  const t = useTranslations("common.toasts");
  const ref = useRef<HTMLDivElement>(null);
  const newest = items.length ? items[items.length - 1].id : null;

  // The region is a manual popover: re-showing it on every new toast lifts it into the top
  // layer above any open modal dialog. Browsers without the Popover API ignore the attribute
  // and render the region as a plain fixed element.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (newest) el.showPopover();
    } catch (e) {
      console.warn("[toast] popover unavailable", e);
    }
  }, [newest]);

  return (
    <div
      ref={ref}
      popover="manual"
      className="toast-region"
      aria-label={t("region")}
      role="region"
      style={offset === undefined ? undefined : ({ "--toast-offset": `${offset}px` } as CSSProperties)}
    >
      <div aria-live="polite" className="contents">
        {items.map((item) => (
          <ToastView key={item.id} item={item} dismissLabel={t("dismiss")} />
        ))}
      </div>
    </div>
  );
}

/* ======================================================================= CopyButton */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path (insecure origins, old Safari) */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * One-tap copy (the handoff panel's workhorse). Shows "Copied" the moment it is pressed;
 * if the clipboard refuses, it rolls back and says so in a toast.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  variant = "ghost",
  size = "sm",
  iconOnly = false,
  className,
  onCopied,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
  onCopied?: () => void;
}) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );

  const onClick = async () => {
    setCopied(true);
    if (reset.current) clearTimeout(reset.current);
    const ok = await copyText(text);
    if (!ok) {
      setCopied(false);
      toast.error(t("toasts.copyFailed"));
      return;
    }
    onCopied?.();
    reset.current = setTimeout(() => setCopied(false), 1600);
  };

  const idle = label ?? t("buttons.copy");
  const done = copiedLabel ?? t("buttons.copied");
  return (
    <button
      type="button"
      onClick={onClick}
      className={buttonClasses({ variant, size, iconOnly, className })}
      aria-label={iconOnly ? (copied ? done : idle) : undefined}
      aria-live="polite"
    >
      {copied ? <Check size={16} className="text-ok" aria-hidden /> : <Copy size={16} aria-hidden />}
      {iconOnly ? null : <span className="btn-label">{copied ? done : idle}</span>}
    </button>
  );
}
