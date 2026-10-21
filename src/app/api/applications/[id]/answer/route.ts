import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { answerQuestion, applicationView } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { db } from "@/lib/db";
import { applications, documents } from "@/lib/db/schema";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { headObject } from "@/lib/files";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  questionId: z.string().min(1).max(220),
  value: z.union([z.string().max(6000), z.array(z.string().max(1000)).max(20), z.boolean(), z.null()]).optional(),
  custom: z.string().max(6000).nullable().optional(),
  /** "keep" = the person kept the drafted text as it is. */
  source: z.enum(["user", "generated"]).optional(),
  /** A file uploaded with a signed link from /upload. */
  file: z.object({ key: z.string().max(300), filename: z.string().min(1).max(200), contentType: z.string().max(120), kind: z.string().max(40).optional() }).optional(),
});

const KINDS = new Set(["resume", "cv", "deck", "business_plan", "portfolio", "transcript", "certificate", "license", "paper", "cover_letter", "other"]);

/** Answers one gap question (chip, confirm, text or file); the last required answer resumes preparation. */
export const POST = withErrorCapture("/api/applications/[id]/answer", async (req: Request, ctx: RouteContext<"/api/applications/[id]/answer">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:answer:${session.userId}`, 120, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  const b = parsed.data;
  try {
    let documentId: string | null = null;
    let fileKey: string | null = null;
    if (b.file) {
      // The key was signed for this person by /upload: docs/<userId>/<docId>.<ext>
      const m = new RegExp(`^docs/${session.userId.replace(/[^A-Za-z0-9_-]/g, "")}/(doc_[0-9a-z]{6,40})\\.[a-z0-9]{1,8}$`).exec(b.file.key);
      if (!m) return BAD_INPUT();
      const head = await headObject(b.file.key);
      if (!head) return jsonError("The upload didn't arrive. Try the file again.", 409);
      const own = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, id), eq(applications.userId, session.userId))).limit(1);
      if (!own[0]) return NOT_FOUND();
      documentId = m[1];
      fileKey = b.file.key;
      // The file joins the person's documents, so later applications reuse it.
      await db
        .insert(documents)
        .values({ id: documentId, userId: session.userId, kind: (b.file.kind && KINDS.has(b.file.kind) ? b.file.kind : "other") as never, objectKey: b.file.key, filename: b.file.filename, contentType: head.contentType || b.file.contentType, bytes: head.bytes, status: "uploaded" })
        .onConflictDoNothing({ target: documents.objectKey });
    }
    await answerQuestion(session.userId, id, b.questionId, { value: b.value ?? null, custom: b.custom ?? null, source: b.source, documentId, fileKey });
    const view = await applicationView(session.userId, id);
    return view ? ok({ application: view }) : NOT_FOUND();
  } catch (err) {
    return fromError(err);
  }
});
