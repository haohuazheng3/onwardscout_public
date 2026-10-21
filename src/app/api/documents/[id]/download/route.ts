import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, generatedDocuments } from "@/lib/db/schema";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { signedReadUrl } from "@/lib/files";
import { ok } from "@/lib/profile/http";
import { safeFilename } from "@/lib/profile/uploads";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(title: string): string {
  return safeFilename(title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "document");
}

/**
 * A short-lived signed link to one of the person's files: an upload (`doc_…`) or a rendered
 * generated document (`gen_…`, once P3a has rendered it). `?inline=1` opens instead of saving.
 */
export const GET = withErrorCapture("/api/documents/[id]/download", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`documents:download:${session.userId}`, 120, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  const disposition = new URL(req.url).searchParams.get("inline") === "1" ? "inline" : "attachment";
  if (id.startsWith("doc_")) {
    const row = (await db.select({ objectKey: documents.objectKey, filename: documents.filename }).from(documents).where(and(eq(documents.id, id), eq(documents.userId, session.userId))).limit(1))[0];
    if (!row) return jsonError("We couldn't find that document.", 404);
    if (!row.objectKey) return jsonError("This source is a link or a note, so there is no file to download.", 409);
    return ok({ url: signedReadUrl(row.objectKey, { disposition, filename: slug(row.filename ?? "document"), ttlSeconds: 300 }) });
  }
  if (id.startsWith("gen_")) {
    const row = (await db.select({ objectKey: generatedDocuments.objectKey, title: generatedDocuments.title, mime: generatedDocuments.mime }).from(generatedDocuments).where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.userId, session.userId))).limit(1))[0];
    if (!row) return jsonError("We couldn't find that document.", 404);
    if (!row.objectKey) return jsonError("This document hasn't been rendered to a file yet. Open its application to render it.", 409);
    const ext = row.objectKey.split(".").pop() ?? "pdf";
    return ok({ url: signedReadUrl(row.objectKey, { disposition, filename: `${slug(row.title)}.${ext}`.replace(new RegExp(`\\.${ext}\\.${ext}$`), `.${ext}`), ttlSeconds: 300 }) });
  }
  return jsonError("That document reference isn't valid.", 400);
});
