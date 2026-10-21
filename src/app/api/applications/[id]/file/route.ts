import { and, eq } from "drizzle-orm";
import { NOT_FOUND, isAppId, ok } from "@/lib/applications/http";
import { db } from "@/lib/db";
import { applications, documents } from "@/lib/db/schema";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { signedReadUrl } from "@/lib/files";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A short-lived download link for one of the person's own files listed in a handoff. */
export const GET = withErrorCapture("/api/applications/[id]/file", async (req: Request, ctx: RouteContext<"/api/applications/[id]/file">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const documentId = new URL(req.url).searchParams.get("documentId") ?? "";
  if (!/^doc_[0-9a-z]{6,40}$/.test(documentId)) return jsonError("We couldn't find that file.", 404);
  const own = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, session.userId))).limit(1);
  if (!own[0]) return NOT_FOUND();
  const rows = await db.select({ key: documents.objectKey, filename: documents.filename }).from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, session.userId))).limit(1);
  const doc = rows[0];
  if (!doc?.key) return jsonError("We couldn't find that file.", 404);
  const filename = doc.filename ?? "document";
  return ok({ url: signedReadUrl(doc.key, { disposition: "attachment", filename, ttlSeconds: 600 }), filename });
});
