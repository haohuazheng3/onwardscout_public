"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { THEME_EVENT as EVENT, THEME_KEY as KEY, type ThemeChoice as Choice } from "./theme";
import { radioKeys } from "./radio-keys";

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "light") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function readChoice(): Choice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light"; // storage unavailable (private mode): the default light theme applies
  }
}

export function setTheme(choice: Choice) {
  apply(choice);
  try {
    if (choice === "light") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable: the choice still applies to this page view */
  }
  window.dispatchEvent(new Event(EVENT));
}

const OPTIONS: { id: Choice; Icon: typeof Sun }[] = [
  { id: "light", Icon: Sun },
  { id: "dark", Icon: Moon },
  { id: "system", Icon: Monitor },
];

/** Three-way theme switch (Light, the default · Dark · Auto). `compact` shows icons only. */
export function ThemeToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const t = useTranslations("common.theme");
  const choice = useSyncExternalStore(subscribe, readChoice, () => "light" as Choice);

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className={`inline-flex items-center gap-0.5 rounded-full bg-pane-2 p-1 shadow-[inset_0_0_0_1px_var(--line)] ${className}`}
    >
      {OPTIONS.map(({ id, Icon }, i) => {
        const active = choice === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            {...radioKeys(i, OPTIONS.length, OPTIONS.findIndex((o) => o.id === choice), (n) => setTheme(OPTIONS[n].id))}
            aria-label={compact ? t(id) : undefined}
            title={compact ? t(id) : undefined}
            onClick={() => setTheme(id)}
            className={`press inline-flex min-h-[34px] items-center gap-1.5 rounded-full text-[0.84rem] font-medium transition-colors ${
              compact ? "w-[34px] justify-center" : "px-3"
            } ${active ? "bg-pane text-ink shadow-[0_0_0_1px_var(--line-2),0_2px_6px_-3px_rgba(18,22,20,0.25)]" : "text-ink-3 hover:text-ink"}`}
          >
            <Icon size={15} strokeWidth={2} aria-hidden />
            {compact ? null : <span>{t(id)}</span>}
          </button>
        );
      })}
    </div>
  );
}
