import { waitUntil } from "@vercel/functions";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { CONTACT_ERROR_TEXT, CONTACT_TOPICS, parseContact, type ContactErrorCode } from "@/content/contact";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId, sha256 } from "@/lib/ids";
import { notifyOwner } from "@/lib/notify";
import { clientIp, ipHash, rateLimit } from "@/lib/ratelimit";
import { SITE } from "@/lib/site";

/*
 * POST /api/contact — the public contact form. Works signed out. Validates with the same zod
 * contract as the form (src/content/contact.ts), drops honeypot hits with a quiet success,
 * limits to 5 messages per 10 minutes per network address and 5 per hour per email, stores
 * the message in contact_messages and notifies the owner through the mail worker (after the
 * response, marked `notified` once delivered). Answers `{ ok: true }` or `{ error, code }`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(code: ContactErrorCode, status: number, extra: Record<string, string> = {}): Response {
  return Response.json({ error: CONTACT_ERROR_TEXT[code], code }, { status, headers: { ...NO_STORE, ...extra } });
}

/** The signed-in user's id when Clerk is configured and a session exists; null otherwise. */
async function sessionUserId(): Promise<string | null> {
  if (!env("CLERK_SECRET_KEY") || !env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")) return null;
  try {
    return (await auth()).userId ?? null;
  } catch (err) {
    // The form must keep working when the session can't be read; record why, answer anyway.
    await captureError(err, { route: "/api/contact", severity: "warn", context: { step: "auth" } });
    return null;
  }
}

function topicLabel(value: string): string {
  return CONTACT_TOPICS.find((t) => t.value === value)?.label.en ?? value;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req.headers);
    const ipKey = ipHash(ip);
    const byIp = await rateLimit(`contact:ip:${ipKey}`, 5, 600);
    if (!byIp.ok) return fail("rate_limited", 429, { "Retry-After": String(Math.max(1, byIp.resetIn)) });

    const parsed = parseContact(await req.json().catch(() => null));
    if (!parsed.ok) return fail(parsed.code, 400);
    const d = parsed.data;
    if (parsed.bot) return Response.json({ ok: true }, { headers: NO_STORE });

    const byEmail = await rateLimit(`contact:email:${sha256(d.email).slice(0, 24)}`, 5, 3600);
    if (!byEmail.ok) return fail("rate_limited", 429, { "Retry-After": String(Math.max(1, byEmail.resetIn)) });

    const userId = await sessionUserId();
    const id = newId("cm");
    await db.insert(contactMessages).values({
      id,
      name: d.name || null,
      email: d.email,
      topic: d.topic,
      message: d.message,
      locale: d.locale,
      userId,
      ipHash: ipKey,
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });

    const notify = notifyOwner({
      subject: `Contact: ${topicLabel(d.topic)} — ${d.email}`,
      text: [
        `From: ${d.name || "(no name)"} <${d.email}>`,
        `Topic: ${topicLabel(d.topic)}`,
        `Language: ${d.locale}`,
        userId ? `Account: ${userId}` : "Account: (not signed in)",
        "",
        d.message,
        "",
        `Reference: ${id}`,
        `Admin: ${SITE.url}/admin/messages`,
      ].join("\n"),
      replyTo: d.email,
    })
      .then(async (ok) => {
        if (ok) await db.update(contactMessages).set({ notified: 1 }).where(eq(contactMessages.id, id));
      })
      .catch((err: unknown) => captureError(err, { route: "/api/contact", context: { step: "notify", id } }));
    waitUntil(notify);

    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    await captureError(err, { route: "/api/contact" });
    return fail("server", 500);
  }
}
