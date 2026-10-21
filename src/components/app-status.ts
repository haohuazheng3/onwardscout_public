/*
 * The signed-in shell's live numbers (credits, unread notifications, "needs you") and the
 * pure parsing of where they come from: GET /api/me and pushed `os:app-status` events.
 * Server-safe (no "use client"), so it is testable and importable anywhere.
 */

export interface AppStatus {
  /** Credits available now; null until known. */
  available: number | null;
  /** Credits held by applications in progress. */
  reserved: number;
  unreadNotifications: number;
  needsYou: number;
  state: "idle" | "loading" | "ready" | "error";
}

/** What `updateAppStatus()` and the `os:app-status` event accept. */
export type AppStatusPatch = Partial<Pick<AppStatus, "available" | "reserved" | "unreadNotifications" | "needsYou">>;

/** Window event other features dispatch to push fresh numbers into the shell. */
export const APP_STATUS_EVENT = "os:app-status";

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** Keeps only well-typed, non-negative counts of a pushed patch (event payloads are untrusted shapes). */
export function sanitizePatch(detail: unknown): AppStatusPatch {
  if (typeof detail !== "object" || detail === null) return {};
  const o = detail as Record<string, unknown>;
  const patch: AppStatusPatch = {};
  const available = count(o.available);
  if (available !== undefined) patch.available = available;
  const reserved = count(o.reserved);
  if (reserved !== undefined) patch.reserved = reserved;
  const unread = count(o.unreadNotifications);
  if (unread !== undefined) patch.unreadNotifications = unread;
  const needsYou = count(o.needsYou);
  if (needsYou !== undefined) patch.needsYou = needsYou;
  return patch;
}

/**
 * Reads the fields the shell understands from GET /api/me and ignores everything else:
 * `balance.available` (or a top-level `credits`), `balance.reserved`, `unreadNotifications`,
 * `needsYou`. Missing fields simply leave the current value alone.
 */
export function parseAppStatus(body: unknown): AppStatusPatch {
  if (typeof body !== "object" || body === null) return {};
  const o = body as Record<string, unknown>;
  const balance = typeof o.balance === "object" && o.balance !== null ? (o.balance as Record<string, unknown>) : {};
  return sanitizePatch({
    available: balance.available ?? o.credits,
    reserved: balance.reserved,
    unreadNotifications: o.unreadNotifications,
    needsYou: o.needsYou,
  });
}
