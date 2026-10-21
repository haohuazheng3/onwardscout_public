/*
 * Theme switching. The toggle itself is a client component (ThemeToggleClient.tsx); this
 * module stays server-safe so layouts can import THEME_SCRIPT as a real string (a server
 * component importing a constant from a "use client" module gets a reference, not the value).
 */
export { THEME_EVENT, THEME_KEY, THEME_SCRIPT, type ThemeChoice } from "./theme";
export { ThemeToggle, setTheme } from "./ThemeToggleClient";
