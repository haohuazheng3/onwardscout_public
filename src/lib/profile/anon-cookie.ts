import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * The anonymous draft cookie (contracts §8): `/app/start` works before sign-in. Everything a
 * signed-out visitor drops in is stored under the user id `anon_<16 chars>`, named by an
 * httpOnly cookie whose value is `<anonId>.<hmac>`. The HMAC key is derived from CRON_SECRET,
 * so a visitor cannot forge or guess somebody else's draft id. Pure (node:crypto only).
 */

export const ANON_COOKIE = "os_anon";

/** `anon_` + 16 characters of the id alphabet (lowercase, no i l o u). */
export const ANON_ID_PATTERN = /^anon_[0-9a-hjkmnp-tv-z]{16}$/;

/** 30 days: long enough to come back the next day and finish. */
export const ANON_COOKIE_MAX_AGE = 30 * 24 * 3600;

export function isAnonId(value: unknown): value is string {
  return typeof value === "string" && ANON_ID_PATTERN.test(value);
}

function keyFrom(secret: string): Buffer {
  return createHmac("sha256", "onwardscout:anon-draft").update(secret).digest();
}

export function anonSignature(anonId: string, secret: string): string {
  return createHmac("sha256", keyFrom(secret)).update(anonId).digest("hex").slice(0, 32);
}

/** Cookie value for an anonymous id. */
export function signAnonId(anonId: string, secret: string): string {
  if (!isAnonId(anonId)) throw new Error("Not an anonymous draft id");
  if (!secret) throw new Error("Anonymous drafts need a signing secret");
  return `${anonId}.${anonSignature(anonId, secret)}`;
}

/** The anonymous id inside a cookie value, or null when it is missing, malformed or forged. */
export function verifyAnonCookie(value: string | null | undefined, secret: string | null | undefined): string | null {
  if (!value || !secret) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!isAnonId(id) || !/^[0-9a-f]{32}$/.test(sig)) return null;
  const expected = Buffer.from(anonSignature(id, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}
