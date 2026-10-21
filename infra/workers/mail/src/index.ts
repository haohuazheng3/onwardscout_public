/**
 * Onward Scout mail worker (onwardscout-mail).
 *
 * email()     Cloudflare Email Routing hands over mail for test@onwardscout.com, the reply
 *             drop-boxes in+<token>@onwardscout.com and every other unrouted address. We parse
 *             it and POST it to the app (/api/inbox/ingest), keeping the receiving server's
 *             SPF / DKIM / DMARC verdicts and the threading headers. Never rejects: a broken app
 *             must not bounce mail back to a sender.
 * fetch()     POST /notify (Bearer NOTIFY_TOKEN) emails the owner through the send_email binding.
 *             POST /probe (same token) runs the health probe now. GET /health answers 200.
 * scheduled() Every 30 minutes: probe https://onwardscout.com/api/health. On failure, email the
 *             owner (at most every 3 hours while it stays down); email again when it recovers.
 *             (The job queue is drained by Vercel Cron, not from here.)
 */
import PostalMime from "postal-mime";
import { EmailMessage } from "cloudflare:email";

export interface Env {
  APP_URL: string;
  OWNER_EMAIL: string;
  INBOX_INGEST_SECRET: string;
  NOTIFY_TOKEN: string;
  OWNER_MAIL: { send(message: EmailMessage): Promise<void> };
}

interface IncomingEmail {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
}

const SERVICE = "onwardscout-mail";
const FROM_ADDRESS = "alerts@onwardscout.com";
const FROM_DISPLAY = "Onward Scout Alerts";
const MAX_BODY_CHARS = 200_000;
const MAX_HEADER_CHARS = 8000;
const ALERT_EVERY_MS = 3 * 60 * 60 * 1000;
const STATE_URL = "https://onwardscout-mail.internal/health-state";

/** Headers kept with each message: authentication verdicts and what reply threading needs. */
const KEPT_HEADERS = [
  "authentication-results",
  "arc-authentication-results",
  "received-spf",
  "dkim-signature",
  "from",
  "to",
  "cc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "in-reply-to",
  "references",
  "return-path",
  "x-forwarded-for",
  "x-forwarded-to",
  "auto-submitted",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearerMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function truncate(s: string | undefined | null, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max)}\n[truncated]` : s;
}

/* ---------- outbound: a plain-text RFC 5322 message, built by hand ---------- */

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function wrap76(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 76) out.push(s.slice(i, i + 76));
  return out.join("\r\n");
}

function headerWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${base64Utf8(s)}?=`;
}

function buildMime(to: string, subject: string, text: string, replyTo?: string): string {
  const headers = [
    `From: ${FROM_DISPLAY} <${FROM_ADDRESS}>`,
    `To: <${to}>`,
    ...(replyTo && /^[^\s<>@]+@[^\s<>@]+$/.test(replyTo) ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${headerWord(subject.replace(/[\r\n]+/g, " ").slice(0, 900))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@onwardscout.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    `X-Mailer: ${SERVICE}`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(base64Utf8(text))}\r\n`;
}

async function sendToOwner(env: Env, subject: string, text: string, replyTo?: string): Promise<void> {
  await env.OWNER_MAIL.send(new EmailMessage(FROM_ADDRESS, env.OWNER_EMAIL, buildMime(env.OWNER_EMAIL, subject, text, replyTo)));
}

/* ---------- inbound ---------- */

function verdict(auth: string, mech: "spf" | "dkim" | "dmarc"): string | undefined {
  const m = new RegExp(`\\b${mech}=([a-z]+)`, "i").exec(auth);
  return m ? m[1].toLowerCase() : undefined;
}

async function ingest(message: IncomingEmail, env: Env): Promise<void> {
  const parsed = await PostalMime.parse(message.raw);
  const headers: Record<string, string> = {};
  for (const h of parsed.headers) {
    const key = h.key.toLowerCase();
    if (!KEPT_HEADERS.includes(key)) continue;
    const joined = key in headers ? `${headers[key]}\n${h.value}` : h.value;
    headers[key] = joined.slice(0, MAX_HEADER_CHARS);
  }
  for (const key of ["authentication-results", "arc-authentication-results", "received-spf"]) {
    const v = message.headers.get(key);
    if (v && !headers[key]) headers[key] = v.slice(0, MAX_HEADER_CHARS);
  }
  const auth = [headers["authentication-results"], headers["arc-authentication-results"]].filter(Boolean).join("\n");

  const res = await fetch(`${env.APP_URL.replace(/\/+$/, "")}/api/inbox/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.INBOX_INGEST_SECRET}`, "user-agent": `${SERVICE}/1.0` },
    body: JSON.stringify({
      to: message.to,
      from: message.from,
      subject: parsed.subject?.slice(0, 998),
      text: truncate(parsed.text, MAX_BODY_CHARS),
      html: truncate(parsed.html, MAX_BODY_CHARS),
      spf: verdict(auth, "spf"),
      dkim: verdict(auth, "dkim"),
      dmarc: verdict(auth, "dmarc"),
      authResults: auth.slice(0, 4000) || undefined,
      headers,
      rawSize: message.rawSize,
    }),
  });
  if (!res.ok) throw new Error(`ingest responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

/* ---------- health probe ---------- */

interface ProbeState {
  failing: boolean;
  lastAlertAt: number;
  since: number;
}

async function readState(): Promise<ProbeState> {
  const hit = await caches.default.match(STATE_URL);
  if (!hit) return { failing: false, lastAlertAt: 0, since: 0 };
  try {
    return (await hit.json()) as ProbeState;
  } catch {
    return { failing: false, lastAlertAt: 0, since: 0 };
  }
}

async function writeState(s: ProbeState): Promise<void> {
  await caches.default.put(STATE_URL, new Response(JSON.stringify(s), { headers: { "cache-control": "max-age=604800" } }));
}

async function probe(env: Env): Promise<void> {
  const base = env.APP_URL.replace(/\/+$/, "");
  const url = `${base}/api/health?probe=${Date.now()}`;
  let ok = false;
  let detail = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": "onwardscout-health-probe/1.0" }, signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    ok = res.status === 200;
    detail = `HTTP ${res.status}\n${body.slice(0, 1500)}`;
  } catch (e) {
    detail = `request failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  const state = await readState();
  const now = Date.now();
  const host = new URL(base).host;
  if (!ok) {
    if (!state.failing || now - state.lastAlertAt > ALERT_EVERY_MS) {
      await sendToOwner(env, `ALERT: ${host} health check failing`, `The health check at ${base}/api/health is failing.\n\n${detail}\n\nError inbox: ${base}/admin/errors`);
      await writeState({ failing: true, lastAlertAt: now, since: state.failing ? state.since : now });
    }
  } else if (state.failing) {
    await sendToOwner(env, `Recovered: ${host} health check passing`, `Health is green again after ${Math.round((now - state.since) / 60000)} minutes.\n\n${detail}`);
    await writeState({ failing: false, lastAlertAt: 0, since: 0 });
  }
}

export default {
  async email(message: IncomingEmail, env: Env): Promise<void> {
    try {
      await ingest(message, env);
    } catch (e) {
      console.error(`[${SERVICE}] ingest failed`, { to: message.to, from: message.from, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, service: SERVICE, at: new Date().toISOString() });
    if (url.pathname === "/notify") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!bearerMatches(req, env.NOTIFY_TOKEN)) return json({ error: "unauthorized" }, 401);
      type NotifyBody = { subject?: unknown; text?: unknown; replyTo?: unknown } | null;
      let b: NotifyBody;
      try {
        b = (await req.json()) as NotifyBody;
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
      const text = typeof b?.text === "string" ? b.text : "";
      const replyTo = typeof b?.replyTo === "string" ? b.replyTo : undefined;
      if (!subject || !text) return json({ error: "subject and text are required" }, 400);
      if (text.length > MAX_BODY_CHARS) return json({ error: "text too long" }, 413);
      try {
        await sendToOwner(env, subject, text, replyTo);
        return json({ ok: true });
      } catch (e) {
        console.error(`[${SERVICE}] notify failed`, e instanceof Error ? e.message : String(e));
        return json({ error: "send failed" }, 500);
      }
    }
    if (url.pathname === "/probe" && req.method === "POST") {
      if (!bearerMatches(req, env.NOTIFY_TOKEN)) return json({ error: "unauthorized" }, 401);
      await probe(env);
      return json({ ok: true, state: await readState() });
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(probe(env));
  },
};
