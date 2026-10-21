/**
 * Message namespaces: one JSON file per namespace and locale at `messages/<locale>/<ns>.json`.
 * A feature edits only its own namespace file(s), English first; Chinese falls back to
 * English key by key until the translation pass fills it.
 */
export const NAMESPACES = [
  "common",
  "site",
  "onboarding",
  "profile",
  "scout",
  "applications",
  "billing",
  "admin",
  "settings",
  "legal",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** Provided to client components on every page by the `[locale]` layout. */
export const COMMON_NAMESPACES = ["common"] as const satisfies readonly Namespace[];

/** Provided to client components in the signed-in area by the `(app)` layout. */
export const APP_NAMESPACES = [
  "common",
  "onboarding",
  "profile",
  "scout",
  "applications",
  "billing",
  "admin",
  "settings",
] as const satisfies readonly Namespace[];

export function isNamespace(value: unknown): value is Namespace {
  return typeof value === "string" && (NAMESPACES as readonly string[]).includes(value);
}
