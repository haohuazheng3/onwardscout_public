import { z } from "zod";
import { withErrorCapture } from "@/lib/errors";
import { draftWriter } from "@/lib/profile/draft-route";
import { finishOnboarding } from "@/lib/profile/directions";
import { ok, readBody } from "@/lib/profile/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ locale: z.enum(["en", "zh"]).default("en"), confirm: z.boolean().default(true) });

/** The last answer on /app/start signed out: the same set-up on the draft, then straight to the dashboard (no sign-in). */
export const POST = withErrorCapture("/api/drafts/finish", async (req: Request) => {
  const ctx = await draftWriter("finish", 15);
  if (ctx instanceof Response) return ctx;
  const body = await readBody(req, bodySchema);
  if ("error" in body) return body.error;
  return ok(await finishOnboarding(ctx.owner.ownerId, body.data.locale, { confirm: body.data.confirm }));
});
