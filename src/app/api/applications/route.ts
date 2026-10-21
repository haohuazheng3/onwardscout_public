import { z } from "zod";
import { listBoard, startApplication, startPracticeApplication } from "@/lib/applications";
import { fromError, ok, readJson, BAD_INPUT } from "@/lib/applications/http";
import { withErrorCapture } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The board: every application of the signed-in person (optionally one goal). */
export const GET = withErrorCapture("/api/applications", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const goalId = new URL(req.url).searchParams.get("goalId");
  const cards = await listBoard(session.userId, { goalId: goalId && /^gol_[0-9a-z]{6,40}$/.test(goalId) ? goalId : null });
  return ok({ applications: cards });
});

const Create = z.union([
  z.object({ opportunityId: z.string().trim().regex(/^opp_[0-9a-z]{6,40}$/), goalId: z.string().trim().regex(/^gol_[0-9a-z]{6,40}$/).optional(), practice: z.boolean().optional() }),
  z.object({ practice: z.literal(true) }),
]);

/** "Apply for me": creates the application and starts preparing it at once. */
export const POST = withErrorCapture("/api/applications", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`applications:create:${session.userId}`, 30, 600);
  if (!rl.ok) return tooMany(rl);
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return BAD_INPUT();
  try {
    if (!("opportunityId" in parsed.data)) {
      const { applicationId } = await startPracticeApplication(session.userId);
      return ok({ applicationId, created: true }, 201);
    }
    const r = await startApplication({ userId: session.userId, opportunityId: parsed.data.opportunityId, goalId: parsed.data.goalId, practice: parsed.data.practice });
    return ok(r, r.created ? 201 : 200);
  } catch (err) {
    return fromError(err);
  }
});
