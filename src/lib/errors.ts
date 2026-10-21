import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { db } from "./db";
import { errorGroups } from "./db/schema";
import { newId } from "./ids";
import { notifyOwner } from "./notify";
import { SITE } from "./site";

export type ErrorSource = "server" | "client" | "edge" | "worker" | "cron";
export type Severity = "error" | "warn";

export interface CaptureOptions {
  route?: string | null;
  source?: ErrorSource;
  severity?: Severity;
  context?: Record<string, unknown>;
}

interface Normalized {
  name: string;
  message: string;
  stack: string;
}

export function normalizeError(err: unknown): Normalized {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message || "(no message)", stack: err.stack || "" };
  }
  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    let message: string;
    if (typeof o.message === "string") message = o.message;
    else {
      try {
        message = JSON.stringify(o).slice(0, 500);
      } catch {
        message = Object.prototype.toString.call(o);
      }
    }
    return { name: typeof o.name === "string" ? o.name : "NonError", message, stack: typeof o.stack === "string" ? o.stack : "" };
  }
  return { name: "NonError", message: String(err).slice(0, 500), stack: "" };
}

/** First stack frame, with build hashes and line/column numbers stripped so the fingerprint survives deploys. */
export function firstFrame(stack: string): string {
  const line = stack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") || /@https?:/.test(l));
  if (!line) return "";
  return line
    .replace(/\?[^\s)]*/g, "")
    .replace(/:\d+:\d+/g, "")
    .replace(/:\d+\)/g, ")")
    .replace(/[a-f0-9]{8,}/gi, "#")
    .slice(0, 300);
}

export function fingerprintOf(name: string, frame: string, route: string | null | undefined, message: string): string {
  // When there is no usable frame, fall back to a message prefix (digits masked) so unrelated errors don't merge.
  const anchor = frame || message.replace(/\d+/g, "#").slice(0, 120);
  return createHash("sha1").update(`${name}|${anchor}|${route ?? ""}`).digest("hex");
}

const NOTIFY_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * React hydration mismatches reported by browsers (#418/#423/#425, "Hydration failed").
 * React recovers by rendering on the client, and in the field they come from extensions,
 * translation tools (very common on a bilingual site) or outdated engines rewriting the DOM
 * before hydration. They stay in the inbox as warnings instead of turning /api/health red.
 */
const HYDRATION = /Minified React error #(418|423|425)\b|Hydration failed|error while hydrating|did not match the client/i;

export function effectiveSeverity(source: ErrorSource, requested: Severity, message: string): Severity {
  if (source === "client" && HYDRATION.test(message)) return "warn";
  return requested;
}

/** Sources whose unresolved errors make /api/health answer 503: our own code, never anonymous browser reports. */
export const HEALTH_SOURCES: readonly ErrorSource[] = ["server", "edge", "worker", "cron"];

const OUR_BUNDLE = /\/_next\/static\//;
const EXTENSION = /(chrome|moz|safari|safari-web)-extension:\/\//;

/**
 * The severity the server accepts from an anonymous browser report. The client's own label is
 * a hint only: "error" stands when the stack runs through our bundle and no extension, so a
 * forged payload can fill the inbox with warnings at most, never page the owner or turn health red.
 */
export function clientSeverity(requested: Severity, stack: string | undefined): Severity {
  if (requested !== "error") return "warn";
  const s = stack ?? "";
  return OUR_BUNDLE.test(s) && !EXTENSION.test(s) ? "error" : "warn";
}

function runInBackground(p: Promise<unknown>): Promise<void> | void {
  try {
    waitUntil(p);
  } catch {
    // Outside a request context (scripts, tests): wait for it instead.
    return p.then(() => undefined);
  }
}

/**
 * Record an error in the inbox. Never throws: if the database itself is down the error is
 * still written to the platform logs (where /api/health also goes red). Owner alerts for
 * severe server-side errors are throttled to one per fingerprint every 6 hours.
 */
export async function captureError(err: unknown, opts: CaptureOptions = {}): Promise<void> {
  const n = normalizeError(err);
  const source = opts.source ?? "server";
  const route = opts.route ?? null;
  const requested = opts.severity ?? "error";
  const severity = effectiveSeverity(source, requested, n.message);
  const forcedWarn = severity === "warn" && requested === "error";
  const frame = firstFrame(n.stack);
  const fingerprint = fingerprintOf(n.name, frame, route, n.message);
  console.error(`[capture:${source}:${severity}] ${n.name}: ${n.message}`, route ?? "", n.stack.split("\n").slice(0, 4).join(" | "));

  try {
    const rows = await db
      .insert(errorGroups)
      .values({
        id: newId("err"),
        fingerprint,
        name: n.name.slice(0, 200),
        message: n.message.slice(0, 2000),
        route,
        source,
        severity,
        firstFrame: frame || null,
        stack: n.stack.slice(0, 8000) || null,
        context: opts.context ?? null,
      })
      .onConflictDoUpdate({
        target: errorGroups.fingerprint,
        set: {
          count: sql`${errorGroups.count} + 1`,
          lastSeen: sql`now()`,
          message: n.message.slice(0, 2000),
          stack: n.stack.slice(0, 8000) || null,
          context: opts.context ?? null,
          // A resolved error that comes back is a regression: reopen it.
          resolvedAt: null,
          // Once severe, a group stays severe (a later warn of the same fingerprint doesn't hide it),
          // except hydration noise, which is forced down to warn.
          severity: forcedWarn ? "warn" : sql`CASE WHEN ${errorGroups.severity} = 'error' THEN 'error' ELSE ${severity} END`,
        },
      })
      .returning({ id: errorGroups.id, count: errorGroups.count, notifiedAt: errorGroups.notifiedAt, severity: errorGroups.severity });

    const row = rows[0];
    // Browser reports never page anyone: they are reviewed in the inbox (anonymous input can be forged at will).
    const shouldNotify =
      row && source !== "client" && row.severity === "error" && (!row.notifiedAt || Date.now() - new Date(row.notifiedAt).getTime() > NOTIFY_EVERY_MS);
    if (shouldNotify) {
      await db.update(errorGroups).set({ notifiedAt: sql`now()` }).where(eq(errorGroups.id, row.id));
      const text = [
        `${n.name}: ${n.message}`,
        "",
        `Source: ${source}    Route: ${route ?? "-"}    Occurrences: ${row.count}`,
        `Frame: ${frame || "-"}`,
        "",
        n.stack.split("\n").slice(0, 12).join("\n"),
        "",
        `Inbox: ${SITE.url}/admin/errors`,
      ].join("\n");
      await runInBackground(notifyOwner({ subject: `Error: ${n.name} on ${route ?? source}`, text }));
    }
  } catch (dbErr) {
    console.error("[capture] could not record error in the inbox:", dbErr);
  }
}

/** JSON error body every API uses: `{ error: "<a human sentence>" }`, never cached. */
export function jsonError(message: string, status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Wrap a route handler so any thrown error is captured and answered with a clean 500. */
export function withErrorCapture<A extends unknown[]>(route: string, handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      // next/navigation's redirect()/notFound() throw control-flow errors that Next must see.
      if (isNextControlFlow(err)) throw err;
      await captureError(err, { route, source: "server" });
      return jsonError("Something went wrong on our side. It has been logged and we are looking into it.", 500);
    }
  };
}

/** redirect(), notFound(), forbidden() and dynamic-rendering bailouts carry a NEXT_* digest. */
export function isNextControlFlow(err: unknown): boolean {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  return /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest);
}
