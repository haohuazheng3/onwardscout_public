export type ThemeChoice = "system" | "light" | "dark";

/** localStorage key holding an explicit choice ("light" | "dark"); absent = follow the OS. */
export const THEME_KEY = "os-theme";
export const THEME_EVENT = "os:theme";

/**
 * Inline, pre-paint (in <head>): restores an explicit theme choice before the first frame,
 * so a dark-mode visitor never sees a light flash. "Auto" stores nothing and follows the OS.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
