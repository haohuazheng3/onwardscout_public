"use client";

import { useEffect } from "react";

/**
 * Opens the <details id="…"> a URL hash points at (/faq#refund), on load and when the hash
 * changes, so links into the FAQ land on an open answer. Renders nothing.
 */
export function FaqHashOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
