import type { KeyboardEvent } from "react";

/*
 * Keyboard behaviour for a group of buttons with role="radiogroup"/"radio" (the WAI-ARIA radio
 * pattern): one Tab stop for the whole group (the checked radio, else the first), and the arrow
 * keys (plus Home/End) move between the options. `select` runs for the newly focused option;
 * pass `null` where choosing has a heavy side effect (a language switch) — focus still moves and
 * Space/Enter chooses.
 */
export function radioKeys(index: number, count: number, checkedIndex: number, select: ((index: number) => void) | null) {
  const focusable = checkedIndex >= 0 ? index === checkedIndex : index === 0;
  return {
    tabIndex: focusable ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % count;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + count) % count;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = count - 1;
      if (next < 0) return;
      e.preventDefault();
      select?.(next);
      const radios = e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]');
      radios?.[next]?.focus();
    },
  };
}
