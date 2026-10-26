import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getSubGoal, subGoalLabel } from "@/lib/core/goals";
import { buildMilestones } from "@/lib/core/playbooks";
import { POST_SUBMISSION_STATUSES } from "@/lib/core/state-machine";
import { familyOfSubGoal, goalConstraintsSchema, goalFamilySchema, goalStatusSchema, intensitySchema, subGoalIdSchema, type Intensity, type Profile } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications, goals, milestones, type GoalRow, type MilestoneRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { getProfile, profileOf } from "./store";
import { retimeDefinition } from "./success-params";

/*
 * Goals and their milestones (plan §6). A goal is one sub-goal with a success definition
 * (outcome + deadline + measurable), a horizon and an intensity; its milestones come from the
 * goal family's playbook. Setting the same sub-goal again updates it instead of duplicating.
 */

export const HORIZONS = [3, 6, 12] as const;

export const goalInputSchema = z
  .object({
    family: goalFamilySchema,
    sub: subGoalIdSchema,
    successDefinition: z.string().trim().min(3).max(300),
    templateId: z.string().max(24).nullable().optional(),
    horizonMonths: z.number().int().min(1).max(36),
    intensity: intensitySchema,
  })
  .refine((g) => familyOfSubGoal(g.sub) === g.family, { message: "That sub-goal belongs to another goal." });
export type GoalInput = z.infer<typeof goalInputSchema>;

export const createGoalsSchema = z.object({
  goals: z.array(goalInputSchema).min(1).max(4),
  locale: z.enum(["en", "zh"]).optional(),
});

export const updateGoalSchema = z.object({
  id: z.string().min(1).max(64),
  status: goalStatusSchema.optional(),
  successDefinition: z.string().trim().min(3).max(300).optional(),
  horizonMonths: z.number().int().min(1).max(36).optional(),
  intensity: intensitySchema.optional(),
  locale: z.enum(["en", "zh"]).optional(),
});
export type GoalUpdate = z.infer<typeof updateGoalSchema>;

export interface GoalWithMilestones extends GoalRow {
  milestones: (MilestoneRow & { progress: number })[];
}

function constraintsFor(profile: Profile | null, intensity: Intensity) {
  const j = profile?.packs.jobSeeker;
  return goalConstraintsSchema.parse({
    intensity,
    remote: j?.remote ?? null,
    salaryMin: j?.salaryMin ?? null,
    currency: j?.currency ?? null,
    geo: j?.locations ?? [],
    startBy: j?.availableFrom ?? null,
  });
}

/** Creates the goals (or updates the matching active ones) with their playbook milestones. */
export async function saveGoals(ownerId: string, inputs: readonly GoalInput[], locale: "en" | "zh" = "en"): Promise<{ goals: GoalRow[]; created: number }> {
  const profileRow = await getProfile(ownerId);
  const profile = profileRow ? profileOf(profileRow) : null;
  const existing = await db.select().from(goals).where(and(eq(goals.userId, ownerId), inArray(goals.status, ["active", "paused"])));
  const out: GoalRow[] = [];
  let created = 0;
  for (const g of inputs) {
    getSubGoal(g.sub); // throws on an unknown id (already validated by zod)
    const same = existing.find((e) => e.family === g.family && e.sub === g.sub);
    if (same) {
      const rows = await db
        .update(goals)
        // Remote, salary, places and start date come from the profile as it is now (onboarding may have just changed them).
        .set({ successDefinition: g.successDefinition, horizonMonths: g.horizonMonths, constraints: { ...same.constraints, ...constraintsFor(profile, g.intensity) }, status: "active", updatedAt: sql`now()` })
        .where(and(eq(goals.id, same.id), eq(goals.userId, ownerId)))
        .returning();
      if (rows[0]) {
        out.push(rows[0]);
        await rebuildMilestones(rows[0], locale);
      }
      continue;
    }
    const id = newId("gol");
    const rows = await db
      .insert(goals)
      .values({ id, userId: ownerId, family: g.family, sub: g.sub, label: subGoalLabel(g.sub, locale), successDefinition: g.successDefinition, horizonMonths: g.horizonMonths, constraints: constraintsFor(profile, g.intensity), status: "active" })
      .returning();
    const goal = rows[0]!;
    const planned = buildMilestones(g.family, { intensity: g.intensity, horizonMonths: g.horizonMonths });
    if (planned.length) {
      await db.insert(milestones).values(
        planned.map((m) => ({ id: newId("mil"), goalId: id, userId: ownerId, title: locale === "zh" ? m.title.zh : m.title.en, metric: m.metric, target: m.target, dueAt: m.dueAt, position: m.position })),
      );
    }
    out.push(goal);
    created++;
  }
  return { goals: out, created };
}

/** Re-plans the open milestones after the horizon or intensity changed. */
async function rebuildMilestones(goal: GoalRow, locale: "en" | "zh"): Promise<void> {
  const intensity = goal.constraints.intensity ?? "steady";
  const planned = buildMilestones(goal.family, { intensity, horizonMonths: goal.horizonMonths, start: new Date(goal.createdAt) });
  const current = await db.select().from(milestones).where(eq(milestones.goalId, goal.id));
  for (const m of planned) {
    const row = current.find((c) => c.position === m.position);
    const title = locale === "zh" ? m.title.zh : m.title.en;
    if (!row) {
      await db.insert(milestones).values({ id: newId("mil"), goalId: goal.id, userId: goal.userId, title, metric: m.metric, target: m.target, dueAt: m.dueAt, position: m.position });
    } else if (row.status === "open") {
      await db.update(milestones).set({ title, target: m.target, dueAt: m.dueAt, updatedAt: sql`now()` }).where(and(eq(milestones.id, row.id), eq(milestones.userId, goal.userId)));
    }
  }
}

export async function updateGoal(ownerId: string, patch: GoalUpdate): Promise<GoalRow | null> {
  const found = (await db.select().from(goals).where(and(eq(goals.id, patch.id), eq(goals.userId, ownerId))).limit(1))[0];
  if (!found) return null;
  const constraints = patch.intensity ? { ...found.constraints, intensity: patch.intensity } : found.constraints;
  const rows = await db
    .update(goals)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.successDefinition
        ? { successDefinition: patch.successDefinition }
        : patch.horizonMonths && found.successDefinition
          ? { successDefinition: retimeDefinition(found.successDefinition, patch.horizonMonths) }
          : {}),
      ...(patch.horizonMonths ? { horizonMonths: patch.horizonMonths } : {}),
      constraints,
      updatedAt: sql`now()`,
    })
    .where(and(eq(goals.id, patch.id), eq(goals.userId, ownerId)))
    .returning();
  const goal = rows[0] ?? null;
  if (goal && (patch.horizonMonths || patch.intensity)) await rebuildMilestones(goal, patch.locale ?? "en");
  return goal;
}

/** Applications submitted per goal (live progress for "applications" milestones). */
async function submittedByGoal(ownerId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ goalId: applications.goalId, n: count() })
    .from(applications)
    .where(and(eq(applications.userId, ownerId), eq(applications.practice, false), inArray(applications.status, [...POST_SUBMISSION_STATUSES])))
    .groupBy(applications.goalId);
  return new Map(rows.filter((r) => r.goalId).map((r) => [r.goalId!, Number(r.n)]));
}

/** Every goal with its milestones; active goals first. */
export async function listGoals(ownerId: string, opts: { onlyActive?: boolean } = {}): Promise<GoalWithMilestones[]> {
  const where = opts.onlyActive ? and(eq(goals.userId, ownerId), eq(goals.status, "active")) : eq(goals.userId, ownerId);
  const rows = await db.select().from(goals).where(where).orderBy(sql`case ${goals.status} when 'active' then 0 when 'paused' then 1 when 'achieved' then 2 else 3 end`, desc(goals.updatedAt));
  if (!rows.length) return [];
  const [ms, submitted] = await Promise.all([
    db
      .select()
      .from(milestones)
      .where(and(eq(milestones.userId, ownerId), inArray(milestones.goalId, rows.map((r) => r.id))))
      .orderBy(asc(milestones.position)),
    submittedByGoal(ownerId).catch(() => new Map<string, number>()),
  ]);
  return rows.map((g) => ({
    ...g,
    milestones: ms
      .filter((m) => m.goalId === g.id)
      .map((m) => ({ ...m, progress: m.metric === "applications" ? Math.max(m.current, submitted.get(g.id) ?? 0) : m.current })),
  }));
}
