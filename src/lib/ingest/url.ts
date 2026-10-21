import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { extractFile, type ExtractedFile } from "./extract";
import { htmlToReadable } from "./html";

/*
 * URL → text, safely. Users paste links (personal site, portfolio, GitHub, ORCID, company
 * page); the server fetches them, so every fetch goes through `safeFetch`:
 *
 *   - http/https only, standard ports only, no credentials in the URL;
 *   - the hostname is resolved by our own lookup and EVERY address must be public
 *     (no loopback, private, link-local, CGNAT, metadata, multicast, reserved, NAT64/6to4
 *     wrappers of those); the check runs inside the socket's lookup, so the address that
 *     is validated is the address that is connected to (no DNS-rebinding window);
 *   - literal IPs are checked before connecting (Node skips lookup for them);
 *   - at most 3 redirects, each hop re-validated; 10 s overall; 3 MB after decompression.
 *
 * Special cases: GitHub profiles/repos go through the public REST API, ORCID iDs through
 * pub.orcid.org v3 JSON; LinkedIn and Google Scholar are never fetched (their terms forbid
 * automated access) — the link is kept and the user gets a hint instead.
 */

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 3 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 3;
export const USER_AGENT = "OnwardScout/1.0 (+https://onwardscout.com; profile link reader)";

export type FetchErrorCode =
  | "bad_url"
  | "blocked_scheme"
  | "blocked_port"
  | "blocked_host"
  | "blocked_ip"
  | "dns_failed"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "network";

export class SafeFetchError extends Error {
  readonly code: FetchErrorCode;
  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ address checks */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata 169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function inV4Block(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Expands an IPv6 address (with optional embedded IPv4 and zone) to 8 16-bit groups. */
export function parseIpv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = ipv4ToInt(maybeV4);
    if (n === null) return null;
    tail = [n >>> 16, n & 0xffff];
    s = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((v) => Number.isNaN(v))) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...rest];
  if (groups.length !== 8) return null;
  if (tail.length) {
    groups[6] = tail[0];
    groups[7] = tail[1];
  }
  return groups;
}

/**
 * True for every address a server-side fetch must never reach: loopback, private,
 * link-local, CGNAT, documentation, multicast, reserved, unspecified, unique-local IPv6,
 * and IPv6 forms that wrap one of those (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo).
 * Unparseable input counts as private (fail closed).
 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (kind === 4) {
    const n = ipv4ToInt(ip)!;
    return V4_BLOCKS.some(([base, bits]) => inV4Block(n, base, bits));
  }
  if (kind !== 6) return true;
  const g = parseIpv6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (g.every((v) => v === 0)) return true; // ::
  if (g.slice(0, 7).every((v) => v === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff) return isPrivateAddress(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((v) => v === 0)) return isPrivateAddress(embedded(g[6], g[7])); // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) return isPrivateAddress(embedded(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateAddress(embedded(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo: tunnels to arbitrary hosts
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((v) => v === 0)) return true; // discard-only
  return false;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp", ".private"];
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Static checks on a URL before any network activity. Throws SafeFetchError; returns the
 * parsed URL. Hostname-based checks here; address checks happen at connect time.
 */
export function assertPublicUrl(raw: string | URL): URL {
  let u: URL;
  try {
    u = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
  } catch {
    throw new SafeFetchError("bad_url", "That doesn't look like a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("blocked_scheme", "Only http and https links can be read.");
  if (u.username || u.password) throw new SafeFetchError("blocked_host", "Links with a username or password can't be read.");
  if (!ALLOWED_PORTS.has(u.port)) throw new SafeFetchError("blocked_port", "Links on non-standard ports can't be read.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new SafeFetchError("bad_url", "That link has no host name.");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SafeFetchError("blocked_host", "Links to private or local hosts can't be read.");
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new SafeFetchError("blocked_ip", "Links to private network addresses can't be read.");
  } else if (!host.includes(".")) {
    // Single-label names resolve through search domains to internal hosts.
    throw new SafeFetchError("blocked_host", "Links to private or local hosts can't be read.");
  }
  return u;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as ResolvedAddress[]);
    });
  });

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void;

/** A `lookup` for http.request that refuses to hand a private address to the socket. */
export function guardedLookup(resolver: Resolver) {
  return (hostname: string, options: { family?: number | string; all?: boolean }, callback: LookupCallback): void => {
    resolver(hostname).then(
      (all) => {
        const want = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
        const addrs = want ? all.filter((a) => a.family === want) : all;
        if (addrs.length === 0) {
          callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }) as NodeJS.ErrnoException, "", 4);
          return;
        }
        // Fail closed when ANY record is private: mixed answers are a rebinding trick.
        if (all.some((a) => isPrivateAddress(a.address))) {
          callback(new SafeFetchError("blocked_ip", "That host resolves to a private network address.") as unknown as NodeJS.ErrnoException, "", 4);
          return;
        }
        if (options.all) callback(null, addrs);
        else callback(null, addrs[0].address, addrs[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(Object.assign(err, { code: err.code ?? "ENOTFOUND" }), "", 4),
    );
  };
}

/* ------------------------------------------------------------------ fetch */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Injected in tests; defaults to the system resolver. */
  resolver?: Resolver;
  signal?: AbortSignal;
}

export interface SafeResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: Buffer;
  redirects: string[];
}

function headerValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

function requestOnce(u: URL, opts: Required<Pick<SafeFetchOptions, "maxBytes" | "headers">> & { resolver: Resolver; signal: AbortSignal }): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const req = mod.request(
      u,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,application/pdf;q=0.7,*/*;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en,zh;q=0.8",
          ...opts.headers,
        },
        lookup: guardedLookup(opts.resolver) as unknown as typeof dnsLookup,
        signal: opts.signal,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = headerValue(v);
        if (status >= 300 && status < 400 && headers.location) {
          res.resume();
          settled = true;
          resolve({ url: u.toString(), status, headers, contentType: headers["content-type"] ?? "", body: Buffer.alloc(0), redirects: [], location: headers.location });
          return;
        }
        const declared = Number(headers["content-length"] ?? "0");
        if (declared > opts.maxBytes * 4) {
          res.destroy();
          fail(new SafeFetchError("too_large", "That page is too large to read."));
          return;
        }
        const encoding = (headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? res.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? res.pipe(zlib.createInflate())
              : encoding === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            stream.destroy();
            fail(new SafeFetchError("too_large", "That page is too large to read."));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ url: u.toString(), status, headers, contentType: headers["content-type"] ?? "", body: Buffer.concat(chunks), redirects: [] });
        });
        stream.on("error", (err) => fail(new SafeFetchError("network", `The page could not be read (${err.message}).`)));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof SafeFetchError) return fail(err);
      // The guarded lookup's error surfaces wrapped by net; recover its code.
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof SafeFetchError) return fail(cause);
      if (err.name === "AbortError" || opts.signal.aborted) return fail(new SafeFetchError("timeout", "The page took too long to respond."));
      if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return fail(new SafeFetchError("dns_failed", "That website could not be found."));
      fail(new SafeFetchError("network", `The page could not be reached (${err.code ?? err.message}).`));
    });
    req.end();
  });
}

/**
 * GET with the SSRF guard, a deadline, a size cap and re-validated redirects.
 * Resolves for any HTTP status (callers decide what 4xx/5xx mean); rejects with
 * SafeFetchError for blocked or failed fetches.
 */
export async function safeFetch(url: string | URL, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? FETCH_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const redirects: string[] = [];
  try {
    let current = assertPublicUrl(url);
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(current, {
        maxBytes: options.maxBytes ?? FETCH_MAX_BYTES,
        headers: options.headers ?? {},
        resolver: options.resolver ?? systemResolver,
        signal: controller.signal,
      });
      if (res.location === undefined) return { ...res, redirects };
      if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", "That link redirects too many times.");
      let next: URL;
      try {
        next = new URL(res.location, current);
      } catch {
        throw new SafeFetchError("bad_url", "That link redirects to an invalid address.");
      }
      redirects.push(next.toString());
      current = assertPublicUrl(next);
    }
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof SafeFetchError && err.code !== "network")) {
      throw new SafeFetchError("timeout", "The page took too long to respond.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Decodes a response body using its charset: the Content-Type parameter, else a <meta charset>
 * in the first bytes, else UTF-8. Chinese sites still serve GBK/GB2312 pages.
 */
export function decodeBody(res: Pick<SafeResponse, "body" | "contentType">): string {
  let charset = /charset=["']?([\w-]+)/i.exec(res.contentType)?.[1]?.toLowerCase() ?? null;
  if (!charset && /html|xml/i.test(res.contentType || "text/html")) {
    const head = res.body.subarray(0, 4096).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? null;
  }
  const label = !charset || charset === "utf8" ? "utf-8" : charset === "gb2312" || charset === "gbk" ? "gb18030" : charset;
  try {
    return new TextDecoder(label).decode(res.body);
  } catch {
    return res.body.toString("utf8");
  }
}

/* ------------------------------------------------------------------ link classification */

export type LinkKind =
  | "github"
  | "orcid"
  | "linkedin"
  | "scholar"
  | "dblp"
  | "researchgate"
  | "arxiv"
  | "behance"
  | "dribbble"
  | "youtube"
  | "bilibili"
  | "xiaohongshu"
  | "instagram"
  | "x"
  | "tiktok"
  | "medium"
  | "substack"
  | "crunchbase"
  | "producthunt"
  | "appstore"
  | "googleplay"
  | "website";

const LINK_HOSTS: Array<[RegExp, LinkKind]> = [
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)orcid\.org$/, "orcid"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "linkedin"],
  [/^scholar\.google\./, "scholar"],
  [/(^|\.)dblp\.(org|uni-trier\.de)$/, "dblp"],
  [/(^|\.)researchgate\.net$/, "researchgate"],
  [/(^|\.)arxiv\.org$/, "arxiv"],
  [/(^|\.)behance\.net$/, "behance"],
  [/(^|\.)dribbble\.com$/, "dribbble"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)bilibili\.com$|(^|\.)b23\.tv$/, "bilibili"],
  [/(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/, "xiaohongshu"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(twitter|x)\.com$/, "x"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)medium\.com$/, "medium"],
  [/(^|\.)substack\.com$/, "substack"],
  [/(^|\.)crunchbase\.com$/, "crunchbase"],
  [/(^|\.)producthunt\.com$/, "producthunt"],
  [/^apps\.apple\.com$/, "appstore"],
  [/^play\.google\.com$/, "googleplay"],
];

/** Adds https:// when missing and trims; returns null for things that can't be a URL. */
export function normalizeUserUrl(raw: string): string | null {
  let s = raw.trim().replace(/^[<("'\s]+|[>)"'\s.,;]+$/g, "");
  if (!s) return null;
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(s)) s = `https://orcid.org/${s.toUpperCase()}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function classifyLink(url: string): LinkKind {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const [re, kind] of LINK_HOSTS) if (re.test(host)) return kind;
  } catch {
    // fall through
  }
  return "website";
}

/* ------------------------------------------------------------------ ORCID */

/** ISO 7064 Mod 11-2 check of a 16-character ORCID iD (with or without hyphens). */
export function isValidOrcid(id: string): boolean {
  const s = id.replace(/-/g, "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(s[i])) * 2;
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const check = result === 10 ? "X" : String(result);
  return s[15] === check;
}

export function orcidFromUrl(url: string): string | null {
  const m = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i.exec(url);
  return m && isValidOrcid(m[1]) ? m[1].toUpperCase() : null;
}

export interface OrcidWork {
  title: string;
  venue: string | null;
  year: number | null;
  type: string | null;
  doi: string | null;
  url: string | null;
}

export interface OrcidRecord {
  orcid: string;
  name: string | null;
  biography: string | null;
  keywords: string[];
  urls: Array<{ name: string | null; url: string }>;
  employments: Array<{ organization: string; role: string | null; department: string | null; start: string | null; end: string | null }>;
  educations: Array<{ organization: string; role: string | null; department: string | null; start: string | null; end: string | null }>;
  works: OrcidWork[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const val = (v: unknown): string | null => str(obj(v).value);

function orcidDate(v: unknown): string | null {
  const d = obj(v);
  const y = val(d.year);
  if (!y) return null;
  const m = val(d.month);
  return m ? `${y}-${m.padStart(2, "0")}` : y;
}

function orcidAffiliations(section: unknown, key: string): OrcidRecord["employments"] {
  const out: OrcidRecord["employments"] = [];
  for (const group of arr(obj(section)["affiliation-group"])) {
    for (const s of arr(obj(group).summaries)) {
      const e = obj(obj(s)[key]);
      const organization = str(obj(e.organization).name);
      if (!organization) continue;
      out.push({ organization, role: str(e["role-title"]), department: str(e["department-name"]), start: orcidDate(e["start-date"]), end: orcidDate(e["end-date"]) });
    }
  }
  return out;
}

/** Maps a pub.orcid.org v3 `/record` JSON document to the fields the profile uses. Pure. */
export function parseOrcidRecord(orcid: string, json: unknown): OrcidRecord {
  const root = obj(json);
  const person = obj(root.person);
  const name = obj(person.name);
  const credit = val(name["credit-name"]);
  const given = val(name["given-names"]);
  const family = val(name["family-name"]);
  const activities = obj(root["activities-summary"]);
  const works: OrcidWork[] = [];
  for (const group of arr(obj(activities.works).group)) {
    const summary = obj(arr(obj(group)["work-summary"])[0]);
    const title = val(obj(summary.title).title);
    if (!title) continue;
    let doi: string | null = null;
    for (const ext of arr(obj(summary["external-ids"])["external-id"])) {
      const e = obj(ext);
      if (str(e["external-id-type"]) === "doi") doi = str(e["external-id-value"]);
    }
    const year = val(obj(summary["publication-date"]).year);
    works.push({
      title,
      venue: val(summary["journal-title"]),
      year: year ? Number(year) : null,
      type: str(summary.type),
      doi,
      url: val(summary.url) ?? (doi ? `https://doi.org/${doi}` : null),
    });
  }
  works.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return {
    orcid,
    name: credit ?? ([given, family].filter(Boolean).join(" ") || null),
    biography: str(obj(person.biography).content),
    keywords: arr(obj(person.keywords).keyword)
      .map((k) => str(obj(k).content))
      .filter((k): k is string => Boolean(k)),
    urls: arr(obj(person["researcher-urls"])["researcher-url"])
      .map((u) => ({ name: str(obj(u)["url-name"]), url: val(obj(u).url) ?? "" }))
      .filter((u) => u.url),
    employments: orcidAffiliations(activities.employments, "employment-summary"),
    educations: orcidAffiliations(activities.educations, "education-summary"),
    works: works.slice(0, 300),
  };
}

/** The readable text stored for an ORCID link (the local extractor parses this exact format). */
export function orcidRecordText(r: OrcidRecord): string {
  const lines: string[] = [`ORCID iD: ${r.orcid}`];
  if (r.name) lines.push(`Name: ${r.name}`);
  if (r.biography) lines.push("", "Biography", r.biography);
  if (r.keywords.length) lines.push("", `Research keywords: ${r.keywords.join(", ")}`);
  const aff = (title: string, list: OrcidRecord["employments"]) => {
    if (!list.length) return;
    lines.push("", title);
    for (const a of list) lines.push(`- ${[a.role, a.department, a.organization].filter(Boolean).join(", ")} (${a.start ?? "?"} – ${a.end ?? "Present"})`);
  };
  aff("Employment", r.employments);
  aff("Education", r.educations);
  if (r.works.length) {
    lines.push("", "Publications");
    for (const w of r.works) lines.push(`- ${w.title}${w.venue ? `. ${w.venue}` : ""}${w.year ? ` (${w.year})` : ""}${w.doi ? `. doi:${w.doi}` : ""}`);
  }
  if (r.urls.length) lines.push("", "Links", ...r.urls.map((u) => `- ${u.name ? `${u.name}: ` : ""}${u.url}`));
  return lines.join("\n");
}

/* ------------------------------------------------------------------ GitHub */

export interface GithubRepo {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  homepage: string | null;
  url: string;
  pushedAt: string | null;
}

export interface GithubProfile {
  login: string;
  name: string | null;
  type: "User" | "Organization" | string;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  email: string | null;
  twitter: string | null;
  followers: number;
  publicRepos: number;
  createdAt: string | null;
  url: string;
  topRepos: GithubRepo[];
  languages: string[];
}

const GITHUB_RESERVED = new Set([
  "about", "apps", "blog", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features", "issues", "join", "login", "logout",
  "marketplace", "new", "notifications", "orgs", "organizations", "pricing", "pulls", "readme", "search", "security", "settings", "site", "sponsors", "team",
  "topics", "trending", "users",
]);

export function githubTarget(url: string): { owner: string; repo: string | null } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname) || /^(gist|api|raw|docs|education|skills)\./i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0 || GITHUB_RESERVED.has(parts[0].toLowerCase())) return null;
    if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(parts[0])) return null;
    const repo = parts[1] && /^[\w.-]{1,100}$/.test(parts[1]) ? parts[1].replace(/\.git$/, "") : null;
    return { owner: parts[0], repo };
  } catch {
    return null;
  }
}

const GITHUB_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

function parseJsonBody(res: SafeResponse): unknown {
  try {
    return JSON.parse(res.body.toString("utf8"));
  } catch {
    return null;
  }
}

function toRepo(r: Json): GithubRepo {
  return {
    name: str(r.name) ?? "",
    description: str(r.description),
    language: str(r.language),
    stars: Number(r.stargazers_count ?? 0),
    forks: Number(r.forks_count ?? 0),
    topics: arr(r.topics).filter((t): t is string => typeof t === "string"),
    homepage: str(r.homepage),
    url: str(r.html_url) ?? "",
    pushedAt: str(r.pushed_at),
  };
}

/** Ranks repos for a profile: own (not forks/archived), by stars then recency. Pure. */
export function rankGithubRepos(raw: unknown[], limit = 8): GithubRepo[] {
  return raw
    .map(obj)
    .filter((r) => r.fork !== true && r.archived !== true && str(r.name))
    .map(toRepo)
    .sort((a, b) => b.stars - a.stars || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))
    .slice(0, limit);
}

/** The readable text stored for a GitHub profile link (the local extractor parses this exact format). */
export function githubProfileText(p: GithubProfile): string {
  const lines = [`GitHub: ${p.url}`, `Username: ${p.login}`];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.bio) lines.push(`Bio: ${p.bio}`);
  if (p.company) lines.push(`Company: ${p.company}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.blog) lines.push(`Website: ${p.blog}`);
  if (p.email) lines.push(`Email: ${p.email}`);
  if (p.twitter) lines.push(`X/Twitter: @${p.twitter}`);
  lines.push(`Followers: ${p.followers}`, `Public repositories: ${p.publicRepos}`);
  if (p.createdAt) lines.push(`On GitHub since: ${p.createdAt.slice(0, 4)}`);
  if (p.languages.length) lines.push(`Main languages: ${p.languages.join(", ")}`);
  if (p.topRepos.length) {
    lines.push("", "Top repositories");
    for (const r of p.topRepos) {
      lines.push(`- ${r.name}${r.description ? `: ${r.description}` : ""} (${[r.language, `${r.stars} stars`, r.topics.slice(0, 5).join(" ")].filter(Boolean).join(", ")}) ${r.url}`);
    }
  }
  return lines.join("\n");
}

async function fetchGithub(owner: string, repo: string | null, opts: SafeFetchOptions): Promise<LinkIngest> {
  const original = `https://github.com/${owner}${repo ? `/${repo}` : ""}`;
  if (repo) {
    const res = await safeFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { ...opts, headers: GITHUB_HEADERS });
    if (res.status === 404) return { status: "error", url: original, code: "not_found", error: "That GitHub repository doesn't exist or is private." };
    if (res.status !== 200) return { status: "error", url: original, code: "upstream", error: `GitHub answered ${res.status}; try again later.` };
    const r = toRepo(obj(parseJsonBody(res)));
    let readme = "";
    const rd = await safeFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, {
      ...opts,
      maxBytes: 512 * 1024,
      headers: { ...GITHUB_HEADERS, Accept: "application/vnd.github.raw+json" },
    }).catch(() => null);
    if (rd && rd.status === 200) readme = rd.body.toString("utf8").slice(0, 20_000);
    const text = [`GitHub repository: ${r.url}`, r.description ? `Description: ${r.description}` : "", r.language ? `Language: ${r.language}` : "", `Stars: ${r.stars}`, r.topics.length ? `Topics: ${r.topics.join(", ")}` : "", r.homepage ? `Homepage: ${r.homepage}` : "", readme ? `\nREADME\n${readme}` : ""]
      .filter(Boolean)
      .join("\n");
    return { status: "ok", source: "github", url: original, finalUrl: r.url || original, title: `${owner}/${r.name}`, description: r.description, text, links: r.homepage ? [r.homepage] : [], data: { repo: r }, warnings: [] };
  }
  const res = await safeFetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, { ...opts, headers: GITHUB_HEADERS });
  if (res.status === 404) return { status: "error", url: original, code: "not_found", error: "That GitHub account doesn't exist." };
  if (res.status === 403 || res.status === 429) return { status: "error", url: original, code: "rate_limited", error: "GitHub is limiting requests right now; the link is saved and will be read later." };
  if (res.status !== 200) return { status: "error", url: original, code: "upstream", error: `GitHub answered ${res.status}; try again later.` };
  const u = obj(parseJsonBody(res));
  const reposRes = await safeFetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=pushed&type=owner`, { ...opts, headers: GITHUB_HEADERS }).catch(() => null);
  const rawRepos = reposRes && reposRes.status === 200 ? arr(parseJsonBody(reposRes)) : [];
  const topRepos = rankGithubRepos(rawRepos);
  const langCount = new Map<string, number>();
  for (const r of rawRepos.map(obj)) {
    const lang = str(r.language);
    if (lang && r.fork !== true) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
  }
  const profile: GithubProfile = {
    login: str(u.login) ?? owner,
    name: str(u.name),
    type: str(u.type) ?? "User",
    bio: str(u.bio),
    company: str(u.company),
    location: str(u.location),
    blog: str(u.blog),
    email: str(u.email),
    twitter: str(u.twitter_username),
    followers: Number(u.followers ?? 0),
    publicRepos: Number(u.public_repos ?? 0),
    createdAt: str(u.created_at),
    url: str(u.html_url) ?? original,
    topRepos,
    languages: [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l),
  };
  const warnings = reposRes && reposRes.status === 200 ? [] : ["Repositories could not be listed right now."];
  return {
    status: "ok",
    source: "github",
    url: original,
    finalUrl: profile.url,
    title: profile.name ?? profile.login,
    description: profile.bio,
    text: githubProfileText(profile),
    links: [profile.blog, ...topRepos.map((r) => r.homepage)].filter((l): l is string => Boolean(l)),
    data: { profile },
    warnings,
  };
}

async function fetchOrcid(orcid: string, opts: SafeFetchOptions): Promise<LinkIngest> {
  const original = `https://orcid.org/${orcid}`;
  const res = await safeFetch(`https://pub.orcid.org/v3.0/${orcid}/record`, { ...opts, headers: { Accept: "application/json" } });
  if (res.status === 404) return { status: "error", url: original, code: "not_found", error: "That ORCID iD doesn't exist." };
  if (res.status !== 200) return { status: "error", url: original, code: "upstream", error: `ORCID answered ${res.status}; try again later.` };
  const record = parseOrcidRecord(orcid, parseJsonBody(res));
  return {
    status: "ok",
    source: "orcid",
    url: original,
    finalUrl: original,
    title: record.name ? `${record.name} (ORCID)` : `ORCID ${orcid}`,
    description: record.biography,
    text: orcidRecordText(record),
    links: record.urls.map((u) => u.url),
    data: { orcid: record },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ entry point */

export interface Hint {
  en: string;
  zh: string;
}

export type LinkIngest =
  | {
      status: "ok";
      source: "web" | "github" | "orcid" | "document";
      url: string;
      finalUrl: string;
      title: string | null;
      description: string | null;
      /** Readable text for the extractor (never instructions). */
      text: string;
      /** Outbound links worth keeping (personal site, homepage, project pages). */
      links: string[];
      data?: { profile?: GithubProfile; repo?: GithubRepo; orcid?: OrcidRecord; jsonLd?: unknown[]; meta?: Record<string, string>; document?: ExtractedFile };
      warnings: string[];
    }
  | { status: "skipped"; url: string; reason: "linkedin" | "scholar"; hint: Hint }
  | { status: "error"; url: string; code: FetchErrorCode | "not_found" | "rate_limited" | "upstream" | "unsupported" | "empty"; error: string };

export const LINK_HINTS: Record<"linkedin" | "scholar", Hint> = {
  linkedin: {
    en: "LinkedIn doesn't allow automated reading, so we saved the link without opening it. To import your LinkedIn profile, open it, choose More → Save to PDF, and upload that PDF here.",
    zh: "领英不允许自动读取，我们只保存了这个链接。要导入领英资料：打开你的主页，点「更多」→「存为 PDF」，再把这个 PDF 上传到这里。",
  },
  scholar: {
    en: "Google Scholar doesn't allow automated reading, so we saved the link without opening it. To import your publications, upload your CV or add your ORCID iD.",
    zh: "Google Scholar 不允许自动读取，我们只保存了这个链接。要导入论文列表，请上传你的 CV，或添加你的 ORCID iD。",
  },
};

/**
 * Reads a link a user gave us. Never throws for user-facing failures: returns
 * `{status: "error"}` with a sentence the UI can show, or `{status: "skipped"}` with a hint.
 */
export async function ingestUrl(rawUrl: string, opts: SafeFetchOptions = {}): Promise<LinkIngest> {
  const url = normalizeUserUrl(rawUrl);
  if (!url) return { status: "error", url: rawUrl, code: "bad_url", error: "That doesn't look like a web address." };
  const kind = classifyLink(url);
  if (kind === "linkedin") return { status: "skipped", url, reason: "linkedin", hint: LINK_HINTS.linkedin };
  if (kind === "scholar") return { status: "skipped", url, reason: "scholar", hint: LINK_HINTS.scholar };
  try {
    if (kind === "github") {
      const target = githubTarget(url);
      if (target) return await fetchGithub(target.owner, target.repo, opts);
    }
    if (kind === "orcid") {
      const id = orcidFromUrl(url);
      if (id) return await fetchOrcid(id, opts);
      return { status: "error", url, code: "bad_url", error: "That ORCID iD isn't valid (check the 16 digits)." };
    }
    const res = await safeFetch(url, opts);
    if (res.status === 401 || res.status === 403) return { status: "error", url, code: "upstream", error: "That page needs a login or blocks automated visits; we saved the link." };
    if (res.status === 404 || res.status === 410) return { status: "error", url, code: "not_found", error: "That page doesn't exist (404)." };
    if (res.status >= 400) return { status: "error", url, code: "upstream", error: `That website answered with an error (${res.status}).` };
    const ct = res.contentType.toLowerCase();
    if (ct.includes("application/pdf") || ct.includes("officedocument") || /\.(pdf|docx|pptx)(\?|$)/i.test(res.url)) {
      const filename = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "document.pdf");
      const doc = await extractFile({ bytes: new Uint8Array(res.body), filename, contentType: ct });
      return { status: "ok", source: "document", url, finalUrl: res.url, title: filename, description: null, text: doc.text, links: [], data: { document: doc }, warnings: doc.warnings };
    }
    if (ct.includes("json")) {
      const text = decodeBody(res).slice(0, 100_000);
      return { status: "ok", source: "web", url, finalUrl: res.url, title: null, description: null, text, links: [], warnings: [] };
    }
    if (ct.startsWith("text/plain")) {
      return { status: "ok", source: "web", url, finalUrl: res.url, title: null, description: null, text: decodeBody(res).slice(0, 100_000), links: [], warnings: [] };
    }
    if (ct && !ct.includes("html") && !ct.includes("xml")) {
      return { status: "error", url, code: "unsupported", error: "That link isn't a web page or a document we can read." };
    }
    const page = htmlToReadable(decodeBody(res), res.url);
    const text = [page.title ? `# ${page.title}` : "", page.description ?? "", page.text].filter(Boolean).join("\n\n");
    if (text.trim().length < 20) return { status: "error", url, code: "empty", error: "That page has no readable text (it may need JavaScript or a login)." };
    return {
      status: "ok",
      source: "web",
      url,
      finalUrl: res.url,
      title: page.title,
      description: page.description,
      text,
      links: page.links.map((l) => l.url).slice(0, 50),
      data: { jsonLd: page.jsonLd, meta: page.meta },
      warnings: [],
    };
  } catch (err) {
    if (err instanceof SafeFetchError) return { status: "error", url, code: err.code, error: err.message };
    const message = err instanceof Error ? err.message : String(err);
    // Unexpected (parser bug, extractor failure): surfaced to the caller as a result, logged here.
    console.error("[ingestUrl] unexpected failure", url, err);
    return { status: "error", url, code: "network", error: `That link could not be read (${message.slice(0, 160)}).` };
  }
}
