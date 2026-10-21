/**
 * Bilingual labels shared by every taxonomy. Data in src/lib/core is pure and isomorphic: it is
 * imported by server code, client components and tests alike, so nothing here touches the DB,
 * the network or Next.js.
 */
import { z } from "zod";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

/** A label written in both product languages. `zh` is Simplified Chinese as used in mainland China. */
export interface Bilingual {
  en: string;
  zh: string;
}

export const bilingualSchema = z.object({
  en: z.string().trim().min(1),
  zh: z.string().trim().min(1),
});

/** Picks the label for a locale; unknown locales fall back to English. */
export function localize(label: Bilingual, locale: Locale | string): string {
  return locale === "zh" ? label.zh : label.en;
}

/** Shorthand used by the data files: `bi("Jobs", "岗位")`. */
export function bi(en: string, zh: string): Bilingual {
  return { en, zh };
}

/** True when a string contains at least one CJK ideograph. */
export function hasCjk(text: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(text);
}
