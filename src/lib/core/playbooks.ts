/**
 * Playbooks (plan §6): the default strategy of each goal family — which opportunity types come
 * first, how many new applications or emails the scout prepares per week at each intensity,
 * when it follows up, which milestones break the success definition down, and when to switch
 * strategy (e.g. investor reply rate under 5% after 30 emails → accelerators first).
 * The person can override types and intensity per goal (`goals.constraints`).
 */
import { z } from "zod";
import { bi, bilingualSchema, type Bilingual } from "./labels";
import { opportunityTypesOfFamily } from "./goals";
import {
  GOAL_FAMILIES,
  goalFamilySchema,
  milestoneMetricSchema,
  opportunityTypeIdSchema,
  subGoalIdSchema,
  type GoalConstraints,
  type GoalFamily,
  type Intensity,
  type MilestoneMetric,
  type OpportunityTypeId,
  type SubGoalId,
} from "./types";

/* ------------------------------------------------------------------ types */

/**
 * How a milestone target is computed:
 * - constant: always `value`;
 * - byIntensity: a fixed number per intensity;
 * - quota: weekly quota × (horizon weeks × `weeksFraction`) × `ratio`, clamped to [min, max].
 */
export type TargetFormula =
  | { kind: "constant"; value: number }
  | { kind: "byIntensity"; light: number; steady: number; intense: number }
  | { kind: "quota"; weeksFraction: number; ratio: number; min?: number; max?: number };

export interface MilestoneTemplate {
  key: string;
  /** May contain `{target}`. */
  title: Bilingual;
  metric: MilestoneMetric;
  target: TargetFormula;
  /** Due date as a fraction of the goal horizon (0–1]. */
  dueAt: number;
}

export const COUNT_METRICS = ["sent", "submitted", "actions", "replies", "interviews", "meetings", "offers", "rejections"] as const;
export type CountMetric = (typeof COUNT_METRICS)[number];
export const RATE_METRICS = ["replyRate", "interviewRate", "meetingRate", "acceptRate", "offerRate"] as const;
export type RateMetric = (typeof RATE_METRICS)[number];

export interface SwitchRule {
  id: string;
  when: {
    metric: RateMetric | CountMetric;
    op: "lt" | "lte" | "gt" | "gte";
    value: number;
    /** Only judged once this much evidence exists (e.g. 20 submitted applications). */
    after: { metric: CountMetric; min: number };
  };
  suggest: Bilingual;
  suggestTypes: OpportunityTypeId[];
  suggestSubGoals: SubGoalId[];
}

export interface Playbook {
  family: GoalFamily;
  /** Ordered by priority. */
  opportunityTypes: OpportunityTypeId[];
  /** New applications / outreach emails prepared per week. */
  weeklyQuota: Record<Intensity, number>;
  quotaUnit: Bilingual;
  /** Cumulative days after submission when each follow-up is due ([7, 14] = day 7 and day 14). */
  followUpDays: number[];
  milestones: MilestoneTemplate[];
  switchRules: SwitchRule[];
}

const targetFormulaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("constant"), value: z.number().int().positive() }),
  z.object({ kind: z.literal("byIntensity"), light: z.number().int().positive(), steady: z.number().int().positive(), intense: z.number().int().positive() }),
  z.object({
    kind: z.literal("quota"),
    weeksFraction: z.number().positive().max(1),
    ratio: z.number().positive(),
    min: z.number().int().positive().optional(),
    max: z.number().int().positive().optional(),
  }),
]);

export const playbookSchema = z.object({
  family: goalFamilySchema,
  opportunityTypes: z.array(opportunityTypeIdSchema),
  weeklyQuota: z.object({ light: z.number().int().positive(), steady: z.number().int().positive(), intense: z.number().int().positive() }),
  quotaUnit: bilingualSchema,
  followUpDays: z.array(z.number().int().positive()),
  milestones: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_]+$/),
        title: bilingualSchema,
        metric: milestoneMetricSchema,
        target: targetFormulaSchema,
        dueAt: z.number().positive().max(1),
      }),
    )
    .min(3)
    .max(6),
  switchRules: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      when: z.object({
        metric: z.enum([...RATE_METRICS, ...COUNT_METRICS]),
        op: z.enum(["lt", "lte", "gt", "gte"]),
        value: z.number().nonnegative(),
        after: z.object({ metric: z.enum(COUNT_METRICS), min: z.number().int().positive() }),
      }),
      suggest: bilingualSchema,
      suggestTypes: z.array(opportunityTypeIdSchema),
      suggestSubGoals: z.array(subGoalIdSchema),
    }),
  ),
});

/* ------------------------------------------------------------------ data */

const ms = (key: string, en: string, zh: string, metric: MilestoneMetric, target: TargetFormula, dueAt: number): MilestoneTemplate => ({
  key,
  title: bi(en, zh),
  metric,
  target,
  dueAt,
});
const constant = (value: number): TargetFormula => ({ kind: "constant", value });
const byIntensity = (light: number, steady: number, intense: number): TargetFormula => ({ kind: "byIntensity", light, steady, intense });
const quota = (weeksFraction: number, ratio = 1, min?: number, max?: number): TargetFormula => ({ kind: "quota", weeksFraction, ratio, min, max });
const rule = (
  id: string,
  metric: RateMetric | CountMetric,
  op: SwitchRule["when"]["op"],
  value: number,
  after: [CountMetric, number],
  en: string,
  zh: string,
  suggestTypes: OpportunityTypeId[] = [],
  suggestSubGoals: SubGoalId[] = [],
): SwitchRule => ({ id, when: { metric, op, value, after: { metric: after[0], min: after[1] } }, suggest: bi(en, zh), suggestTypes, suggestSubGoals });

const APPLICATIONS = bi("applications", "份申请");

export const PLAYBOOKS: readonly Playbook[] = [
  {
    family: "G1",
    opportunityTypes: ["job", "remote_job", "internship", "graduate_program", "referral", "recruiter", "returnship", "public_sector_exam", "part_time", "freelance_project"],
    weeklyQuota: { light: 5, steady: 10, intense: 20 },
    quotaUnit: APPLICATIONS,
    followUpDays: [7, 14],
    milestones: [
      ms("materials", "Résumé and portfolio ready", "简历与作品集就绪", "custom", constant(1), 0.1),
      ms("applications", "Apply to {target} high-match roles", "投递 {target} 个高匹配岗位", "applications", quota(0.5), 0.5),
      ms("interviews", "Reach {target} interviews", "累计获得 {target} 次面试", "interviews", byIntensity(2, 4, 6), 0.75),
      ms("offer", "Receive an offer and negotiate it", "拿到 offer 并完成谈判", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g1-low-reply", "replyRate", "lt", 0.05, ["submitted", 20],
        "Fewer than 1 in 20 applications got a reply. Focus on roles where you match 80% or more, ask for referrals, and sharpen the top of your résumé.",
        "投递 20 份后回复率低于 5%。建议只投匹配度 80% 以上的岗位，同时争取内推，并优化简历开头的定位。",
        ["referral", "recruiter"], ["G1.5", "G1.6"]),
      rule("g1-no-interviews", "interviewRate", "lt", 0.03, ["submitted", 30],
        "Thirty applications and almost no interviews: add headhunters, and programs that hire in cohorts (campus or returnship).",
        "投递 30 份几乎没有面试：建议加上猎头渠道，以及按批次招人的校招或重返职场项目。",
        ["recruiter", "graduate_program", "returnship"], ["G1.6", "G1.3", "G1.9"]),
      rule("g1-interviews-no-offer", "offerRate", "lt", 0.1, ["interviews", 6],
        "Six interviews without an offer: practise with prep cards built from each role's requirements before the next round.",
        "已面试 6 次仍未拿到 offer：下一轮前，建议用按岗位要求生成的面试准备卡进行练习。"),
    ],
  },
  {
    family: "G2",
    opportunityTypes: ["internal_role", "certification", "course", "mentorship", "speaking", "award", "community", "job", "internship"],
    weeklyQuota: { light: 1, steady: 2, intense: 4 },
    quotaUnit: APPLICATIONS,
    followUpDays: [10],
    milestones: [
      ms("materials", "Performance record and materials ready", "业绩档案与材料就绪", "custom", constant(1), 0.15),
      ms("applications", "Apply to {target} growth opportunities", "申请 {target} 个成长机会", "applications", quota(0.6, 1, 2), 0.6),
      ms("acceptances", "Secure {target} seats, talks or awards", "获得 {target} 个录取、演讲或奖项", "offers", byIntensity(1, 2, 3), 0.85),
      ms("outcome", "Reach the result you defined", "达成你定义的结果", "custom", constant(1), 1),
    ],
    switchRules: [
      rule("g2-low-accept", "acceptRate", "lt", 0.1, ["submitted", 8],
        "Few acceptances so far: start with smaller meetups, internal talks and regional awards to build a track record.",
        "目前录取较少：建议先从小型 Meetup、内部分享和地区性奖项做起，积累履历。",
        ["community", "mentorship"], ["G2.7", "G2.6"]),
    ],
  },
  {
    family: "G3",
    opportunityTypes: [
      "investor", "accelerator", "incubator", "startup_competition", "pitch_event", "government_program", "grant", "exhibition",
      "client_lead", "media", "podcast", "award", "cofounder_match", "community", "crowdfunding", "hiring_channel", "service_provider", "loan",
    ],
    weeklyQuota: { light: 5, steady: 15, intense: 30 },
    quotaUnit: bi("investor emails and applications", "封投资人邮件与申请"),
    followUpDays: [5, 12],
    milestones: [
      ms("materials", "One-pager and deck ready", "一页纸与 deck 就绪", "custom", constant(1), 0.1),
      ms("outreach", "Reach {target} matched investors", "触达 {target} 位匹配的投资人", "applications", byIntensity(25, 50, 100), 0.45),
      ms("meetings", "Hold {target} investor meetings", "完成 {target} 场投资人会议", "meetings", byIntensity(5, 10, 20), 0.75),
      ms("term_sheet", "Receive a term sheet", "拿到 term sheet", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g3-low-investor-reply", "replyRate", "lt", 0.05, ["sent", 30],
        "Investor reply rate is under 5%. Apply to accelerators and competitions first to earn validation, then return to investors.",
        "投资人回复率低于 5%。建议先申请加速器和创业比赛拿到背书，再继续接触投资人。",
        ["accelerator", "startup_competition"], ["G3.4", "G3.5"]),
      rule("g3-low-meetings", "meetingRate", "lt", 0.03, ["sent", 40],
        "Emails are not turning into meetings. Target investors who led rounds at your stage in the last 12 months, and open with traction.",
        "邮件没有转化为会议。建议只联系过去 12 个月在你这个阶段领投过的投资人，并在开头突出牵引数据。"),
      rule("g3-meetings-no-term-sheet", "offerRate", "lt", 0.05, ["meetings", 15],
        "Fifteen meetings without a term sheet: revisit the round size and terms, and use grants or government programs to extend your runway.",
        "已开 15 场会仍未拿到 term sheet：建议重新评估本轮金额与条款，并用资助或政府项目延长现金流。",
        ["government_program", "grant"], ["G3.3"]),
    ],
  },
  {
    family: "G4",
    opportunityTypes: ["conference_cfp", "journal", "grant", "phd_position", "postdoc", "visiting_scholar", "exchange_program", "collaborator", "speaking", "editorial_role", "award", "industry_partnership"],
    weeklyQuota: { light: 1, steady: 3, intense: 6 },
    quotaUnit: bi("submissions and applications", "次投稿与申请"),
    followUpDays: [14, 28],
    milestones: [
      ms("materials", "Academic CV and research statement ready", "学术简历与研究陈述就绪", "custom", constant(1), 0.1),
      ms("submissions", "Make {target} submissions or applications", "完成 {target} 次投稿或申请", "applications", quota(0.6, 1, 2, 30), 0.6),
      ms("acceptances", "Get {target} acceptances or interviews", "获得 {target} 个录用或面试", "interviews", byIntensity(1, 2, 3), 0.85),
      ms("outcome", "Reach the result you defined", "达成你定义的成果", "custom", constant(1), 1),
    ],
    switchRules: [
      rule("g4-rejections", "acceptRate", "lt", 0.15, ["submitted", 5],
        "Several rejections in a row: while you revise with the reviews, add workshops and journals one tier down.",
        "连续被拒：在根据审稿意见修改的同时，建议加投 workshop 和低一档的期刊。",
        ["journal", "conference_cfp"], ["G4.2", "G4.1"]),
      rule("g4-cold-emails", "replyRate", "lt", 0.1, ["sent", 15],
        "Supervisors are not replying: widen to labs with recent funding and mention one specific paper of theirs in each email.",
        "导师回复较少：建议扩大到近期有经费的课题组，并在每封邮件里提到对方的一篇具体论文。",
        ["phd_position", "postdoc"], ["G4.4"]),
    ],
  },
  {
    family: "G5",
    opportunityTypes: ["degree_program", "scholarship", "exchange_program", "standardized_test", "visa_pathway"],
    weeklyQuota: { light: 1, steady: 2, intense: 4 },
    quotaUnit: APPLICATIONS,
    followUpDays: [14],
    milestones: [
      ms("tests", "Tests booked and scores in hand", "考试已报名并拿到成绩", "custom", constant(1), 0.2),
      ms("materials", "Essays, CV and recommendations ready", "文书、简历与推荐信就绪", "custom", constant(1), 0.4),
      ms("applications", "Submit {target} applications", "提交 {target} 份申请", "applications", byIntensity(4, 8, 12), 0.7),
      ms("admission", "Receive an admission offer", "拿到录取", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g5-rejections", "acceptRate", "lt", 0.25, ["submitted", 4],
        "Early decisions were mostly negative: add safer programs and options that come with scholarships.",
        "早期结果不理想：建议增加更稳妥的项目，以及带奖学金的选择。",
        ["degree_program", "scholarship"], ["G5.1", "G5.2"]),
    ],
  },
  {
    family: "G6",
    opportunityTypes: ["freelance_project", "client_lead", "brand_partnership", "residency", "grant", "award", "platform_signing", "open_call", "competition", "licensing"],
    weeklyQuota: { light: 5, steady: 10, intense: 20 },
    quotaUnit: bi("pitches and proposals", "份提案"),
    followUpDays: [5, 12],
    milestones: [
      ms("materials", "Portfolio and media kit ready", "作品集与媒体资料包就绪", "custom", constant(1), 0.1),
      ms("pitches", "Send {target} tailored pitches or proposals", "发出 {target} 份定制提案", "applications", quota(0.5), 0.5),
      ms("projects", "Land {target} paid projects", "拿下 {target} 个付费项目", "offers", byIntensity(1, 2, 4), 0.8),
      ms("income", "Reach a steady monthly income", "达到稳定的月收入", "custom", constant(1), 1),
    ],
    switchRules: [
      rule("g6-low-reply", "replyRate", "lt", 0.05, ["actions", 25],
        "Pitches are not landing: focus on one niche, refresh the first three pieces of your portfolio, and follow up once.",
        "提案反馈少：建议聚焦一个细分方向，更新作品集前三件作品，并跟进一次。"),
      rule("g6-no-paid-work", "acceptRate", "lt", 0.05, ["submitted", 20],
        "No paid work from platforms yet: add direct client outreach and brand programs alongside.",
        "平台上暂未接到付费项目：建议同时尝试直客外联和品牌合作计划。",
        ["client_lead", "brand_partnership"], ["G6.2", "G6.3"]),
    ],
  },
  {
    family: "G7",
    opportunityTypes: ["speaking", "media", "podcast", "book_publisher", "award"],
    weeklyQuota: { light: 2, steady: 4, intense: 8 },
    quotaUnit: bi("pitches", "份投递"),
    followUpDays: [7, 14],
    milestones: [
      ms("materials", "Bio and talk abstract ready", "个人简介与演讲摘要就绪", "custom", constant(1), 0.1),
      ms("pitches", "Pitch {target} stages, publications or shows", "向 {target} 个舞台、媒体或节目投递", "applications", quota(0.6), 0.6),
      ms("appearances", "Secure {target} appearances", "获得 {target} 次亮相机会", "offers", byIntensity(1, 3, 5), 1),
    ],
    switchRules: [
      rule("g7-low-accept", "acceptRate", "lt", 0.1, ["submitted", 10],
        "Few acceptances: start with podcasts and local meetups to collect recordings and references.",
        "录取较少：建议先从播客和本地 Meetup 开始，积累演讲录像与推荐。",
        ["podcast", "community"], ["G7.3", "G10.1"]),
    ],
  },
  {
    family: "G8",
    opportunityTypes: ["fellowship", "grant", "competition", "hackathon", "government_program"],
    weeklyQuota: { light: 1, steady: 3, intense: 5 },
    quotaUnit: APPLICATIONS,
    followUpDays: [14],
    milestones: [
      ms("materials", "Statements and references ready", "陈述与推荐材料就绪", "custom", constant(1), 0.15),
      ms("applications", "Apply to {target} funding programs", "申请 {target} 个资助项目", "applications", quota(0.6, 1, 3), 0.6),
      ms("award", "Win {target} award", "获得 {target} 笔资助", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g8-low-accept", "acceptRate", "lt", 0.1, ["submitted", 8],
        "Funding is competitive: favour smaller and local grants with fewer applicants.",
        "资助竞争激烈：建议优先申请申请人较少的小额与本地项目。",
        ["grant", "competition"], ["G8.4", "G8.3"]),
    ],
  },
  {
    family: "G9",
    opportunityTypes: ["visa_pathway", "government_program", "exhibition", "pitch_event", "accelerator"],
    weeklyQuota: { light: 1, steady: 2, intense: 3 },
    quotaUnit: bi("steps", "项行动"),
    followUpDays: [7, 14],
    milestones: [
      ms("evidence", "Evidence checklist complete", "证据清单齐备", "custom", constant(1), 0.3),
      ms("consultations", "Consult {target} immigration lawyers or program officers", "咨询 {target} 位移民律师或项目方", "meetings", byIntensity(1, 2, 3), 0.5),
      ms("filed", "Application filed", "申请已递交", "applications", constant(1), 0.8),
      ms("approved", "Approval received", "获得批准", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g9-stalled", "replyRate", "lt", 0.2, ["sent", 5],
        "Little response from lawyers or programs: book a paid consultation, which usually gets an answer within a week.",
        "律师或项目方回复较少：建议预约付费咨询，通常一周内会有答复。"),
    ],
  },
  {
    family: "G10",
    opportunityTypes: ["community", "event", "mentorship"],
    weeklyQuota: { light: 1, steady: 2, intense: 4 },
    quotaUnit: APPLICATIONS,
    followUpDays: [7],
    milestones: [
      ms("bio", "Short bio ready", "个人简介就绪", "custom", constant(1), 0.1),
      ms("communities", "Join {target} communities", "加入 {target} 个社群或协会", "applications", byIntensity(1, 2, 4), 0.5),
      ms("events", "Attend {target} events", "参加 {target} 场活动", "meetings", quota(0.5, 0.5, 1), 0.8),
      ms("mentors", "Have {target} mentor conversations", "完成 {target} 次导师交流", "meetings", byIntensity(1, 3, 6), 1),
    ],
    switchRules: [
      rule("g10-low-reply", "replyRate", "lt", 0.1, ["actions", 10],
        "Community applications are not getting answers: attend one open event first, then apply.",
        "社群申请回复少：建议先参加一次公开活动，再提交申请。",
        ["event"], ["G10.2"]),
    ],
  },
  {
    family: "G11",
    opportunityTypes: ["volunteer", "ngo_job", "startup_competition", "competition", "grant"],
    weeklyQuota: { light: 1, steady: 3, intense: 5 },
    quotaUnit: APPLICATIONS,
    followUpDays: [10],
    milestones: [
      ms("materials", "Résumé and bio for impact roles ready", "公益方向的简历与简介就绪", "custom", constant(1), 0.15),
      ms("applications", "Apply to {target} programs or roles", "申请 {target} 个项目或岗位", "applications", quota(0.6), 0.6),
      ms("acceptance", "Get {target} acceptance", "获得 {target} 个录取或录用", "offers", constant(1), 1),
    ],
    switchRules: [
      rule("g11-low-accept", "acceptRate", "lt", 0.1, ["submitted", 10],
        "Start with volunteer roles: they are often the way into staff positions.",
        "建议先从志愿者岗位做起，这往往是进入正式岗位的路径。",
        ["volunteer"], ["G11.1"]),
    ],
  },
  {
    family: "G12",
    opportunityTypes: [],
    weeklyQuota: { light: 2, steady: 4, intense: 8 },
    quotaUnit: bi("actions", "次行动"),
    followUpDays: [7, 14],
    milestones: [
      ms("path", "Path and materials defined", "明确路径并备好材料", "custom", constant(1), 0.15),
      ms("actions", "Take {target} concrete actions", "完成 {target} 次具体行动", "applications", quota(0.6), 0.6),
      ms("first_response", "First positive response", "收到第一个积极回复", "replies", constant(1), 0.8),
      ms("outcome", "Reach the goal you defined", "达成你定义的目标", "custom", constant(1), 1),
    ],
    switchRules: [
      rule("g12-no-response", "replyRate", "lt", 0.05, ["actions", 15],
        "Little traction so far: map your goal to a closer known goal, or narrow it.",
        "目前进展不多：建议把目标映射到更接近的已有目标，或把目标收窄。"),
    ],
  },
];

/* ------------------------------------------------------------------ logic */

const BY_FAMILY = new Map<string, Playbook>(PLAYBOOKS.map((p) => [p.family, p]));

export function getPlaybook(family: GoalFamily): Playbook {
  const p = BY_FAMILY.get(family);
  if (!p) throw new Error(`No playbook for ${family}`);
  return p;
}

export const INTENSITY_LABELS: Record<Intensity, Bilingual> = {
  light: bi("Light — about 30 minutes a week", "轻量：每周约 30 分钟"),
  steady: bi("Steady — about an hour a week", "稳定：每周约 1 小时"),
  intense: bi("Intense — two hours or more a week", "冲刺：每周 2 小时以上"),
};

/** Intensity from the hours a person can give per week (unknown → steady). */
export function intensityFromTime(hoursPerWeek: number | null | undefined): Intensity {
  if (hoursPerWeek == null || !Number.isFinite(hoursPerWeek)) return "steady";
  if (hoursPerWeek <= 1) return "light";
  if (hoursPerWeek <= 3) return "steady";
  return "intense";
}

export function weeklyQuota(family: GoalFamily, intensity: Intensity): number {
  return getPlaybook(family).weeklyQuota[intensity];
}

/** At most this many picks of one opportunity type per week, so the board stays varied. */
export function typeCapPerWeek(family: GoalFamily, intensity: Intensity): number {
  return Math.max(2, Math.ceil(weeklyQuota(family, intensity) * 0.6));
}

export interface ResolvedPlaybook {
  family: GoalFamily;
  intensity: Intensity;
  opportunityTypes: OpportunityTypeId[];
  weeklyQuota: number;
  typeCap: number;
  followUpDays: number[];
}

/**
 * A goal's effective playbook: the person's type override (kept in playbook order, extra types
 * appended) and intensity (explicit, else derived from time per week).
 */
export function resolvePlaybook(family: GoalFamily, constraints?: Partial<GoalConstraints> | null): ResolvedPlaybook {
  const pb = getPlaybook(family);
  const intensity = constraints?.intensity ?? intensityFromTime(constraints?.timePerWeek ?? null);
  const override = constraints?.opportunityTypes ?? [];
  const opportunityTypes = override.length
    ? [...pb.opportunityTypes.filter((t) => override.includes(t)), ...override.filter((t) => !pb.opportunityTypes.includes(t))]
    : [...pb.opportunityTypes];
  return {
    family,
    intensity,
    opportunityTypes,
    weeklyQuota: pb.weeklyQuota[intensity],
    typeCap: typeCapPerWeek(family, intensity),
    followUpDays: [...pb.followUpDays],
  };
}

const WEEKS_PER_MONTH = 52 / 12;

export function horizonWeeks(horizonMonths: number): number {
  return Math.max(1, Math.round(horizonMonths * WEEKS_PER_MONTH));
}

export function computeMilestoneTarget(
  template: MilestoneTemplate,
  ctx: { family: GoalFamily; intensity: Intensity; horizonMonths: number },
): number {
  const t = template.target;
  if (t.kind === "constant") return t.value;
  if (t.kind === "byIntensity") return t[ctx.intensity];
  const raw = Math.round(weeklyQuota(ctx.family, ctx.intensity) * horizonWeeks(ctx.horizonMonths) * t.weeksFraction * t.ratio);
  return Math.min(t.max ?? Number.POSITIVE_INFINITY, Math.max(t.min ?? 1, raw));
}

export interface PlannedMilestone {
  key: string;
  title: Bilingual;
  metric: MilestoneMetric;
  target: number;
  dueAt: Date;
  position: number;
}

/**
 * Milestones for a new goal (rows for `milestones`): targets computed for the intensity and
 * horizon, `{target}` rendered into both titles, due dates spread over the horizon.
 */
export function buildMilestones(
  family: GoalFamily,
  opts: { intensity: Intensity; horizonMonths: number; start?: Date },
): PlannedMilestone[] {
  const start = opts.start ?? new Date();
  const horizonMs = opts.horizonMonths * (365.25 / 12) * 24 * 3600 * 1000;
  return getPlaybook(family).milestones.map((m, i) => {
    const target = computeMilestoneTarget(m, { family, intensity: opts.intensity, horizonMonths: opts.horizonMonths });
    return {
      key: m.key,
      title: { en: m.title.en.replaceAll("{target}", String(target)), zh: m.title.zh.replaceAll("{target}", String(target)) },
      metric: m.metric,
      target,
      dueAt: new Date(start.getTime() + Math.round(horizonMs * m.dueAt)),
      position: i,
    };
  });
}

/** Pipeline counts for one goal (or one person), as P2a/P3a aggregate them. */
export interface PipelineStats {
  /** Outreach emails sent (CH4). */
  sent: number;
  /** Applications submitted (any channel). */
  submitted: number;
  /** Human replies of any kind (auto-replies excluded). */
  replies: number;
  interviews: number;
  meetings: number;
  /** Positive outcomes: offers, admissions, awards, term sheets, acceptances. */
  offers: number;
  rejections: number;
}

export function pipelineRates(s: PipelineStats): Record<RateMetric, number> {
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    replyRate: ratio(s.replies, s.sent + s.submitted),
    interviewRate: ratio(s.interviews, s.submitted),
    meetingRate: ratio(s.meetings, s.sent),
    acceptRate: ratio(s.offers, s.submitted),
    offerRate: ratio(s.offers, s.interviews + s.meetings),
  };
}

function metricValue(metric: RateMetric | CountMetric, s: PipelineStats): number {
  if (metric === "actions") return s.sent + s.submitted;
  if ((RATE_METRICS as readonly string[]).includes(metric)) return pipelineRates(s)[metric as RateMetric];
  return s[metric as Exclude<CountMetric, "actions">];
}

/** Switch rules whose evidence threshold is met and whose condition holds, in playbook order. */
export function evaluateSwitchRules(family: GoalFamily, stats: PipelineStats): SwitchRule[] {
  return getPlaybook(family).switchRules.filter((r) => {
    if (metricValue(r.when.after.metric, stats) < r.when.after.min) return false;
    const v = metricValue(r.when.metric, stats);
    switch (r.when.op) {
      case "lt":
        return v < r.when.value;
      case "lte":
        return v <= r.when.value;
      case "gt":
        return v > r.when.value;
      case "gte":
        return v >= r.when.value;
    }
  });
}

/**
 * When the next follow-up is due: `followUpDays[n]` days after the previous touch (submission
 * or last follow-up). `null` once every follow-up of the playbook has been sent.
 */
export function nextFollowUpAt(family: GoalFamily, lastTouchAt: Date, followUpsSent: number): Date | null {
  const days = getPlaybook(family).followUpDays;
  if (followUpsSent < 0 || followUpsSent >= days.length) return null;
  const gap = followUpsSent === 0 ? days[0] : days[followUpsSent] - days[followUpsSent - 1];
  return new Date(lastTouchAt.getTime() + gap * 24 * 3600 * 1000);
}

/** Every family has a playbook; exported for tests and admin views. */
export function playbookCoverage(): { family: GoalFamily; types: OpportunityTypeId[]; subGoalTypes: OpportunityTypeId[] }[] {
  return GOAL_FAMILIES.map((family) => ({ family, types: getPlaybook(family).opportunityTypes, subGoalTypes: opportunityTypesOfFamily(family) }));
}
