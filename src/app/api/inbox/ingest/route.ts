import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { inboxMessages, type InboxKind } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { attachForwardedReply } from "@/lib/integrations/replies";
import { htmlToText } from "@/lib/integrations/reply-parse";
import { rateLimit } from "@/lib/ratelimit";
import { inboundTokenFrom } from "@/lib/site";
import { userIdForInboundToken } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const Body = z.object({
  to: z.string().min(3).max(320),
  from: z.string().min(1).max(500),
  subject: z.string().max(1000).optional(),
  text: z.string().max(200_000).optional(),
  html: z.string().max(400_000).optional(),
  spf: z.string().max(40).optional(),
  dkim: z.string().max(40).optional(),
  dmarc: z.string().max(40).optional(),
  authResults: z.string().max(4000).optional(),
  headers: z.record(z.string(), z.string().max(8000)).optional(),
  rawSize: z.number().int().nonnegative().optional(),
});

export type IngestBody = z.infer<typeof Body>;

/** Test mail kept per day (all senders together), its text size, and headers kept per message. */
const TEST_MAIL_PER_DAY = 300;
const TEST_TEXT_CHARS = 20_000;
const MAX_HEADERS = 24;

/** test@ and test+tag@ at any of our domains: the only non-drop-box mail worth keeping. */
function isTestAddress(to: string): boolean {
  const local = to.trim().toLowerCase().split("@")[0] ?? "";
  return local === "test" || local.startsWith("test+");
}

/**
 * Called only by the Cloudflare mail worker (Bearer INBOX_INGEST_SECRET) for mail to test@,
 * the catch-all, and the reply drop-boxes `in+<token>@onwardscout.com`.
 *
 * Contract with the worker: 200 `{ ok, id, kind }` once the message is stored (the worker never
 * retries a stored mail), 400 for a payload it should not resend, 401/5xx otherwise.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req, env("INBOX_INGEST_SECRET"))) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Malformed message payload." }, { status: 400, headers: NO_STORE });
    const d = parsed.data;

    // A drop-box address names its owner through users.inbound_token; anything else is test mail.
    const token = inboundTokenFrom(d.to);
    const userId = token ? await userIdForInboundToken(token) : null;
    const kind: InboxKind = userId ? "reply" : "test";

    // Test mail is bounded: only test@ / test+tag@ is kept (the catch-all would otherwise store
    // any address anyone writes to), bodies are trimmed, HTML is not kept, and a global daily cap
    // stops a flood from filling the database. Dropped mail still answers 200: never re-sent.
    if (kind === "test") {
      if (!isTestAddress(d.to)) return Response.json({ ok: true, id: null, kind: "dropped" }, { headers: NO_STORE });
      const day = await rateLimit("inbox:test:day", TEST_MAIL_PER_DAY, 86400);
      if (!day.ok) return Response.json({ ok: true, id: null, kind: "dropped" }, { headers: NO_STORE });
    }

    const id = newId("inb");
    const headers = d.headers ? Object.fromEntries(Object.entries(d.headers).slice(0, MAX_HEADERS)) : null;
    await db.insert(inboxMessages).values({
      id,
      kind,
      userId,
      toAddr: d.to.trim().toLowerCase(),
      fromAddr: d.from.trim(),
      subject: d.subject ?? null,
      textBody: kind === "test" ? (d.text ? d.text.slice(0, TEST_TEXT_CHARS) : d.html ? htmlToText(d.html).slice(0, TEST_TEXT_CHARS) : null) : (d.text ?? null),
      htmlBody: kind === "test" ? null : d.html ? d.html.slice(0, 200_000) : null,
      spf: d.spf ?? null,
      dkim: d.dkim ?? null,
      dmarc: d.dmarc ?? null,
      authResults: d.authResults ?? null,
      headers,
      rawSize: d.rawSize ?? 0,
    });

    // ─── Reply drop-boxes (P3b) ──────────────────────────────────────────────────────────────
    // The forwarded reply is stored above with its owner. Attaching it to the person's outreach
    // thread (match → `messages` row 'in'/'forward' → classifyReply → application → notification)
    // runs after the response, so the worker gets its 200 at once and never re-sends a stored
    // mail. Failures are captured; `reattachInboxMessage(id)` re-runs it idempotently.
    if (kind === "reply" && userId) {
      const mail = { from: d.from, subject: d.subject ?? null, text: d.text ?? (d.html ? htmlToText(d.html) : null), headers: d.headers ?? null };
      waitUntil(
        attachForwardedReply({ inboxId: id, userId, mail }).catch((err: unknown) =>
          captureError(err, { route: "/api/inbox/ingest (reply)", source: "worker", context: { inboxId: id } }),
        ),
      );
    }

    return Response.json({ ok: true, id, kind }, { headers: NO_STORE });
  } catch (err) {
    await captureError(err, { route: "/api/inbox/ingest", source: "worker" });
    return Response.json({ error: "The message could not be stored." }, { status: 500, headers: NO_STORE });
  }
}
