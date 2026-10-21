import { and, desc, eq, gt, type SQL } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { inboxMessages } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { withErrorCapture } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The first six-digit code in a message (Clerk sign-in codes, verification mails). */
function extractCode(subject: string | null, text: string | null): string | null {
  return /(?<![\d-])(\d{6})(?![\d-])/.exec(`${subject ?? ""}\n${text ?? ""}`)?.[1] ?? null;
}

/**
 * Protected read access to the test inbox for automated sign-in and mail tests:
 *   GET /api/inbox?to=test@onwardscout.com&since=<ISO>&kind=test&limit=5
 * → latest messages first, each with the six-digit code (if any) pulled out and the receiving
 * server's SPF / DKIM / DMARC verdicts. Bearer INBOX_READ_TOKEN.
 */
export const GET = withErrorCapture("/api/inbox", async (req: Request) => {
  if (!bearerMatches(req, env("INBOX_READ_TOKEN"))) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  const url = new URL(req.url);
  const to = url.searchParams.get("to")?.trim().toLowerCase();
  const since = url.searchParams.get("since");
  const kind = url.searchParams.get("kind");
  const conds: SQL[] = [];
  // The ingest stores recipients lowercased, so a plain equality uses the (to_addr, received_at) index.
  if (to) conds.push(eq(inboxMessages.toAddr, to));
  if (since && !Number.isNaN(Date.parse(since))) conds.push(gt(inboxMessages.receivedAt, new Date(since)));
  if (kind === "test" || kind === "reply") conds.push(eq(inboxMessages.kind, kind));
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 5) || 5));
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(inboxMessages.receivedAt))
    .limit(limit);
  const messages = rows.map((m) => ({
    id: m.id,
    kind: m.kind,
    to: m.toAddr,
    from: m.fromAddr,
    subject: m.subject,
    code: extractCode(m.subject, m.textBody),
    spf: m.spf,
    dkim: m.dkim,
    dmarc: m.dmarc,
    authResults: m.authResults,
    receivedAt: m.receivedAt,
    text: (m.textBody ?? "").slice(0, 2000),
  }));
  return Response.json({ messages }, { headers: NO_STORE });
});

/** Delete one message (`?id=`), keeping the test inbox tidy between runs. Bearer INBOX_READ_TOKEN. */
export const DELETE = withErrorCapture("/api/inbox", async (req: Request) => {
  if (!bearerMatches(req, env("INBOX_READ_TOKEN"))) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^inb_[0-9a-z]{6,40}$/.test(id)) return Response.json({ error: "A message id (?id=inb_…) is required." }, { status: 400, headers: NO_STORE });
  const removed = await db.delete(inboxMessages).where(eq(inboxMessages.id, id)).returning({ id: inboxMessages.id });
  return Response.json({ ok: true, removed: removed.length }, { headers: NO_STORE });
});
