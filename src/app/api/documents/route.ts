import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { generatedDocuments } from "@/lib/db/schema";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { ok, trackEvent } from "@/lib/profile/http";
import { deleteDocument, listDocuments } from "@/lib/profile/pipeline";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The person's sources (uploads, links, notes) and the documents we generated for them. */
export const GET = withErrorCapture("/api/documents", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const [uploaded, generated] = await Promise.all([
    listDocuments(session.userId),
    db
      .select({
        id: generatedDocuments.id,
        kind: generatedDocuments.kind,
        title: generatedDocuments.title,
        language: generatedDocuments.language,
        applicationId: generatedDocuments.applicationId,
        mime: generatedDocuments.mime,
        version: generatedDocuments.version,
        createdAt: generatedDocuments.createdAt,
        objectKey: generatedDocuments.objectKey,
      })
      .from(generatedDocuments)
      .where(eq(generatedDocuments.userId, session.userId))
      .orderBy(desc(generatedDocuments.createdAt))
      .limit(100),
  ]);
  return ok({
    uploaded: uploaded.map((d) => ({ ...d, extraction: undefined, counts: d.extraction?.counts ?? {}, warnings: d.extraction?.warnings ?? [] })),
    generated: generated.map(({ objectKey, ...g }) => ({ ...g, downloadable: Boolean(objectKey) })),
  });
});

/** Removes one of the person's own sources (`?id=doc_…`); the profile is rebuilt without it. */
export const DELETE = withErrorCapture("/api/documents", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`documents:delete:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const locale = url.searchParams.get("locale") === "zh" ? "zh" : "en";
  if (!/^doc_[0-9a-z]{6,40}$/.test(id)) return jsonError("That document reference isn't valid.", 400);
  const removed = await deleteDocument(session.userId, id, locale);
  if (!removed) return jsonError("We couldn't find that document.", 404);
  await trackEvent(session.userId, "document_removed", { documentId: id });
  return ok({ removed: true });
});
