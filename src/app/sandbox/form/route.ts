import { desc, eq, sql } from "drizzle-orm";
import { bearerMatches } from "@/lib/admin";
import { db } from "@/lib/db";
import { sandboxSubmissions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { clientIp, ipHash, rateLimit } from "@/lib/ratelimit";
import { APPLICATION_ID, MAX_RESUME_BYTES, newSandboxRef, renderConfirmation, renderForm, renderMessage, SANDBOX_REF, validateSubmission } from "./render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Onward Scout's own practice application form. Every automated submission test and the
 * built-in "Practice application" opportunity target this route, never a real third party.
 *   GET  /sandbox/form[?app=<applicationId>]       the form (HTML, noindex)
 *   POST /sandbox/form                              multipart (the form's own encoding; résumé
 *                                                   required) or urlencoded (cannot carry files:
 *                                                   résumé optional); stores a row, answers a
 *                                                   confirmation page with #confirmation-ref
 *   GET  /sandbox/form?json=1&ref=SBX-XXXXXX        the stored submission (Bearer CRON_SECRET)
 *   GET  /sandbox/form?json=1&app=<applicationId>   the latest submission for an application
 */

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML_HEADERS, ...extra } });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("json") === "1") return readSubmission(req, url);
  const app = url.searchParams.get("app") ?? undefined;
  return html(renderForm({ applicationId: app && APPLICATION_ID.test(app) ? app : undefined }));
}

async function readSubmission(req: Request, url: URL): Promise<Response> {
  if (!bearerMatches(req, env("CRON_SECRET"))) return json({ error: "Unauthorized." }, 401);
  const ref = url.searchParams.get("ref")?.trim().toUpperCase();
  const app = url.searchParams.get("app")?.trim();
  try {
    let rows;
    if (ref) {
      if (!SANDBOX_REF.test(ref)) return json({ error: "A reference looks like SBX-7KQ2M9." }, 400);
      rows = await db.select().from(sandboxSubmissions).where(eq(sandboxSubmissions.ref, ref)).limit(1);
    } else if (app && APPLICATION_ID.test(app)) {
      rows = await db
        .select()
        .from(sandboxSubmissions)
        .where(sql`${sandboxSubmissions.fields} ->> 'application_id' = ${app}`)
        .orderBy(desc(sandboxSubmissions.createdAt))
        .limit(1);
    } else return json({ error: "Pass ?ref=SBX-… or ?app=app_…" }, 400);
    const row = rows[0];
    if (!row) return json({ error: "No submission found." }, 404);
    return json({ ref: row.ref, fields: row.fields, files: row.files, userAgent: row.userAgent, createdAt: row.createdAt });
  } catch (err) {
    await captureError(err, { route: "/sandbox/form", context: { stage: "read" } });
    return json({ error: "The submission could not be read." }, 500);
  }
}

export async function POST(req: Request) {
  try {
    // Larger than the biggest allowed résumé plus the text fields: refuse before parsing.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_RESUME_BYTES + 256 * 1024) {
      return html(renderMessage("File too large", "Your résumé is larger than 4 MB. Please go back and attach a smaller file."), 413);
    }
    const ip = ipHash(clientIp(req.headers));
    const rl = await rateLimit(`sandbox:${ip}`, 20, 600);
    if (!rl.ok) {
      return html(renderMessage("Too many submissions", "You have sent many practice applications in a short time. Please wait a few minutes and try again."), 429, {
        "Retry-After": String(Math.max(1, rl.resetIn)),
      });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return html(renderMessage("We could not read that submission", "Send the form as multipart/form-data or application/x-www-form-urlencoded."), 400);
    }

    const urlencoded = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
    const result = validateSubmission(form, { requireFile: !urlencoded });
    if (!result.ok) return html(renderForm({ values: result.values, errors: result.errors }), 422);

    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 400) || null;
    // The reference is unique; on the (rare) collision draw another one.
    for (let attempt = 0; attempt < 4; attempt++) {
      const ref = newSandboxRef();
      const inserted = await db
        .insert(sandboxSubmissions)
        .values({ id: newId("sbx"), ref, fields: result.fields, files: result.files, userAgent, ipHash: ip })
        .onConflictDoNothing({ target: sandboxSubmissions.ref })
        .returning({ ref: sandboxSubmissions.ref });
      if (inserted[0]) {
        return html(renderConfirmation({ ref: inserted[0].ref, name: result.fields.full_name ?? "", email: result.fields.email ?? "" }));
      }
    }
    throw new Error("could not allocate a unique sandbox reference");
  } catch (err) {
    await captureError(err, { route: "/sandbox/form", context: { stage: "submit" } });
    return html(renderMessage("Something went wrong", "Your practice application was not saved. It has been logged; please try again in a moment."), 500);
  }
}
