import { z } from "zod";
import { applicationView, completeHandoff } from "@/lib/applications";
import { BAD_INPUT, NOT_FOUND, fromError, isAppId, ok, readJson } from "@/lib/applications/http";
import { getBalance } from "@/lib/credits";
import { withErrorCapture } from "@/lib/errors";
import { headObject } from "@/lib/files";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  url: z.string().trim().max(2000).url().optional().or(z.literal("")),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  screenshotKey: z.string().max(300).optional(),
});

/** "I submitted it": the handoff is done; the credit is settled and follow-ups are scheduled. */
export const POST = withErrorCapture("/api/applications/[id]/handoff-done", async (req: Request, ctx: RouteContext<"/api/applications/[id]/handoff-done">) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:handoff:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const { id } = await ctx.params;
  if (!isAppId(id)) return NOT_FOUND();
  const parsed = Body.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return BAD_INPUT();
  const b = parsed.data;
  if (b.url && !/^https?:\/\//i.test(b.url)) return BAD_INPUT();
  if (b.screenshotKey) {
    const prefix = `screens/${session.userId}/${id}/`;
    if (!b.screenshotKey.startsWith(prefix) || !(await headObject(b.screenshotKey))) return BAD_INPUT();
  }
  try {
    const res = await completeHandoff(session.userId, id, { url: b.url || null, reference: b.reference ?? null, note: b.note ?? null, screenshotKey: b.screenshotKey ?? null });
    const [view, balance] = await Promise.all([applicationView(session.userId, id), getBalance(session.userId).catch(() => null)]);
    return ok({ application: view, unlock: res.unlock, balance: balance ? { available: balance.available, reserved: balance.reserved } : null });
  } catch (err) {
    return fromError(err);
  }
});
