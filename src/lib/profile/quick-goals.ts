import { subGoalAppliesTo } from "@/lib/core/goals";
import { bi, type Bilingual } from "@/lib/core/labels";
import type { GoalFamily, IdentityCode, SubGoalId } from "@/lib/core/types";
import type { LifePath } from "@/lib/llm/types";

/*
 * The directions a plan can set (src/lib/profile/directions.ts): each is a concrete sub-goal
 * with opportunities behind it in the catalog (ATS job boards and the curated programs), so the
 * first board is never empty, and each serves one or more life paths (the dashboard's compass).
 * Everything else about a goal (success definition, horizon, intensity) takes its default and
 * can be changed later on /app/goals.
 */

export interface QuickGoal {
  id: string;
  family: GoalFamily;
  sub: SubGoalId;
  label: Bilingual;
  /** One line under the label: what we will look for. */
  hint: Bilingual;
  /** Icon name in the onboarding view. */
  icon: "briefcase" | "graduation" | "rocket" | "coins" | "microscope" | "mic" | "image" | "trophy" | "compass";
  /** The life paths this direction serves (the dashboard plan picks directions of one path). */
  paths: readonly LifePath[];
}

export const QUICK_GOALS: readonly QuickGoal[] = [
  { id: "job", family: "G1", sub: "G1.1", icon: "briefcase", label: bi("A full-time job", "全职工作"), hint: bi("Open roles at companies hiring now", "正在招聘的公司职位"), paths: ["work"] },
  { id: "internship", family: "G1", sub: "G1.2", icon: "briefcase", label: bi("An internship", "实习"), hint: bi("Internships at companies hiring now", "正在招聘的实习岗位"), paths: ["work"] },
  { id: "graduate", family: "G1", sub: "G1.3", icon: "graduation", label: bi("A graduate or trainee program", "校招或管培项目"), hint: bi("Programs for students and new graduates", "面向在校生和应届生的项目"), paths: ["work"] },
  { id: "scholarship", family: "G5", sub: "G5.2", icon: "graduation", label: bi("A scholarship", "奖学金"), hint: bi("Scholarships you can apply for", "可以申请的奖学金"), paths: ["study"] },
  { id: "fellowship", family: "G8", sub: "G8.1", icon: "coins", label: bi("A fellowship", "Fellowship 项目"), hint: bi("Funded fellowships for people at your stage", "适合你所处阶段的资助型项目"), paths: ["research", "study"] },
  { id: "accelerator", family: "G3", sub: "G3.4", icon: "rocket", label: bi("An accelerator or incubator", "加速器或孵化器"), hint: bi("Programs that back startups like yours", "支持你这类创业项目的项目"), paths: ["startup"] },
  { id: "investors", family: "G3", sub: "G3.2", icon: "rocket", label: bi("Investors for my startup", "为创业项目找投资人"), hint: bi("Investors who back your stage and sector", "投你这个阶段和领域的投资人"), paths: ["startup"] },
  { id: "pitch", family: "G3", sub: "G3.5", icon: "trophy", label: bi("Startup competitions and pitch events", "创业比赛与路演"), hint: bi("Competitions with prizes, pitch days", "有奖金的比赛和路演活动"), paths: ["startup"] },
  { id: "phd", family: "G4", sub: "G4.4", icon: "microscope", label: bi("A PhD or postdoc position", "博士或博士后职位"), hint: bi("Funded PhD and postdoc openings", "有资助的博士与博士后职位"), paths: ["research", "study"] },
  { id: "grant", family: "G4", sub: "G4.3", icon: "microscope", label: bi("A research grant", "科研资助"), hint: bi("Grants that fund research like yours", "资助你这类研究的基金"), paths: ["research"] },
  { id: "cfp", family: "G4", sub: "G4.1", icon: "mic", label: bi("A conference talk or paper", "学术会议投稿"), hint: bi("Calls for papers with upcoming deadlines", "近期截稿的会议征稿"), paths: ["research"] },
  { id: "art", family: "G6", sub: "G6.4", icon: "image", label: bi("Residencies, grants and prizes for my work", "驻留、资助与奖项"), hint: bi("For artists, writers and designers", "面向艺术家、作者和设计师"), paths: ["create"] },
  { id: "hackathon", family: "G8", sub: "G8.3", icon: "trophy", label: bi("Hackathons and prize competitions", "黑客松与奖金赛"), hint: bi("Build something, win prizes", "动手做项目，赢取奖金"), paths: ["work", "startup"] },
];

/** Something not in the list: no type filter, the whole catalog ranked for the person. */
export const OTHER_GOAL: QuickGoal = {
  id: "other",
  family: "G12",
  sub: "G12.1",
  icon: "compass",
  label: bi("Something else", "其他"),
  hint: bi("Show me everything that fits", "把适合我的都给我看看"),
  paths: ["explore"],
};

/** Sub-goals whose matches are job postings: they get the target-role and remote questions. */
export function isJobGoal(sub: SubGoalId): boolean {
  return sub === "G1.1" || sub === "G1.2" || sub === "G1.3";
}

/**
 * The answers in order for this person: goals open to them first (by the sub-goal's audience),
 * the rest after; with no identity yet, the list as written. Never empty.
 */
export function quickGoalsFor(codes: readonly IdentityCode[]): { first: QuickGoal[]; more: QuickGoal[] } {
  if (!codes.length) return { first: QUICK_GOALS.slice(0, 6), more: [...QUICK_GOALS.slice(6), OTHER_GOAL] };
  const fits = QUICK_GOALS.filter((g) => subGoalAppliesTo(g.sub, codes));
  const rest = QUICK_GOALS.filter((g) => !fits.includes(g));
  const ordered = [...fits, ...rest];
  const firstCount = Math.min(6, Math.max(fits.length, 1));
  return { first: ordered.slice(0, firstCount), more: [...ordered.slice(firstCount), OTHER_GOAL] };
}

export function quickGoalById(id: string): QuickGoal | null {
  return QUICK_GOALS.find((g) => g.id === id) ?? (id === OTHER_GOAL.id ? OTHER_GOAL : null);
}
