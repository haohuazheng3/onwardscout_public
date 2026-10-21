import { and, desc, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { errorGroups } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError, jsonError } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Operator drills for the acceptance runbook and scripts (no browser session needed):
 * Authorization: Bearer CRON_SECRET. The same drills exist for signed-in admins at
 * /api/admin/diagnostics; this route only adds a token-authenticated door for automation.
 *
 *  POST ?action=throw          deliberate server error → error inbox (severity error) → /api/health 503 → owner alert
 *  POST ?action=errors         the open error groups (newest first): name, message, source, route, count, severity
 *  POST ?action=resolve-drills resolve every open error whose message starts with "Diagnostics:"
 *  POST ?action=owner-alert    one owner alert through the mail worker
 */
const Action = z.enum(["throw", "errors", "resolve-drills", "owner-alert"]);
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  if (!bearerMatches(req, env("CRON_SECRET"))) return jsonError("Not authorized.", 401);
  const parsed = Action.safeParse(new URL(req.url).searchParams.get("action"));
  if (!parsed.success) return jsonError("Unknown drill.", 400);
  const action = parsed.data;
  try {
    switch (action) {
      case "throw":
        throw new Error(`Diagnostics: deliberate server error from /api/ops at ${new Date().toISOString()}`);
      case "errors": {
        const rows = await db
          .select({ id: errorGroups.id, name: errorGroups.name, message: errorGroups.message, source: errorGroups.source, route: errorGroups.route, count: errorGroups.count, severity: errorGroups.severity, lastSeen: errorGroups.lastSeen })
          .from(errorGroups)
          .where(isNull(errorGroups.resolvedAt))
          .orderBy(desc(errorGroups.lastSeen))
          .limit(20);
        return Response.json({ open: rows.map((r) => ({ ...r, message: r.message.slice(0, 200) })) }, { headers: NO_STORE });
      }
      case "resolve-drills": {
        const rows = await db
          .update(errorGroups)
          .set({ resolvedAt: sql`now()` })
          .where(and(isNull(errorGroups.resolvedAt), like(errorGroups.message, "Diagnostics:%")))
          .returning({ id: errorGroups.id });
        return Response.json({ ok: true, resolved: rows.length }, { headers: NO_STORE });
      }
      case "owner-alert": {
        const sent = await notifyOwner({ subject: "Diagnostics: owner alert drill", text: `Deliberate test of owner alerts from /api/ops at ${new Date().toISOString()}.` });
        return Response.json({ ok: sent }, { headers: NO_STORE });
      }
    }
  } catch (err) {
    await captureError(err, { route: "/api/ops", source: "server", context: { drill: action } });
    return Response.json({ error: action === "throw" ? "Thrown and captured." : "The drill failed; it has been logged." }, { status: 500, headers: NO_STORE });
  }
}
