import { z } from "zod";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { draftReader } from "@/lib/profile/draft-route";
import { localeSchema, ok, readBody } from "@/lib/profile/http";
import { deleteDocument, reparseDocument } from "@/lib/profile/pipeline";
import { anonWriteLimit } from "@/lib/profile/anon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^doc_[0-9a-z]{6,40}$/;

/** Removes a source from the draft on /app/start (`?id=doc_…`). */
export const DELETE = withErrorCapture("/api/drafts/documents", async (req: Request) => {
  const owner = await draftReader();
  if (owner instanceof Response) return owner;
  if (!owner) return jsonError("We couldn't find that document.", 404);
  if (owner.anonymous) {
    const limited = await anonWriteLimit("delete", 60, 3600);
    if (limited) return limited;
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!ID.test(id)) return jsonError("That document reference isn't valid.", 400);
  const removed = await deleteDocument(owner.ownerId, id, url.searchParams.get("locale") === "zh" ? "zh" : "en");
  if (!removed) return jsonError("We couldn't find that document.", 404);
  return ok({ removed: true });
});

const Body = z.object({ id: z.string().regex(ID), action: z.literal("reparse"), locale: localeSchema });

/** Reads a draft source again ({ id, action: "reparse" }). */
export const POST = withErrorCapture("/api/drafts/documents", async (req: Request) => {
  const owner = await draftReader();
  if (owner instanceof Response) return owner;
  if (!owner) return jsonError("We couldn't find that document.", 404);
  if (owner.anonymous) {
    const limited = await anonWriteLimit("reparse", 20, 3600);
    if (limited) return limited;
  }
  const body = await readBody(req, Body);
  if ("error" in body) return body.error;
  const row = await reparseDocument(owner.ownerId, body.data.id, body.data.locale);
  if (!row) return jsonError("We couldn't find that document.", 404);
  return ok({ document: { id: row.id, status: row.status } });
});
