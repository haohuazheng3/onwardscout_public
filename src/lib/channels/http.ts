import "server-only";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { assertPublicUrl, decodeBody, guardedLookup, safeFetch, SafeFetchError, systemResolver } from "@/lib/ingest/url";
import { siteUrl } from "@/lib/site";

/*
 * Network access for the channel adapters. Every URL comes from an opportunity record or a
 * page, so every request is SSRF-guarded (public hosts only, DNS pinned per request, size and
 * time caps) — except our own origin (the sandbox form), which is trusted. During local
 * development the sandbox on localhost is trusted too; production never trusts localhost.
 */

export const CHANNEL_USER_AGENT = "OnwardScout/1.0 (+https://onwardscout.com; submits applications its user confirmed)";
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export interface ChannelResponse {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

/** Our own origin (the sandbox), or the local sandbox while developing. */
export function isTrustedOrigin(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  try {
    if (u.origin === new URL(siteUrl()).origin) return true;
  } catch {
    /* malformed NEXT_PUBLIC_SITE_URL: trust nothing extra */
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  return local && process.env.NODE_ENV !== "production" && u.pathname.startsWith("/sandbox/");
}

async function trustedFetch(url: string, init: RequestInit): Promise<ChannelResponse> {
  const res = await fetch(url, { ...init, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new SafeFetchError("too_large", "That page is too large to read.");
  const contentType = res.headers.get("content-type") ?? "";
  return { url: res.url || url, status: res.status, contentType, html: decodeBody({ body: buf, contentType }) };
}

/** GET a form page (redirects re-validated hop by hop for third-party hosts). */
export async function channelGet(url: string, opts: { maxBytes?: number } = {}): Promise<ChannelResponse> {
  if (isTrustedOrigin(url)) return trustedFetch(url, { method: "GET", headers: { "User-Agent": CHANNEL_USER_AGENT, Accept: "text/html,*/*;q=0.5" } });
  const res = await safeFetch(url, { maxBytes: opts.maxBytes ?? MAX_BYTES, timeoutMs: TIMEOUT_MS, headers: { "User-Agent": CHANNEL_USER_AGENT } });
  return { url: res.url, status: res.status, contentType: res.contentType, html: decodeBody(res) };
}

/** GET JSON from a public API (ATS posting APIs). */
export async function channelGetJson(url: string): Promise<{ status: number; json: unknown }> {
  const res = await safeFetch(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: TIMEOUT_MS, headers: { Accept: "application/json", "User-Agent": CHANNEL_USER_AGENT } });
  let json: unknown = null;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function guardedPost(u: URL, body: Uint8Array, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "POST",
        headers: { "User-Agent": CHANNEL_USER_AGENT, Accept: "text/html,*/*;q=0.5", "Accept-Encoding": "identity", "Content-Length": String(body.byteLength), ...headers },
        lookup: guardedLookup(systemResolver) as unknown as LookupFunction,
        agent: false,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (res) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : (v ?? "");
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new SafeFetchError("too_large", "The response page is too large to read."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) }));
        res.on("error", (err) => reject(new SafeFetchError("network", `The form could not be read (${err.message}).`)));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      const cause = (err as { cause?: unknown }).cause;
      if (err instanceof SafeFetchError) reject(err);
      else if (cause instanceof SafeFetchError) reject(cause);
      else if (err.name === "AbortError" || err.name === "TimeoutError") reject(new SafeFetchError("timeout", "The form took too long to respond."));
      else reject(new SafeFetchError("network", `The form could not be reached (${err.code ?? err.message}).`));
    });
    req.end(Buffer.from(body));
  });
}

/**
 * POST a form submission. A redirect after the POST (303/302/301) is followed with a guarded
 * GET, like a browser does, so the confirmation page is what we read.
 */
export async function channelPost(url: string, body: Uint8Array | string, contentType: string): Promise<ChannelResponse> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  if (isTrustedOrigin(url)) {
    return trustedFetch(url, { method: "POST", body: Buffer.from(bytes), headers: { "Content-Type": contentType, "User-Agent": CHANNEL_USER_AGENT } });
  }
  const u = assertPublicUrl(url);
  const res = await guardedPost(u, bytes, { "Content-Type": contentType });
  if (res.status >= 300 && res.status < 400 && res.headers.location) {
    const next = new URL(res.headers.location, u).toString();
    return channelGet(next);
  }
  const ct = res.headers["content-type"] ?? "";
  return { url: u.toString(), status: res.status, contentType: ct, html: decodeBody({ body: res.body, contentType: ct }) };
}

/** A short, human reason for a network failure. */
export function networkMessage(err: unknown): string {
  if (err instanceof SafeFetchError) {
    if (err.code === "blocked_ip" || err.code === "blocked_host" || err.code === "blocked_port" || err.code === "blocked_scheme") return "That application address isn't a public website, so we won't open it.";
    if (err.code === "timeout") return "The application site took too long to respond.";
    if (err.code === "dns_failed") return "The application site could not be found.";
    return err.message;
  }
  return err instanceof Error ? err.message : "The application site could not be reached.";
}

export function isRetryableNetwork(err: unknown): boolean {
  return err instanceof SafeFetchError ? err.code === "timeout" || err.code === "network" || err.code === "dns_failed" : true;
}
