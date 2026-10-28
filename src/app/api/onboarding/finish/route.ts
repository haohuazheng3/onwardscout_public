import { z } from "zod";
import { withErrorCapture } from "@/lib/errors";
import { finishOnboarding } from "@/lib/profile/directions";
import { ok, readBody } from "@/lib/profile/http";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ locale: z.enum(["en", "zh"]).default("en"), confirm: z.boolean().default(true) });

/** The last answer on /app/start: Onward Scout works out where the person should go, sets it up and starts matching. */
export const POST = withErrorCapture("/api/onboarding/finish", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`onboarding:finish:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, bodySchema);
  if ("error" in body) return body.error;
  return ok(await finishOnboarding(session.userId, body.data.locale, { confirm: body.data.confirm }));
});
