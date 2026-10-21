import { z } from "zod";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { inboxMessages, type InboxKind } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
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

    const id = newId("inb");
    await db.insert(inboxMessages).values({
      id,
      kind,
      userId,
      toAddr: d.to.trim().toLowerCase(),
      fromAddr: d.from.trim(),
      subject: d.subject ?? null,
      textBody: d.text ?? null,
      htmlBody: d.html ? d.html.slice(0, 200_000) : null,
      spf: d.spf ?? null,
      dkim: d.dkim ?? null,
      dmarc: d.dmarc ?? null,
      authResults: d.authResults ?? null,
      headers: d.headers ?? null,
      rawSize: d.rawSize ?? 0,
    });

    // ─── EXTENSION POINT (P3b · reply drop-boxes) ────────────────────────────────────────────
    // When `kind === "reply"`, the forwarded reply is stored above with its `userId`. P3b
    // attaches it to that user's outreach thread here (a `messages` row: direction 'in',
    // channel 'forward', matched by In-Reply-To / References / subject / counterpart address
    // from `d.headers`), classifies it (Intelligence.classifyReply) and raises a notification,
    // ideally in the background so the worker gets its 200 quickly, e.g.
    //   if (kind === "reply" && userId) waitUntil(attachForwardedReply({ inboxId: id, userId, body: d }));
    // Keep the contract above: once the row is stored, answer 200 even if attaching fails
    // (capture the error; the admin inbox page can re-run it), so the worker never re-sends.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    return Response.json({ ok: true, id, kind }, { headers: NO_STORE });
  } catch (err) {
    await captureError(err, { route: "/api/inbox/ingest", source: "worker" });
    return Response.json({ error: "The message could not be stored." }, { status: 500, headers: NO_STORE });
  }
}
