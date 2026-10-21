import { withErrorCapture, jsonError } from "@/lib/errors";
import { refreshMatchesSoon } from "@/lib/opportunities";
import { listGoals, updateGoalSchema, updateGoal } from "@/lib/profile/goals";
import { handleGoalsCreate } from "@/lib/profile/handlers";
import { ok, readBody, trackEvent } from "@/lib/profile/http";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every goal with its milestones (active first). */
export const GET = withErrorCapture("/api/goals", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  return ok({ goals: await listGoals(session.userId) });
});

/** New goals (or updates of the same sub-goal) with playbook milestones; matching restarts. */
export const POST = withErrorCapture("/api/goals", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`goals:write:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  const { response } = await handleGoalsCreate(session.userId, req);
  if (response.ok) await refreshMatchesSoon(session.userId);
  return response;
});

/** Edit a goal: success definition, horizon, intensity, or pause / resume / achieved / dropped. */
export const PATCH = withErrorCapture("/api/goals", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`goals:write:${session.userId}`, 60, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, updateGoalSchema);
  if ("error" in body) return body.error;
  const goal = await updateGoal(session.userId, body.data);
  if (!goal) return jsonError("We couldn't find that goal.", 404);
  if (body.data.status) await trackEvent(session.userId, `goal_${body.data.status}`, { goalId: goal.id });
  if (body.data.status === "active" || body.data.status === "paused" || body.data.horizonMonths || body.data.intensity) await refreshMatchesSoon(session.userId);
  const [full] = (await listGoals(session.userId)).filter((g) => g.id === goal.id);
  return ok({ goal: full ?? goal });
});
