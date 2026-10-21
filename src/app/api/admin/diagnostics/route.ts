import { and, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";
import { db } from "@/lib/db";
import { errorGroups } from "@/lib/db/schema";
import { sendDigest } from "@/lib/digest";
import { env } from "@/lib/env";
import { captureError, jsonError } from "@/lib/errors";
import { mailerConfigured } from "@/lib/mailer";
import { createNotification } from "@/lib/notifications";
import { notifyOwner } from "@/lib/notify";
import { isResponse } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Admin drills (the proxy answers 404 to non-admins on /api/admin/**; requireAdminApi repeats it).
 *
 *  POST ?action=throw                      deliberate server error: captured in the inbox, answers 500
 *  POST ?action=client-error-instructions  what to look for after the client-error drill
 *  POST ?action=resolve-drills             resolves every open error whose message starts with "Diagnostics:"
 *  POST ?action=ping-mail                  GET <MAIL_WORKER_URL>/health
 *  POST ?action=ping-files                 GET <FILES_BASE_URL>/health
 *  POST ?action=owner-alert                one owner alert through the mail worker
 *  POST ?action=notify-test                one in-app notification for the admin (+ email when configured)
 *  POST ?action=digest-test                the admin's own weekly brief, now, even if nothing happened
 */

const Action = z.enum(["throw", "client-error-instructions", "resolve-drills", "ping-mail", "ping-files", "owner-alert", "notify-test", "digest-test"]);

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

async function ping(base: string | undefined, label: string): Promise<Response> {
  if (!base) return json({ ok: false, error: `${label} URL is not configured.` });
  const started = Date.now();
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; service?: string; at?: string } | null;
    return json({ ok: res.ok && body?.ok === true, status: res.status, ms: Date.now() - started, service: body?.service ?? null, at: body?.at ?? null });
  } catch (err) {
    return json({ ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: Request) {
  const admin = await requireAdminApi();
  if (isResponse(admin)) return admin;
  const parsed = Action.safeParse(new URL(req.url).searchParams.get("action"));
  if (!parsed.success) return jsonError("Unknown drill.", 400);
  const action = parsed.data;
  const route = `/api/admin/diagnostics?action=${action}`;

  try {
    switch (action) {
      case "throw":
        throw new Error(`Diagnostics: deliberate server error from the admin panel at ${new Date().toISOString()}`);

      case "client-error-instructions":
        return json({
          ok: true,
          steps: [
            "This tab threw an uncaught error on purpose.",
            "instrumentation-client.ts reports it to POST /api/errors with sendBeacon.",
            "Within a few seconds the error inbox shows it with source client and route /admin/diagnostics.",
            "Resolve it with “Resolve drill errors” when you are done.",
          ],
        });

      case "resolve-drills": {
        const rows = await db
          .update(errorGroups)
          .set({ resolvedAt: sql`now()` })
          .where(and(isNull(errorGroups.resolvedAt), like(errorGroups.message, "Diagnostics:%")))
          .returning({ id: errorGroups.id });
        return json({ ok: true, resolved: rows.length });
      }

      case "ping-mail":
        return ping(env("MAIL_WORKER_URL"), "MAIL_WORKER");

      case "ping-files":
        return ping(env("FILES_BASE_URL"), "FILES_BASE");

      case "owner-alert": {
        const sent = await notifyOwner({
          subject: "Diagnostics: owner alert drill",
          text: `This is a deliberate test of owner alerts, sent from /admin/diagnostics by ${admin.email} at ${new Date().toISOString()}.`,
        });
        return json({ ok: sent, error: sent ? undefined : "The mail worker did not accept the alert (see the server log)." });
      }

      case "notify-test": {
        const id = await createNotification({
          userId: admin.userId,
          kind: "system",
          title: "Test notification from Diagnostics",
          body: "If you can read this in the bell, in-app notifications work end to end.",
          href: "/admin/diagnostics",
          email: true,
        });
        return json({ ok: Boolean(id), id, emailQueued: Boolean(id) && mailerConfigured() });
      }

      case "digest-test": {
        const out = await sendDigest(admin.userId, { force: true });
        return json({ ok: out.sent, ...out });
      }
    }
  } catch (err) {
    await captureError(err, { route, source: "server", context: { drill: action, admin: admin.email } });
    return json({ error: action === "throw" ? "Thrown and captured." : err instanceof Error ? err.message : "The drill failed." }, 500);
  }
}
