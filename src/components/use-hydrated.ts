"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => undefined;

/**
 * False on the server and during hydration, true afterwards. Anything that depends on
 * browser-only state (Clerk's session, localStorage, the clipboard) must wait for this,
 * or the first client render can differ from the server HTML and React discards the
 * whole tree (error #418).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
