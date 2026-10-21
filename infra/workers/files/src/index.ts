/**
 * Onward Scout files worker (onwardscout-files): the only door to the private R2 bucket.
 *
 * GET|HEAD /d/<key>?exp&disp&name&sig   Signed read. The app signs
 *      HMAC-SHA256(SIGNING_SECRET, key \n exp \n disp \n name) for a limited time; we verify,
 *      then stream the object with the requested disposition. HTTP Range requests are honoured
 *      (206 + Content-Range) so PDF viewers can fetch pages incrementally.
 * PUT  /u/<key>?exp&ct&max&sig          Signed browser upload. The app signs
 *      HMAC-SHA256(SIGNING_SECRET, "upload" \n key \n exp \n ct \n max); the browser PUTs the
 *      file straight here. Content-Type must equal ct and the body may not exceed max bytes.
 * GET|HEAD|PUT|DELETE /o/<key>          Server-to-server object API, Bearer API_TOKEN.
 * GET  /list?prefix=<p>&cursor=<c>       Server-to-server listing (≤ 1000 keys per page), Bearer API_TOKEN;
 *      used by account deletion and data export. The prefix must name a concrete folder.
 * GET  /health
 *
 * CORS: /u and /d answer preflights and reflect the Origin when it is one of ALLOWED_ORIGINS,
 * a Vercel preview of the site, or the local dev server.
 */

export interface Env {
  BUCKET: R2Bucket;
  SIGNING_SECRET: string;
  API_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

type Disposition = "inline" | "attachment";

interface ByteRange {
  offset: number;
  length: number;
}

const SERVICE = "onwardscout-files";
const enc = new TextEncoder();

/* ---------- origins / CORS ---------- */

// Vercel preview and branch deployments of the site: onwardscout-<hash>-<team>.vercel.app,
// onwardscout-git-<branch>-<team>.vercel.app and the bare onwardscout.vercel.app.
const PREVIEW_ORIGIN = /^https:\/\/onwardscout(-[a-z0-9-]+)?\.vercel\.app$/;
const DEV_ORIGINS: ReadonlySet<string> = new Set(["http://localhost:3000"]);
const CORS_METHODS = "PUT,GET,HEAD,OPTIONS";
const CORS_HEADERS = "Content-Type, Range";
const CORS_EXPOSE = "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition, ETag";

function originAllowed(origin: string | null, env: Env): origin is string {
  if (!origin) return false;
  const exact = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return exact.includes(origin) || DEV_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
}

function applyCors(headers: Headers, origin: string | null, env: Env): void {
  headers.append("vary", "Origin");
  if (!originAllowed(origin, env)) return;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", CORS_EXPOSE);
}

function preflight(req: Request, env: Env): Response {
  const origin = req.headers.get("origin");
  const headers = new Headers({ vary: "Origin", "cache-control": "no-store" });
  if (!originAllowed(origin, env)) return new Response(null, { status: 403, headers });
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", CORS_METHODS);
  headers.set("access-control-allow-headers", CORS_HEADERS);
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

/* ---------- responses ---------- */

function baseHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers({ "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", ...extra });
  return h;
}

function text(body: string, status: number, origin: string | null = null, env?: Env): Response {
  const headers = baseHeaders({ "content-type": "text/plain; charset=utf-8" });
  if (env) applyCors(headers, origin, env);
  return new Response(body, { status, headers });
}

function json(body: unknown, status: number, origin: string | null = null, env?: Env): Response {
  const headers = baseHeaders({ "content-type": "application/json; charset=utf-8" });
  if (env) applyCors(headers, origin, env);
  return new Response(JSON.stringify(body), { status, headers });
}

/* ---------- crypto / auth ---------- */

function equal(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  let d = 0;
  for (let i = 0; i < x.byteLength; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signatureValid(secret: string, parts: string[], presented: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{64}$/i.test(presented)) return false;
  const expected = await hmacHex(secret, parts.join("\n"));
  return equal(expected, presented.toLowerCase());
}

function bearer(req: Request, token: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  const got = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return Boolean(token) && Boolean(got) && equal(got, token);
}

/* ---------- keys, names, ranges ---------- */

function keyFrom(pathname: string, prefix: string): string | null {
  const rest = pathname.slice(prefix.length);
  if (!rest) return null;
  try {
    const key = rest
      .split("/")
      .map((p) => decodeURIComponent(p))
      .join("/");
    if (key.includes("..") || key.startsWith("/") || key.includes("\0")) return null;
    return key;
  } catch {
    return null;
  }
}

function parseExpiry(raw: string | null): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  return Number(raw);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDisposition(disp: Disposition, name: string): string {
  const clean = name.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200);
  if (!clean) return disp;
  const ascii = clean.replace(/[^\x20-\x7e]/g, "").replace(/["\;]/g, "_").trim() || "download";
  return `${disp}; filename="${ascii}"; filename*=UTF-8''${rfc5987(clean)}`;
}

/**
 * RFC 7233 single byte range against a known size. Returns null when the header is absent or
 * not a single "bytes=" range (the full object is served with 200, which the RFC allows),
 * "unsatisfiable" when the range starts past the end.
 */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, first, last] = m;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
}

/* ---------- GET|HEAD /d/<key> : signed read ---------- */

async function signedRead(req: Request, env: Env, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  const key = keyFrom(url.pathname, "/d/");
  const exp = parseExpiry(url.searchParams.get("exp"));
  const dispParam = url.searchParams.get("disp") ?? "";
  const name = url.searchParams.get("name") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!key || exp === null || !sig) return text("Bad link.", 400, origin, env);
  const now = nowSeconds();
  if (now > exp) return text("This link has expired. Reload the page for a fresh one.", 403, origin, env);
  if (!(await signatureValid(env.SIGNING_SECRET, [key, String(exp), dispParam, name], sig))) return text("This link isn't valid.", 403, origin, env);
  const disp: Disposition = dispParam === "attachment" ? "attachment" : "inline";

  const head = await env.BUCKET.head(key);
  if (!head) return text("File not found.", 404, origin, env);

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  if (!headers.get("content-type")) headers.set("content-type", "application/octet-stream");
  headers.set("accept-ranges", "bytes");
  headers.set("etag", head.httpEtag);
  headers.set("last-modified", head.uploaded.toUTCString());
  headers.set("content-disposition", contentDisposition(disp, name));
  headers.set("cache-control", `private, max-age=${Math.max(0, exp - now)}`);
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  applyCors(headers, origin, env);

  const range = parseRange(req.headers.get("range"), head.size);
  if (range === "unsatisfiable") {
    headers.delete("content-disposition");
    headers.set("content-range", `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }

  let status = 200;
  if (range) {
    status = 206;
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set("content-length", String(range.length));
  } else {
    headers.set("content-length", String(head.size));
  }
  if (req.method === "HEAD") return new Response(null, { status, headers });

  const obj = range ? await env.BUCKET.get(key, { range }) : await env.BUCKET.get(key);
  if (!obj) return text("File not found.", 404, origin, env);
  return new Response(obj.body, { status, headers });
}

/* ---------- PUT /u/<key> : signed browser upload ---------- */

async function signedUpload(req: Request, env: Env, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  const key = keyFrom(url.pathname, "/u/");
  const exp = parseExpiry(url.searchParams.get("exp"));
  const ct = (url.searchParams.get("ct") ?? "").trim();
  const maxParam = (url.searchParams.get("max") ?? "").trim();
  const sig = url.searchParams.get("sig") ?? "";
  if (!key || exp === null || !ct || !/^\d{1,15}$/.test(maxParam) || !sig) return json({ error: "bad upload link" }, 400, origin, env);
  const max = Number(maxParam);
  if (max <= 0) return json({ error: "bad upload link" }, 400, origin, env);
  if (nowSeconds() > exp) return json({ error: "upload link expired" }, 403, origin, env);
  if (!(await signatureValid(env.SIGNING_SECRET, ["upload", key, String(exp), ct, String(max)], sig))) return json({ error: "invalid signature" }, 403, origin, env);

  const presentedType = (req.headers.get("content-type") ?? "").trim();
  if (presentedType.toLowerCase() !== ct.toLowerCase()) return json({ error: `content-type must be ${ct}` }, 415, origin, env);
  const lengthHeader = req.headers.get("content-length");
  if (!lengthHeader || !/^\d+$/.test(lengthHeader)) return json({ error: "content-length required" }, 411, origin, env);
  const declared = Number(lengthHeader);
  if (declared === 0) return json({ error: "empty body" }, 400, origin, env);
  if (declared > max) return json({ error: `file exceeds ${max} bytes` }, 413, origin, env);
  if (!req.body) return json({ error: "empty body" }, 400, origin, env);

  const put = await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: ct } });
  if (!put) return json({ error: "store failed" }, 500, origin, env);
  if (put.size > max) {
    await env.BUCKET.delete(key);
    return json({ error: `file exceeds ${max} bytes` }, 413, origin, env);
  }
  return json({ ok: true, key, bytes: put.size }, 200, origin, env);
}

/* ---------- /o/<key> : server-to-server object API ---------- */

async function objects(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearer(req, env.API_TOKEN)) return text("unauthorized", 401);
  const key = keyFrom(url.pathname, "/o/");
  if (!key) return text("bad key", 400);
  switch (req.method) {
    case "HEAD": {
      const head = await env.BUCKET.head(key);
      if (!head) return new Response(null, { status: 404, headers: baseHeaders() });
      const headers = baseHeaders();
      head.writeHttpMetadata(headers);
      headers.set("content-length", String(head.size));
      headers.set("etag", head.httpEtag);
      headers.set("last-modified", head.uploaded.toUTCString());
      return new Response(null, { status: 200, headers });
    }
    case "GET": {
      const obj = await env.BUCKET.get(key);
      if (!obj) return text("not found", 404);
      const headers = baseHeaders();
      obj.writeHttpMetadata(headers);
      if (!headers.get("content-type")) headers.set("content-type", "application/octet-stream");
      headers.set("content-length", String(obj.size));
      headers.set("etag", obj.httpEtag);
      headers.set("last-modified", obj.uploaded.toUTCString());
      return new Response(obj.body, { status: 200, headers });
    }
    case "PUT": {
      if (!req.body) return text("empty body", 400);
      const put = await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") ?? "application/octet-stream" } });
      return json({ ok: true, key, size: put?.size ?? null }, 200);
    }
    case "DELETE": {
      await env.BUCKET.delete(key);
      return json({ ok: true }, 200);
    }
    default:
      return text("method not allowed", 405);
  }
}

/* ---------- GET /list : server-to-server listing ---------- */

async function list(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearer(req, env.API_TOKEN)) return text("unauthorized", 401);
  if (req.method !== "GET") return text("method not allowed", 405);
  const prefix = url.searchParams.get("prefix") ?? "";
  // A concrete folder only (e.g. "docs/<userId>/"): never the whole bucket from one call.
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/$/.test(prefix) && !/^backups\/$/.test(prefix)) return json({ error: "prefix must look like <area>/<id>/" }, 400);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
  return json(
    {
      objects: page.objects.map((o) => ({ key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString() })),
      truncated: page.truncated,
      cursor: page.truncated ? page.cursor : null,
    },
    200,
  );
}

/* ---------- router ---------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/health") return json({ ok: true, service: SERVICE, at: new Date().toISOString() }, 200);
      if (req.method === "OPTIONS" && (path.startsWith("/u/") || path.startsWith("/d/"))) return preflight(req, env);
      if (path.startsWith("/d/")) {
        if (req.method === "GET" || req.method === "HEAD") return await signedRead(req, env, url);
        return text("method not allowed", 405, req.headers.get("origin"), env);
      }
      if (path.startsWith("/u/")) {
        if (req.method === "PUT") return await signedUpload(req, env, url);
        return json({ error: "method not allowed" }, 405, req.headers.get("origin"), env);
      }
      if (path.startsWith("/o/")) return await objects(req, env, url);
      if (path === "/list") return await list(req, env, url);
      return text("Not found.", 404);
    } catch (e) {
      console.error(`[${SERVICE}]`, e instanceof Error ? e.stack : String(e));
      return text("Something went wrong.", 500);
    }
  },
};
