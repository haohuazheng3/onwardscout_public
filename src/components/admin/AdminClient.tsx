"use client";

import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses, cx, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

/*
 * Client pieces of the admin area: the section nav (highlights the pressed item at once) and
 * the submit button of every server-action form (flips to its pending label on press; the page
 * re-renders from the server when the action redirects back with a notice).
 */

const ADMIN_NAV = [
  { href: "/admin", key: "overview" },
  { href: "/admin/users", key: "users" },
  { href: "/admin/applications", key: "applications" },
  { href: "/admin/opportunities", key: "opportunities" },
  { href: "/admin/sources", key: "sources" },
  { href: "/admin/jobs", key: "jobs" },
  { href: "/admin/llm", key: "llm" },
  { href: "/admin/orders", key: "orders" },
  { href: "/admin/errors", key: "errors" },
  { href: "/admin/messages", key: "messages" },
  { href: "/admin/inbox", key: "inbox" },
  { href: "/admin/diagnostics", key: "diagnostics" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Side column from 1024px, a horizontally scrolling pill row below (inside its own lane). */
export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setPending(null);
  }
  return (
    <nav aria-label={t("label")} className="lg:sticky lg:top-6">
      <ul className="scroll-row -mx-4 gap-1.5 px-4 pb-1 lg:mx-0 lg:flex lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
        {ADMIN_NAV.map((item) => {
          const active = pending ? pending === item.href : isActive(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                onClick={() => setPending(item.href)}
                className={cx(
                  "press flex min-h-[40px] items-center rounded-full px-3.5 text-[0.9rem] font-semibold transition-colors lg:rounded-[14px] lg:px-3",
                  active ? "bg-accent-soft text-accent-text" : "text-ink-3 hover:bg-pane-2 hover:text-ink",
                )}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Submit button for a server-action form: pending state on press, never a dead click. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "ghost",
  size = "sm",
  className,
  disabled = false,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={buttonClasses({ variant, size, className })} disabled={disabled || pending} aria-busy={pending || undefined} name={name} value={value}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      <span className="btn-label">{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}

/** A spinner inside a Link while its navigation is pending (filter pills, table links). */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="spinner h-3.5 w-3.5" aria-hidden="true" /> : null;
}

/**
 * Search box for admin lists: client-side navigation in a transition, so the button shows its
 * busy state at once and the table swaps in place (no full page reload).
 */
export function AdminSearch({
  path,
  name = "q",
  defaultValue,
  label,
  placeholder,
  submitLabel,
  clearLabel,
  keep = {},
}: {
  path: string;
  name?: string;
  defaultValue: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  clearLabel: string;
  /** Other query parameters to keep (e.g. the active tab). */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(defaultValue);
  const go = (q: string) => {
    const params = new URLSearchParams(keep);
    if (q.trim()) params.set(name, q.trim());
    const qs = params.toString();
    start(() => router.push(qs ? `${path}?${qs}` : path));
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    go(value);
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
      <label htmlFor={`admin-search-${name}`} className="sr-only">
        {label}
      </label>
      <input
        id={`admin-search-${name}`}
        type="search"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder={placeholder}
        className="input sm:max-w-sm"
        autoComplete="off"
        maxLength={120}
      />
      <div className="flex gap-2">
        <button type="submit" className={buttonClasses({ variant: "ghost", size: "sm" })} aria-busy={pending || undefined}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          <span className="btn-label">{submitLabel}</span>
        </button>
        {defaultValue ? (
          <button
            type="button"
            className={buttonClasses({ variant: "quiet", size: "sm" })}
            onClick={() => {
              setValue("");
              go("");
            }}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
