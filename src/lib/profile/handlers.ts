import "server-only";
import { z } from "zod";
import { profilePatchSchema } from "./patch";
import { openGaps, patchProfile, roleHintsOf } from "./actions";
import { createGoalsSchema, saveGoals } from "./goals";
import { knownError, localeSchema, ok, readBody, trackEvent } from "./http";
import { addLink, addNote, completeUpload, signUpload } from "./pipeline";
import { draftStatus } from "./status";
import { ensureProfile, getFacts, profileOf } from "./store";
import { UPLOAD_LIMITS } from "./uploads";

/*
 * Request handlers shared by both route families: /api/uploads/*, /api/profile* and
 * /api/goals (signed in) and /api/drafts/* (a signed-out visitor's anonymous draft, or the
 * signed-in person when they have a session). The route resolves the owner and the limits;
 * these do the work.
 */

export const signBody = z.object({
  filename: z.string().trim().min(1).max(300),
  contentType: z.string().max(200).nullable().optional(),
  bytes: z.number().int().positive().max(UPLOAD_LIMITS.maxBytes, "Each file can be up to 20 MB."),
  locale: localeSchema,
});
export const completeBody = z.object({ ticket: z.string().min(10).max(2000), locale: localeSchema });
export const linksBody = z.object({ urls: z.array(z.string().trim().min(3).max(500)).min(1).max(UPLOAD_LIMITS.maxLinks), locale: localeSchema });
export const noteBody = z.object({ text: z.string().trim().min(1).max(UPLOAD_LIMITS.maxNoteChars), locale: localeSchema });
export const patchBody = z.object({ patch: profilePatchSchema, locale: localeSchema });

export async function handleSign(ownerId: string, req: Request, maxFiles: number): Promise<Response> {
  const body = await readBody(req, signBody);
  if ("error" in body) return body.error;
  try {
    return ok(await signUpload(ownerId, body.data, { maxFiles }));
  } catch (err) {
    return knownError(err);
  }
}

export async function handleComplete(ownerId: string, req: Request, maxFiles: number): Promise<Response> {
  const body = await readBody(req, completeBody);
  if ("error" in body) return body.error;
  try {
    const doc = await completeUpload(ownerId, body.data.ticket, { maxFiles, locale: body.data.locale });
    await trackEvent(ownerId, "document_added", { documentId: doc.id, kind: doc.kind });
    return ok({ document: { id: doc.id, kind: doc.kind, filename: doc.filename, status: doc.status, bytes: doc.bytes } });
  } catch (err) {
    return knownError(err);
  }
}

export async function handleLinks(ownerId: string, req: Request, opts: { maxLinksTotal?: number } = {}): Promise<Response> {
  const body = await readBody(req, linksBody);
  if ("error" in body) return body.error;
  const results: { url: string; ok: boolean; documentId?: string; hint?: string | null; error?: string }[] = [];
  for (const url of body.data.urls) {
    try {
      const r = await addLink(ownerId, url, { locale: body.data.locale, maxLinks: opts.maxLinksTotal });
      results.push({ url, ok: true, documentId: r.document.id, hint: r.hint });
    } catch (err) {
      const res = knownError(err);
      results.push({ url, ok: false, error: ((await res.json()) as { error: string }).error });
    }
  }
  if (results.some((r) => r.ok)) await trackEvent(ownerId, "links_added", { count: results.filter((r) => r.ok).length });
  return ok({ results });
}

export async function handleNote(ownerId: string, req: Request): Promise<Response> {
  const body = await readBody(req, noteBody);
  if ("error" in body) return body.error;
  try {
    const doc = await addNote(ownerId, body.data.text, body.data.locale ?? "en");
    return ok({ document: { id: doc.id, kind: doc.kind, filename: doc.filename, status: doc.status } });
  } catch (err) {
    return knownError(err);
  }
}

export async function handleStatus(ownerId: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "zh" ? "zh" : "en";
  return ok(await draftStatus(ownerId, { locale, heal: true }));
}

/** The profile card's data: the profile document, its state and the open questions. */
export async function handleProfileGet(ownerId: string): Promise<Response> {
  const row = await ensureProfile(ownerId);
  const [gaps, rows] = await Promise.all([openGaps(ownerId), getFacts(ownerId)]);
  return ok({ profile: profileOf(row), status: row.status, version: row.version, completeness: row.completeness, gaps, roleHints: roleHintsOf(rows) });
}

export async function handleProfilePatch(ownerId: string, req: Request): Promise<Response> {
  const body = await readBody(req, patchBody);
  if ("error" in body) return body.error;
  try {
    const summary = await patchProfile(ownerId, body.data.patch, body.data.locale ?? "en");
    if (body.data.patch.op === "confirm") await trackEvent(ownerId, "profile_confirmed", { version: summary.version });
    return ok(summary);
  } catch (err) {
    return knownError(err);
  }
}

export async function handleGoalsCreate(ownerId: string, req: Request): Promise<{ response: Response; created: number }> {
  const body = await readBody(req, createGoalsSchema);
  if ("error" in body) return { response: body.error, created: 0 };
  const res = await saveGoals(ownerId, body.data.goals, body.data.locale ?? "en");
  for (const g of res.goals) await trackEvent(ownerId, "goal_set", { goalId: g.id, family: g.family, sub: g.sub });
  return { response: ok({ goals: res.goals, created: res.created }), created: res.created };
}
