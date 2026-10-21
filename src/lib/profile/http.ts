import "server-only";
import { z } from "zod";
import { captureError, jsonError } from "@/lib/errors";
import { recordEvent } from "@/lib/notifications";
import { ActionError } from "./actions";
import { PipelineError } from "./pipeline";

/* Small helpers shared by the profile, uploads, goals, documents and drafts routes. */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export const localeSchema = z.enum(["en", "zh"]).optional();

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

/** Parses a JSON body with zod; a ready 400 response when it doesn't fit. */
export async function readBody<T extends z.ZodTypeAny>(req: Request, schema: T, message = "That request isn't valid. Reload the page and try again."): Promise<{ data: z.infer<T> } | { error: Response }> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const custom = parsed.error.issues.find((i) => i.code === "custom")?.message;
    return { error: jsonError(custom ?? message, 400) };
  }
  return { data: parsed.data };
}

/** Known, user-facing failures become their JSON answer; anything else is rethrown. */
export function knownError(err: unknown): Response {
  if (err instanceof PipelineError || err instanceof ActionError) return jsonError(err.message, err.status);
  throw err;
}

/** Records a product event for a signed-in person; never fails the request. */
export async function trackEvent(userId: string, kind: string, data: Record<string, unknown> = {}): Promise<void> {
  if (userId.startsWith("anon_")) return;
  try {
    await recordEvent({ userId, kind, data });
  } catch (err) {
    await captureError(err, { route: `profile/event:${kind}`, severity: "warn" });
  }
}
