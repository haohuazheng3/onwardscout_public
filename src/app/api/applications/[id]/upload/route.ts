import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BAD_INPUT, NOT_FOUND, isAppId, ok, readJson } from "@/lib/applications/http";
import { db } from "@/lib/db";
import { applications } from "@/lib/db/schema";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { docKey, screenKey, signedUploadUrl } from "@/lib/files";
import { newId } from "@/lib/ids";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
  "application/zip": "zip",
  "video/mp4": "mp4",
};
const MAX_FILE = 20 * 1024 * 1024;
const MAX_SCREENSHOT = 8 * 1024 * 1024;

const Body = z.object({
  purpose: z.enum(["answer", "evidence"]),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(120),
  bytes: z.number().int().positive(),
});

/**
 * A signed PUT link straight to the files worker: a file for a gap question (it joins the
 * person's documents once the answer is saved) or a confirmation screenshot for a handoff.
 */
export const POST = withErrorCapture("/api/applications/[id]/upload", async (req: Request, ctx: RouteContext<"/api/applications/[id]/upload">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  // Per burst, and per day: a signed link stores up to 20 MB whether or not the upload is used.
  const [rl, day] = await Promise.all([rateLimit(`applications:upload:${session.userId}`, 30, 600), rateLimit(`applications:upload:day:${session.userId}`, 120, 86400)]);
  if (!rl.ok) return tooMany(rl);
  if (!day.ok) return tooMany(day);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  const b = parsed.data;
  const own = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, session.userId))).limit(1);
  if (!own[0]) return NOT_FOUND();
  const ext = FILE_TYPES[b.contentType];
  if (b.purpose === "evidence") {
    if (b.contentType !== "image/png" && b.contentType !== "image/jpeg") return jsonError("Screenshots can be PNG or JPEG.", 415);
    if (b.bytes > MAX_SCREENSHOT) return jsonError("That screenshot is over 8 MB.", 413);
    const key = screenKey(session.userId, id, 9000 + Math.floor(Math.random() * 999));
    return ok({ key, uploadUrl: signedUploadUrl(key, { contentType: b.contentType, maxBytes: MAX_SCREENSHOT, ttlSeconds: 900 }) });
  }
  if (!ext) return jsonError("That file type isn't supported. Use PDF, Word, PowerPoint, an image, a ZIP or MP4.", 415);
  if (b.bytes > MAX_FILE) return jsonError("That file is over 20 MB.", 413);
  const docId = newId("doc");
  const key = docKey(session.userId, docId, ext);
  return ok({ key, documentId: docId, uploadUrl: signedUploadUrl(key, { contentType: b.contentType, maxBytes: MAX_FILE, ttlSeconds: 900 }) });
});
