/**
 * Identity × goal default matrix (plan §5). `primary` (●) goal families show on the first
 * screen, `more` (○) fold under "More goals", `null` is hidden but still searchable.
 * G12 (custom) is not in the plan's table; it is always offered under "More goals".
 * The supply side (I) pursues no goals: it publishes opportunities (phase 2).
 */
import { getSubGoal, subGoalAppliesTo, subGoalsOf, type SubGoalDef } from "./goals";
import { GOAL_FAMILIES, IDENTITY_GROUPS, groupOfIdentity, type GoalFamily, type IdentityCode, type IdentityGroup } from "./types";

export type MatrixCell = "primary" | "more" | null;

const P = "primary" as const;
const M = "more" as const;
const _ = null;

/** Rows: identity group. Columns: G1 … G12. */
export const GOAL_MATRIX: Readonly<Record<IdentityGroup, Readonly<Record<GoalFamily, MatrixCell>>>> = {
  //      G1 job  G2 grow G3 start G4 acad G5 study G6 create G7 brand G8 funds G9 global G10 network G11 impact G12 custom
  S: row([P, M, M, M, P, M, M, P, M, P, M, M]),
  E: row([P, P, M, _, M, M, P, M, M, P, M, M]),
  F: row([M, M, P, M, _, M, P, M, P, P, M, M]),
  R: row([M, M, M, P, M, _, P, P, M, P, M, M]),
  C: row([M, M, M, _, _, P, P, P, M, P, M, M]),
  P: row([P, P, M, M, M, _, P, M, M, P, M, M]),
  T: row([P, P, M, _, M, M, M, P, P, P, M, M]),
  I: row([_, _, _, _, _, _, _, _, _, _, _, _]),
};

function row(cells: MatrixCell[]): Record<GoalFamily, MatrixCell> {
  if (cells.length !== GOAL_FAMILIES.length) throw new Error("matrix row must have 12 cells");
  return Object.fromEntries(GOAL_FAMILIES.map((f, i) => [f, cells[i]])) as Record<GoalFamily, MatrixCell>;
}

export function matrixCell(group: IdentityGroup, family: GoalFamily): MatrixCell {
  return GOAL_MATRIX[group][family];
}

export interface DefaultGoals {
  /** Shown on the first screen. */
  primary: GoalFamily[];
  /** Folded under "More goals". */
  more: GoalFamily[];
  /** Hidden, reachable through search. */
  hidden: GoalFamily[];
}

/**
 * Default goal families for a person holding several identity codes: a family is primary when
 * any of their groups marks it primary, "more" when any marks it more. With no identity yet,
 * everything sits under "more" so nothing is hidden.
 */
export function defaultGoalsFor(codes: readonly IdentityCode[]): DefaultGoals {
  const groups = IDENTITY_GROUPS.filter((g) => codes.some((c) => groupOfIdentity(c) === g));
  if (!groups.length) return { primary: [], more: [...GOAL_FAMILIES], hidden: [] };
  const primary: GoalFamily[] = [];
  const more: GoalFamily[] = [];
  const hidden: GoalFamily[] = [];
  for (const family of GOAL_FAMILIES) {
    const cells = groups.map((g) => GOAL_MATRIX[g][family]);
    if (cells.includes("primary")) primary.push(family);
    else if (cells.includes("more")) more.push(family);
    else hidden.push(family);
  }
  return { primary, more, hidden };
}

/**
 * Sub-goals to pre-select on the goals screen: those in the person's primary families whose
 * audience includes them (and that a minor can act on).
 */
export function defaultSubGoalsFor(codes: readonly IdentityCode[]): SubGoalDef[] {
  const { primary } = defaultGoalsFor(codes);
  return primary.flatMap((family) => subGoalsOf(family).filter((s) => subGoalAppliesTo(s.id, codes)));
}

/** Where a sub-goal sits for this person: primary, more or hidden (null). */
export function subGoalPlacement(subGoalId: Parameters<typeof getSubGoal>[0], codes: readonly IdentityCode[]): MatrixCell {
  const sub = getSubGoal(subGoalId);
  if (!subGoalAppliesTo(sub.id, codes)) return null;
  const { primary, more } = defaultGoalsFor(codes);
  if (primary.includes(sub.family)) return "primary";
  if (more.includes(sub.family)) return "more";
  return null;
}
