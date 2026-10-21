import { z } from "zod";
import { signedDocumentUrl } from "@/lib/documents";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  generatedDocumentId: z.string().regex(/^gen_[0-9a-z]{6,40}$/),
  format: z.enum(["pdf", "docx", "pptx"]),
  disposition: z.enum(["inline", "attachment"]).optional(),
});

/**
 * Renders a generated document (PDF / DOCX, pitch notes also PPTX), stores it in R2 and returns
 * a 10-minute signed link. A Chinese PDF whose font is unavailable comes back as DOCX
 * (`fallback: true`) — the person always gets a file.
 */
export const POST = withErrorCapture("/api/documents/render", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`documents:render:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("That request isn't valid. Reload the page and try again.", 400);
  const r = await signedDocumentUrl(session.userId, parsed.data.generatedDocumentId, parsed.data.format, parsed.data.disposition ?? "attachment");
  if (!r) return jsonError("We couldn't find that document.", 404);
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
});
