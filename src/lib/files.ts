import "server-only";
import { createHmac } from "node:crypto";
import { requireEnv } from "./env";

/**
 * Private files live in the R2 bucket `onwardscout` behind the `onwardscout-files` Cloudflare
 * Worker (files.onwardscout.com). The site never holds R2 credentials:
 *  - browsers read with short-lived HMAC-signed URLs (`GET /d/<key>?exp&disp&name&sig`, Range
 *    supported) and upload straight to the worker with signed `PUT /u/<key>?exp&ct&max&sig` links;
 *  - the server reads, writes, lists and deletes through the bearer-protected `/o/<key>` and `/list`.
 *
 * Bucket layout (one place, so cleanups and data deletion can rely on it):
 *   docs/<userId>/<docId>.<ext>            user uploads (résumé, deck, portfolio…)
 *   generated/<userId>/<genId>.<ext>       rendered documents (PDF, DOCX, PPTX)
 *   screens/<userId>/<appId>/<n>.png       browser-agent step screenshots
 *   backups/<YYYY-MM-DD>.sql.gz            nightly database dumps (GitHub Actions)
 */

export type Disposition = "inline" | "attachment";

function base(): string {
  return requireEnv("FILES_BASE_URL").replace(/\/+$/, "");
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
}

function hmac(payload: string): string {
  return createHmac("sha256", requireEnv("FILES_SIGNING_SECRET")).update(payload).digest("hex");
}

/* ---------- object keys ---------- */

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function segment(v: string, what: string): string {
  if (!SAFE_SEGMENT.test(v)) throw new Error(`unsafe ${what} for an object key`);
  return v;
}

function extension(ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(clean)) throw new Error("unsafe file extension for an object key");
  return clean;
}

/** `docs/<userId>/<docId>.<ext>`: a file the user uploaded. */
export function docKey(userId: string, docId: string, ext: string): string {
  return `docs/${segment(userId, "user id")}/${segment(docId, "document id")}.${extension(ext)}`;
}

/** `generated/<userId>/<genId>.<ext>`: a document we rendered for the user. */
export function generatedKey(userId: string, genId: string, ext: string): string {
  return `generated/${segment(userId, "user id")}/${segment(genId, "generated document id")}.${extension(ext)}`;
}

/** `screens/<userId>/<appId>/<n>.png`: screenshot of browser-agent step `n` of an application. */
export function screenKey(userId: string, appId: string, n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error("unsafe step number for an object key");
  return `screens/${segment(userId, "user id")}/${segment(appId, "application id")}/${n}.png`;
}

/** `backups/<YYYY-MM-DD>.sql.gz`: the nightly database dump for a UTC date. */
export function backupKey(date: Date | string): string {
  const day = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("backup date must be YYYY-MM-DD");
  return `backups/${day}.sql.gz`;
}

/** Every key prefix that holds one user's data (data export and account deletion walk these). */
export function userPrefixes(userId: string): string[] {
  const u = segment(userId, "user id");
  return [`docs/${u}/`, `generated/${u}/`, `screens/${u}/`];
}

/* ---------- signed browser links ---------- */

/** Exactly what the worker verifies for `/d/`: HMAC over key, exp, disposition and filename. */
export function signReadPayload(key: string, exp: number, disposition: Disposition, filename: string): string {
  return hmac([key, String(exp), disposition, filename].join("\n"));
}

/** Exactly what the worker verifies for `/u/`: HMAC over "upload", key, exp, content type and byte cap. */
export function signUploadPayload(key: string, exp: number, contentType: string, maxBytes: number): string {
  return hmac(["upload", key, String(exp), contentType, String(maxBytes)].join("\n"));
}

/** A short-lived link the browser can open or download (default 10 minutes). */
export function signedReadUrl(key: string, opts: { disposition: Disposition; filename: string; ttlSeconds?: number }): string {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 600);
  const sig = signReadPayload(key, exp, opts.disposition, opts.filename);
  const qs = new URLSearchParams({ exp: String(exp), disp: opts.disposition, name: opts.filename, sig });
  return `${base()}/d/${encodeKey(key)}?${qs.toString()}`;
}

/**
 * A short-lived upload link (default 15 minutes): the browser PUTs the file with exactly
 * `Content-Type: contentType`, and the worker refuses bodies larger than `maxBytes`.
 */
export function signedUploadUrl(key: string, opts: { contentType: string; maxBytes: number; ttlSeconds?: number }): string {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 900);
  const max = Math.max(1, Math.floor(opts.maxBytes));
  const sig = signUploadPayload(key, exp, opts.contentType, max);
  const qs = new URLSearchParams({ exp: String(exp), ct: opts.contentType, max: String(max), sig });
  return `${base()}/u/${encodeKey(key)}?${qs.toString()}`;
}

/* ---------- server-to-server object API ---------- */

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requireEnv("FILES_API_TOKEN")}` };
}

export interface ObjectHead {
  bytes: number;
  contentType: string;
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  const res = await fetch(`${base()}/o/${encodeKey(key)}`, { method: "HEAD", headers: authHeaders(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`files worker HEAD ${key} answered ${res.status}`);
  return {
    bytes: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Streams an object from the bucket; the caller owns the response body. Null when missing. */
export async function getObject(key: string): Promise<Response | null> {
  const res = await fetch(`${base()}/o/${encodeKey(key)}`, { headers: authHeaders(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`files worker GET ${key} answered ${res.status}`);
  return res;
}

export async function readObject(key: string): Promise<Uint8Array | null> {
  const res = await getObject(key);
  if (!res) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Writes an object. A ReadableStream body is forwarded without buffering, which keeps large
 * renders and screenshots inside a function's memory limit.
 */
export async function putObject(key: string, body: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, contentType: string): Promise<{ bytes: number | null }> {
  const streaming = body instanceof ReadableStream;
  const init: RequestInit & { duplex?: "half" } = {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": contentType },
    body: streaming ? body : Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body),
    ...(streaming ? { duplex: "half" } : {}),
  };
  const res = await fetch(`${base()}/o/${encodeKey(key)}`, init);
  if (!res.ok) throw new Error(`files worker PUT ${key} answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = (await res.json().catch(() => ({}))) as { size?: number | null };
  return { bytes: typeof data.size === "number" ? data.size : null };
}

export async function deleteObject(key: string): Promise<void> {
  const res = await fetch(`${base()}/o/${encodeKey(key)}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`files worker DELETE ${key} answered ${res.status}`);
}

export interface ListedObject {
  key: string;
  bytes: number;
  uploaded: string;
}

/** One page (≤ 1000) of keys under a prefix; pass the returned cursor for the next page. */
export async function listObjects(prefix: string, cursor?: string): Promise<{ objects: ListedObject[]; cursor: string | null }> {
  if (!prefix || prefix.includes("..")) throw new Error("listObjects needs a concrete prefix");
  const qs = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
  const res = await fetch(`${base()}/list?${qs.toString()}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`files worker LIST ${prefix} answered ${res.status}`);
  const data = (await res.json()) as { objects?: ListedObject[]; cursor?: string | null; truncated?: boolean };
  return { objects: data.objects ?? [], cursor: data.truncated && data.cursor ? data.cursor : null };
}

/** Deletes every object of a user (account deletion). Returns how many keys were removed. */
export async function deleteUserObjects(userId: string): Promise<number> {
  let removed = 0;
  for (const prefix of userPrefixes(userId)) {
    let cursor: string | undefined;
    do {
      const page = await listObjects(prefix, cursor);
      for (const o of page.objects) {
        await deleteObject(o.key);
        removed++;
      }
      cursor = page.cursor ?? undefined;
    } while (cursor);
  }
  return removed;
}
