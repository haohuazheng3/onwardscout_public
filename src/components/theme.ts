export type ThemeChoice = "system" | "light" | "dark";

/** localStorage key holding an explicit choice ("dark" | "system"); absent = light, the default. */
export const THEME_KEY = "os-theme";
export const THEME_EVENT = "os:theme";

/**
 * Inline, pre-paint (in <head>): restores an explicit theme choice before the first frame, so a
 * visitor who picked Dark never sees a light flash. Nothing stored means light, whatever the OS
 * prefers; "system" (Auto) lets the CSS follow the OS.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||t==='system'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
