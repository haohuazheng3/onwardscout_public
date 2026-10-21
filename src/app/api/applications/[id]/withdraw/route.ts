import { applicationView, withdrawApplication } from "@/lib/applications";
import { NOT_FOUND, fromError, isAppId, ok } from "@/lib/applications/http";
import { getBalance } from "@/lib/credits";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Withdraw: a reserved credit comes back when nothing was submitted. */
export const POST = withErrorCapture("/api/applications/[id]/withdraw", async (_req: Request, ctx: RouteContext<"/api/applications/[id]/withdraw">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:withdraw:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  try {
    await withdrawApplication(session.userId, id);
    const [view, balance] = await Promise.all([applicationView(session.userId, id), getBalance(session.userId).catch(() => null)]);
    return ok({ application: view, balance: balance ? { available: balance.available, reserved: balance.reserved } : null });
  } catch (err) {
    return fromError(err);
  }
});
