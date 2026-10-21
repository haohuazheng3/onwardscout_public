/*
 * Navigation structure shared by the header (client) and the footer (server). Kept out of
 * "use client" modules on purpose: a server component that imports a constant from a
 * client module receives a reference, not the value.
 */

/** Audience landing pages: /for/[audience]. */
export const AUDIENCES = ["students", "professionals", "founders", "researchers", "creators", "career-changers"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type AudienceMessageKey = "students" | "professionals" | "founders" | "researchers" | "creators" | "careerChangers";

/** Message key under `common.audiences` for an audience slug ("career-changers" → "careerChangers"). */
export function audienceKey(a: Audience): AudienceMessageKey {
  return a === "career-changers" ? "careerChangers" : a;
}
