"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Instant feedback for every navigation (the owner's rule: a press changes something on screen
 * at once, whatever the network does). On pointer-down of any same-origin link — before the
 * router has fetched anything — a thin accent bar appears at the top of the viewport and keeps
 * creeping forward; it completes and fades the moment the URL changes. Full page loads (another
 * locale's root layout) show it too until the browser leaves. Pages keep their own skeletons;
 * this bar is the one signal that also covers static marketing/SEO pages without loading.tsx.
 */
function isPlainNavigation(e: PointerEvent | MouseEvent | KeyboardEvent, a: HTMLAnchorElement): boolean {
  if ("button" in e && e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (a.target && a.target !== "_self") return false;
  if (a.hasAttribute("download")) return false;
  let url: URL;
  try {
    url = new URL(a.href, location.href);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  // Same page (hash jumps or the current URL) is not a navigation.
  if (url.pathname === location.pathname && url.search === location.search) return false;
  return true;
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const key = `${pathname}?${search?.toString() ?? ""}`;
  const started = useRef<string | null>(null);

  useEffect(() => {
    const start = (e: PointerEvent | MouseEvent | KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e instanceof KeyboardEvent && e.key !== "Enter") return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !isPlainNavigation(e, a)) return;
      started.current = key;
      setState("running");
    };
    document.addEventListener("pointerdown", start, { capture: true });
    document.addEventListener("keydown", start, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", start, { capture: true });
      document.removeEventListener("keydown", start, { capture: true });
    };
  }, [key]);

  // The URL changed: finish the bar.
  useEffect(() => {
    if (started.current !== null && started.current !== key) {
      started.current = null;
      setState("done");
      const t = setTimeout(() => setState("idle"), 320);
      return () => clearTimeout(t);
    }
  }, [key]);

  // A press that never navigated (cancelled, prevented, same page): give up quietly.
  useEffect(() => {
    if (state !== "running") return;
    const t = setTimeout(() => {
      started.current = null;
      setState("idle");
    }, 12_000);
    return () => clearTimeout(t);
  }, [state]);

  return <div className="nav-feedback" data-state={state} role="presentation" aria-hidden="true" />;
}

export function NavFeedback() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
