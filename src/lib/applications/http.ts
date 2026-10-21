import "server-only";
import { jsonError } from "@/lib/errors";
import { ApplicationError } from "./engine";

/*
 * Route-handler helpers for /api/applications/**: JSON with no-store, and ApplicationError →
 * a human sentence with the right status (402 when credits run short, 404, 409…).
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Maps engine errors to responses; rethrows anything else (withErrorCapture logs it). */
export function fromError(err: unknown): Response {
  if (err instanceof ApplicationError) {
    return Response.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status, headers: NO_STORE });
  }
  throw err;
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export const BAD_INPUT = () => jsonError("That request isn't valid. Reload the page and try again.", 400);
export const NOT_FOUND = () => jsonError("We couldn't find that application.", 404);

/** Application ids look like app_<16 chars>; anything else is a 404 without a query. */
export function isAppId(id: string): boolean {
  return /^app_[0-9a-hjkmnp-tv-z]{6,40}$/.test(id);
}
