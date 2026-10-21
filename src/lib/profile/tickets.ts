import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Upload tickets: the sign step hands the browser a short-lived, HMAC-signed description of
 * the upload it may complete (owner, document id, extension, content type, file name), so
 * the complete step needs no pending row and cannot be pointed at someone else's object.
 * Pure (node:crypto only).
 */

export interface UploadTicket {
  /** Owner: a user id or an anonymous draft id. */
  o: string;
  /** Document id (doc_…). */
  d: string;
  /** Extension of the object key. */
  e: string;
  /** Content type the browser uploads with. */
  c: string;
  /** Display file name. */
  n: string;
  /** Expiry, epoch seconds. */
  x: number;
}

function key(secret: string): Buffer {
  return createHmac("sha256", "onwardscout:upload-ticket").update(secret).digest();
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

export function signTicket(t: UploadTicket, secret: string): string {
  if (!secret) throw new Error("Upload tickets need a signing secret");
  const body = b64url(JSON.stringify(t));
  const sig = createHmac("sha256", key(secret)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The ticket, or null when it is malformed, forged or expired. */
export function verifyTicket(token: string | null | undefined, secret: string | null | undefined, now: number = Date.now()): UploadTicket | null {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(createHmac("sha256", key(secret)).update(body).digest("base64url"), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadTicket;
    if (typeof t.o !== "string" || typeof t.d !== "string" || typeof t.e !== "string" || typeof t.c !== "string" || typeof t.n !== "string" || typeof t.x !== "number") return null;
    if (t.x * 1000 < now) return null;
    return t;
  } catch {
    return null;
  }
}
