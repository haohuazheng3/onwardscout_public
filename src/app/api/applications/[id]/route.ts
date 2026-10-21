import { z } from "zod";
import { applicationView, editAnswers, editDocument, editEmail } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The application room's data (polled while a job works on it). */
export const GET = withErrorCapture("/api/applications/[id]", async (_req: Request, ctx: RouteContext<"/api/applications/[id]">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const view = await applicationView(session.userId, id);
  if (!view) return NOT_FOUND();
  return ok({ application: view });
});

const Patch = z
  .object({
    answers: z.record(z.string().min(1).max(200), z.string().max(6000)).optional(),
    document: z
      .object({
        id: z.string().regex(/^gen_[0-9a-z]{6,40}$/),
        edits: z.array(z.object({ index: z.number().int().min(0).max(500), text: z.string().max(8000) })).max(200),
        title: z.string().max(300).optional(),
      })
      .optional(),
    email: z.object({ documentId: z.string().regex(/^gen_[0-9a-z]{6,40}$/), subject: z.string().max(300).optional(), body: z.string().max(20000).optional() }).optional(),
  })
  .refine((v) => v.answers || v.document || v.email, "nothing to change");

/** Edits: settled answers, document blocks (inline), the outreach email. */
export const PATCH = withErrorCapture("/api/applications/[id]", async (req: Request, ctx: RouteContext<"/api/applications/[id]">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:edit:${session.userId}`, 120, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    if (parsed.data.answers) await editAnswers(session.userId, id, parsed.data.answers);
    if (parsed.data.document) await editDocument(session.userId, id, parsed.data.document.id, parsed.data.document.edits, parsed.data.document.title);
    if (parsed.data.email) await editEmail(session.userId, id, parsed.data.email.documentId, { subject: parsed.data.email.subject, body: parsed.data.email.body });
    const view = await applicationView(session.userId, id);
    return view ? ok({ application: view }) : NOT_FOUND();
  } catch (err) {
    return fromError(err);
  }
});
