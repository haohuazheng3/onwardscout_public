import { z } from "zod";
import { applicationView, confirmApplication } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { getBalance } from "@/lib/credits";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The person's explicit "Confirm & submit" (honesty rule 2): `{ confirm: true }` is required. */
const Body = z.object({ confirm: z.literal(true) });

export const POST = withErrorCapture("/api/applications/[id]/confirm", async (req: Request, ctx: RouteContext<"/api/applications/[id]/confirm">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:confirm:${session.userId}`, 20, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  if (!Body.safeParse(await readJson(req)).success) return BAD_INPUT();
  try {
    await confirmApplication(session.userId, id);
    const [view, balance] = await Promise.all([applicationView(session.userId, id), getBalance(session.userId).catch(() => null)]);
    return ok({ application: view, balance: balance ? { available: balance.available, reserved: balance.reserved } : null });
  } catch (err) {
    return fromError(err);
  }
});
