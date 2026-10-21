/**
 * Success-definition templates (plan §6): outcome + deadline + measurable. For each sub-goal
 * the product offers three candidate sentences; the person taps one or edits a word.
 * Placeholders such as `{months}`, `{role}`, `{amount}` are filled from the profile and goal
 * constraints; missing ones fall back to neutral wording (and are reported as `missing` so the
 * UI can offer a one-tap choice). Empty defaults are qualifiers that simply disappear.
 */
import { z } from "zod";
import { bi, bilingualSchema, type Bilingual, type Locale } from "./labels";
import { SUB_GOAL_IDS, subGoalIdSchema, type SubGoalId } from "./types";

export const PLACEHOLDER_KEYS = [
  "months", "count", "role", "field", "salary", "amount", "rate", "venue", "event", "program", "degree",
  "school", "country", "city", "platform", "cert", "test", "level", "topic", "outcome", "org", "funder",
] as const;
export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

/** Neutral fallbacks. `months` and `count` are numeric and come from the template. */
export const PLACEHOLDER_DEFAULTS: Record<Exclude<PlaceholderKey, "months" | "count">, Bilingual> = {
  role: bi("", ""),
  field: bi("your field", "本领域"),
  salary: bi("your target", "目标水平"),
  amount: bi("your target amount", "目标金额"),
  rate: bi("your target amount", "目标金额"),
  venue: bi("a top venue in your field", "领域顶级会议或期刊"),
  event: bi("a major event in your field", "本领域的重要活动"),
  program: bi("a program that fits you", "合适的项目"),
  degree: bi("", ""),
  school: bi("your dream school", "梦校"),
  country: bi("your target country", "目标国家"),
  city: bi("your city", "所在城市"),
  platform: bi("your main platform", "主要平台"),
  cert: bi("your target certification", "目标证书"),
  test: bi("your target test", "目标考试"),
  level: bi("the next level", "下一个职级"),
  topic: bi("your expertise", "你的专长"),
  outcome: bi("your goal", "你的目标"),
  org: bi("an organisation you admire", "心仪单位"),
  funder: bi("a national funder", "国家级基金"),
};

/** Placeholders whose numeric values are formatted as money (with `currency` when given). */
const MONEY_KEYS = new Set<PlaceholderKey>(["salary", "amount", "rate"]);

export interface SuccessTemplate {
  id: string;
  subGoal: SubGoalId;
  text: Bilingual;
  /** Default deadline, used for `{months}` unless the caller passes `months`. */
  horizonMonths: number;
  /** Default for `{count}` when the template uses it. */
  count?: number;
}

export const successTemplateSchema = z.object({
  id: z.string().regex(/^G\d{1,2}\.\d{1,2}-[a-c]$/),
  subGoal: subGoalIdSchema,
  text: bilingualSchema,
  horizonMonths: z.number().int().min(1).max(36),
  count: z.number().int().positive().optional(),
});

type Row = [months: number, en: string, zh: string, count?: number];

const DATA: Record<SubGoalId, [Row, Row, Row]> = {
  "G1.1": [
    [6, "Get a full-time {role} offer within {months} months", "{months} 个月内拿到{role}全职 offer"],
    [6, "Get a full-time {role} offer paying at least {salary} within {months} months", "{months} 个月内拿到{role}全职 offer，base 不低于{salary}"],
    [4, "Have {count} {role} offers to compare within {months} months", "{months} 个月内拿到 {count} 个{role} offer 可供比较", 2],
  ],
  "G1.2": [
    [3, "Land a {role} internship within {months} months", "{months} 个月内拿到{role}实习"],
    [4, "Secure a summer internship at {org} within {months} months", "{months} 个月内拿到{org}的暑期实习"],
    [6, "Complete an internship that can convert to a full-time offer within {months} months", "{months} 个月内完成一段可转正的实习"],
  ],
  "G1.3": [
    [6, "Receive a campus offer this hiring season, within {months} months", "本轮校招季（{months} 个月内）拿到校招 offer"],
    [6, "Join a management-trainee program at {org} within {months} months", "{months} 个月内入选{org}的管培生项目"],
    [4, "Reach the final round at {count} campus programs within {months} months", "{months} 个月内进入 {count} 家校招的终面", 3],
  ],
  "G1.4": [
    [6, "Land a remote {role} job within {months} months", "{months} 个月内拿到{role}远程岗位"],
    [9, "Get a {role} job in {country} with visa sponsorship within {months} months", "{months} 个月内拿到{country}可办工作签证的{role}岗位"],
    [6, "Earn at least {salary} from a remote role within {months} months", "{months} 个月内通过远程工作获得不低于{salary}的收入"],
  ],
  "G1.5": [
    [3, "Get {count} referrals to roles you want within {months} months", "{months} 个月内为心仪岗位拿到 {count} 个内推", 5],
    [3, "Get referred into {org} within {months} months", "{months} 个月内拿到{org}的内推"],
    [4, "Turn {count} referrals into interviews within {months} months", "{months} 个月内把 {count} 个内推转化为面试", 3],
  ],
  "G1.6": [
    [3, "Work with {count} headhunters who place people in {field} within {months} months", "{months} 个月内与 {count} 位专注{field}的猎头建立合作", 3],
    [4, "Get {count} interviews through headhunters within {months} months", "{months} 个月内通过猎头获得 {count} 次面试", 3],
    [6, "Land a {role} offer through a headhunter within {months} months", "{months} 个月内通过猎头拿到{role} offer"],
  ],
  "G1.7": [
    [2, "Start a part-time job in {city} within {months} months", "{months} 个月内在{city}开始一份兼职"],
    [3, "Earn {amount} a month from part-time work within {months} months", "{months} 个月内每月兼职收入达到{amount}"],
    [2, "Line up {count} regular gigs within {months} months", "{months} 个月内找到 {count} 份稳定的零工", 2],
  ],
  "G1.8": [
    [12, "Pass the written exam and interview for {org} within {months} months", "{months} 个月内通过{org}的笔试和面试"],
    [12, "Secure a civil-service or public-institution post within {months} months", "{months} 个月内考上公务员或事业编"],
    [6, "Register for {count} public-sector exams that fit you within {months} months", "{months} 个月内报名 {count} 场适合你的招考", 3],
  ],
  "G1.9": [
    [6, "Join a returnship within {months} months", "{months} 个月内入选一个重返职场计划"],
    [9, "Return to a {role} role within {months} months", "{months} 个月内重返{role}岗位"],
    [12, "Turn a returnship into a permanent role within {months} months", "{months} 个月内把重返职场项目转为正式岗位"],
  ],
  "G1.10": [
    [6, "Land a {role} job with an employer that provides the support you need within {months} months", "{months} 个月内在能提供所需支持的单位拿到{role}岗位"],
    [6, "Join a disability employment program within {months} months", "{months} 个月内加入一个残障就业专项项目"],
    [4, "Get {count} interviews with inclusive employers within {months} months", "{months} 个月内获得 {count} 次包容性雇主的面试", 3],
  ],

  "G2.1": [
    [6, "Get promoted to {level} within {months} months", "{months} 个月内晋升到{level}"],
    [6, "Get a raise of at least {amount} within {months} months", "{months} 个月内加薪不低于{amount}"],
    [12, "Get promoted with a pay increase within {months} months", "{months} 个月内获得晋升并同步加薪"],
  ],
  "G2.2": [
    [6, "Move to a {role} role inside your company within {months} months", "{months} 个月内在公司内部转到{role}岗位"],
    [3, "Get your transfer request approved within {months} months", "{months} 个月内获批转岗申请"],
    [6, "Join the team you want internally within {months} months", "{months} 个月内转入你想去的团队"],
  ],
  "G2.3": [
    [9, "Move into a {role} role in {field} within {months} months", "{months} 个月内转行进入{field}，拿到{role}岗位"],
    [6, "Finish a bridge course and land a first {role} role within {months} months", "{months} 个月内完成衔接课程，拿到第一份{role}工作"],
    [6, "Get {count} interviews in {field} within {months} months", "{months} 个月内获得 {count} 次{field}岗位的面试", 5],
  ],
  "G2.4": [
    [6, "Pass {cert} within {months} months", "{months} 个月内通过{cert}"],
    [3, "Register and book the exam for {cert} within {months} months", "{months} 个月内完成{cert}报名并约好考试"],
    [12, "Earn {count} professional certifications within {months} months", "{months} 个月内拿到 {count} 个职业证书", 2],
  ],
  "G2.5": [
    [3, "Get a seat in {program} within {months} months", "{months} 个月内获得{program}的名额"],
    [3, "Win a scholarship or funded seat on a course within {months} months", "{months} 个月内获得课程奖学金或资助名额"],
    [6, "Complete a course in {field} within {months} months", "{months} 个月内完成一门{field}课程"],
  ],
  "G2.6": [
    [3, "Be matched with a mentor in {field} within {months} months", "{months} 个月内匹配到一位{field}的导师"],
    [6, "Complete a mentorship program within {months} months", "{months} 个月内完成一期导师计划"],
    [3, "Have {count} mentor sessions within {months} months", "{months} 个月内完成 {count} 次导师交流", 6],
  ],
  "G2.7": [
    [3, "Join {count} professional associations in {field} within {months} months", "{months} 个月内加入 {count} 个{field}的行业协会", 2],
    [6, "Become an active member of {org} within {months} months", "{months} 个月内成为{org}的活跃会员"],
    [12, "Take on a volunteer role in a professional association within {months} months", "{months} 个月内在行业协会担任一个志愿职务"],
  ],
  "G2.8": [
    [6, "Speak at {count} conferences or meetups within {months} months", "{months} 个月内在 {count} 场会议或 Meetup 上演讲", 3],
    [12, "Give a talk at {event} within {months} months", "{months} 个月内在{event}上做一次演讲"],
    [6, "Get a talk about {topic} accepted within {months} months", "{months} 个月内有一场关于{topic}的演讲被录用"],
  ],
  "G2.9": [
    [12, "Be shortlisted for an industry award within {months} months", "{months} 个月内入围一个行业奖项"],
    [12, "Win an industry award or make a recognised list within {months} months", "{months} 个月内获得行业奖项或登上知名榜单"],
    [9, "Be nominated for {count} awards or lists within {months} months", "{months} 个月内获得 {count} 个奖项或榜单的提名", 3],
  ],

  "G3.1": [
    [3, "Find a co-founder you trust within {months} months", "{months} 个月内找到一位信得过的合伙人"],
    [6, "Find a technical co-founder within {months} months", "{months} 个月内找到技术合伙人"],
    [3, "Meet {count} candidate co-founders within {months} months", "{months} 个月内见 {count} 位合伙人候选人", 10],
  ],
  "G3.2": [
    [12, "Close a seed round of at least {amount} within {months} months", "{months} 个月内完成种子轮，金额不低于{amount}"],
    [9, "Raise {amount} from angels and funds within {months} months", "{months} 个月内从天使投资人和机构融到{amount}"],
    [6, "Receive a term sheet within {months} months", "{months} 个月内拿到 term sheet"],
  ],
  "G3.3": [
    [12, "Win a government grant or subsidy of {amount} within {months} months", "{months} 个月内获得{amount}的政府资助或补贴"],
    [12, "Obtain a high-tech or specialised-SME certification within {months} months", "{months} 个月内获得高新技术企业或专精特新资质"],
    [9, "Be selected for a talent or startup program in {city} within {months} months", "{months} 个月内入选{city}的人才计划或创业扶持项目"],
  ],
  "G3.4": [
    [6, "Get into an accelerator within {months} months", "{months} 个月内入选一家加速器"],
    [6, "Join {program} within {months} months", "{months} 个月内入选{program}"],
    [4, "Reach the interview stage at {count} accelerators within {months} months", "{months} 个月内进入 {count} 家加速器的面试环节", 3],
  ],
  "G3.5": [
    [6, "Reach the finals of a startup competition within {months} months", "{months} 个月内进入一场创业比赛的决赛"],
    [6, "Win a prize of at least {amount} within {months} months", "{months} 个月内赢得不低于{amount}的奖金"],
    [3, "Pitch to investors at {count} events within {months} months", "{months} 个月内在 {count} 场活动上向投资人路演", 3],
  ],
  "G3.6": [
    [6, "Exhibit at a trade show in {field} within {months} months", "{months} 个月内在{field}展会上参展"],
    [6, "Get {count} qualified leads from trade shows within {months} months", "{months} 个月内从展会获得 {count} 条有效线索", 30],
    [9, "Get a speaking or pitch slot at a major trade show within {months} months", "{months} 个月内在大型展会上获得演讲或路演机会"],
  ],
  "G3.7": [
    [6, "Launch a crowdfunding campaign within {months} months", "{months} 个月内上线众筹项目"],
    [6, "Raise {amount} through crowdfunding within {months} months", "{months} 个月内通过众筹筹到{amount}"],
    [4, "Reach {count} backers within {months} months", "{months} 个月内获得 {count} 位支持者", 500],
  ],
  "G3.8": [
    [3, "Secure a business loan of {amount} within {months} months", "{months} 个月内获得{amount}的经营贷款"],
    [2, "Have a complete loan application package within {months} months", "{months} 个月内备齐贷款申请材料"],
    [3, "Compare offers from {count} lenders within {months} months", "{months} 个月内比较 {count} 家机构的贷款方案", 3],
  ],
  "G3.9": [
    [6, "Sign {count} paying customers within {months} months", "{months} 个月内签下 {count} 个付费客户", 10],
    [6, "Sign a distributor or channel partner in {city} within {months} months", "{months} 个月内在{city}签下一家经销商或渠道伙伴"],
    [3, "Book {count} sales meetings within {months} months", "{months} 个月内约到 {count} 场销售会议", 20],
  ],
  "G3.10": [
    [3, "Get covered by {count} media outlets within {months} months", "{months} 个月内获得 {count} 家媒体报道", 3],
    [6, "Appear on {count} podcasts within {months} months", "{months} 个月内登上 {count} 档播客", 3],
    [9, "Make a recognised startup list within {months} months", "{months} 个月内登上一份知名创业榜单"],
  ],
  "G3.11": [
    [3, "Make {count} {role} hires within {months} months", "{months} 个月内招到 {count} 位{role}成员", 2],
    [2, "Fill your first key role within {months} months", "{months} 个月内招到第一位关键岗位成员"],
    [2, "Receive {count} qualified candidates within {months} months", "{months} 个月内收到 {count} 位合格候选人的申请", 20],
  ],
  "G3.12": [
    [12, "Win your first customers in {country} within {months} months", "{months} 个月内在{country}拿下首批客户"],
    [9, "Exhibit or pitch at an overseas trade show within {months} months", "{months} 个月内在海外展会参展或路演"],
    [12, "Join an overseas accelerator or market-entry program within {months} months", "{months} 个月内入选一个海外加速器或落地项目"],
  ],
  "G3.13": [
    [1, "Get {count} quotes from legal, tax or compliance providers within {months} months", "{months} 个月内拿到 {count} 份法律、财税或合规服务报价", 3],
    [2, "Engage a law or accounting firm within {months} months", "{months} 个月内签约一家律所或财税服务机构"],
    [3, "Complete incorporation and compliance setup within {months} months", "{months} 个月内完成公司设立与合规搭建"],
  ],

  "G4.1": [
    [12, "Publish a first-author paper at {venue} within {months} months", "{months} 个月内在{venue}发表一作论文"],
    [6, "Submit {count} papers to conferences within {months} months", "{months} 个月内向会议投稿 {count} 篇论文", 2],
    [9, "Get a paper accepted at a peer-reviewed conference within {months} months", "{months} 个月内有一篇论文被同行评审会议录用"],
  ],
  "G4.2": [
    [12, "Publish in {venue} within {months} months", "{months} 个月内在{venue}发表论文"],
    [12, "Get {count} journal papers accepted within {months} months", "{months} 个月内有 {count} 篇期刊论文被录用", 2],
    [6, "Submit a manuscript to a well-matched journal within {months} months", "{months} 个月内把论文投到匹配的期刊"],
  ],
  "G4.3": [
    [12, "Win a research grant of at least {amount} within {months} months", "{months} 个月内获得不低于{amount}的科研基金"],
    [12, "Win a grant from {funder} within {months} months", "{months} 个月内获得{funder}资助"],
    [6, "Submit {count} grant applications within {months} months", "{months} 个月内提交 {count} 份基金申请", 2],
  ],
  "G4.4": [
    [12, "Receive a funded PhD offer in {field} within {months} months", "{months} 个月内拿到{field}的全奖博士录取"],
    [9, "Secure a postdoc position at {org} within {months} months", "{months} 个月内拿到{org}的博士后职位"],
    [6, "Interview with {count} prospective supervisors within {months} months", "{months} 个月内与 {count} 位潜在导师面谈", 5],
  ],
  "G4.5": [
    [12, "Start a visiting position at {org} within {months} months", "{months} 个月内到{org}开始访学"],
    [9, "Be accepted into a funded visiting-scholar program within {months} months", "{months} 个月内入选有资助的访问学者项目"],
    [6, "Get invitation letters from {count} host institutions within {months} months", "{months} 个月内拿到 {count} 所机构的访学邀请函", 2],
  ],
  "G4.6": [
    [6, "Start {count} new research collaborations within {months} months", "{months} 个月内开展 {count} 项新的科研合作", 2],
    [12, "Co-author a paper with a new collaborator within {months} months", "{months} 个月内与新合作者合写一篇论文"],
    [3, "Have research conversations with {count} researchers in {field} within {months} months", "{months} 个月内与 {count} 位{field}学者深入交流", 5],
  ],
  "G4.7": [
    [12, "Give {count} invited talks within {months} months", "{months} 个月内做 {count} 场受邀报告", 3],
    [6, "Join the program committee of {venue} within {months} months", "{months} 个月内进入{venue}的程序委员会"],
    [12, "Join the editorial board of a journal in {field} within {months} months", "{months} 个月内成为{field}期刊的编委"],
  ],
  "G4.8": [
    [12, "Be nominated for an academic award within {months} months", "{months} 个月内获得一个学术奖项的提名"],
    [12, "Win an early-career research award within {months} months", "{months} 个月内获得一个青年学者奖"],
    [18, "Win {count} academic prizes within {months} months", "{months} 个月内获得 {count} 个学术奖项", 2],
  ],
  "G4.9": [
    [12, "Sign an industry research agreement worth {amount} within {months} months", "{months} 个月内签下金额{amount}的企业合作课题"],
    [12, "License a patent or technology within {months} months", "{months} 个月内完成一项专利或技术的转让许可"],
    [6, "Meet {count} companies interested in your research within {months} months", "{months} 个月内与 {count} 家对你研究感兴趣的企业会谈", 5],
  ],

  "G5.1": [
    [12, "Get admitted to a {degree} program in {field} within {months} months", "{months} 个月内被{field}的{degree}项目录取"],
    [12, "Get an offer from {school} within {months} months", "{months} 个月内拿到{school}的录取"],
    [12, "Receive {count} admission offers within {months} months", "{months} 个月内拿到 {count} 个录取", 3],
  ],
  "G5.2": [
    [9, "Win scholarships worth at least {amount} within {months} months", "{months} 个月内获得不低于{amount}的奖学金"],
    [12, "Secure a full scholarship within {months} months", "{months} 个月内拿到全额奖学金"],
    [6, "Apply to {count} scholarships within {months} months", "{months} 个月内申请 {count} 项奖学金", 8],
  ],
  "G5.3": [
    [6, "Be accepted into an exchange program in {country} within {months} months", "{months} 个月内入选{country}的交换项目"],
    [6, "Join a summer school or camp at {school} within {months} months", "{months} 个月内参加{school}的暑校或夏令营"],
    [4, "Get into {count} summer programs within {months} months", "{months} 个月内被 {count} 个暑期项目录取", 2],
  ],
  "G5.4": [
    [4, "Reach your target score on {test} within {months} months", "{months} 个月内{test}考到目标分数"],
    [2, "Register for {test} on a date that meets your deadlines within {months} months", "{months} 个月内报名{test}，考期赶得上申请截止"],
    [6, "Finish all required tests within {months} months", "{months} 个月内完成全部所需考试"],
  ],
  "G5.5": [
    [3, "Have a complete visa application package within {months} months", "{months} 个月内备齐签证申请材料"],
    [4, "Get your student visa for {country} within {months} months", "{months} 个月内拿到{country}的学生签证"],
    [2, "Book your visa appointment within {months} months", "{months} 个月内约好签证面谈"],
  ],

  "G6.1": [
    [3, "Win {count} projects on {platform} within {months} months", "{months} 个月内在{platform}接到 {count} 个项目", 3],
    [6, "Earn {rate} a month from freelance platforms within {months} months", "{months} 个月内通过接单平台每月收入达到{rate}"],
    [6, "Reach top-rated status on {platform} within {months} months", "{months} 个月内在{platform}获得高评级"],
  ],
  "G6.2": [
    [3, "Land steady client work worth {rate} a month within {months} months", "{months} 个月内接到每月{rate}以上的稳定项目"],
    [3, "Sign {count} direct clients within {months} months", "{months} 个月内签下 {count} 个直客", 3],
    [6, "Win a retainer client within {months} months", "{months} 个月内拿到一个长期包月客户"],
  ],
  "G6.3": [
    [3, "Sign {count} brand partnerships within {months} months", "{months} 个月内签下 {count} 个品牌合作", 3],
    [6, "Earn {amount} from brand deals within {months} months", "{months} 个月内通过品牌合作收入{amount}"],
    [6, "Join a brand's long-term creator program within {months} months", "{months} 个月内加入一个品牌的长期创作者计划"],
  ],
  "G6.4": [
    [12, "Be awarded a residency within {months} months", "{months} 个月内入选一个驻留项目"],
    [12, "Win a creative grant of {amount} within {months} months", "{months} 个月内获得{amount}的创作基金"],
    [9, "Be shortlisted for {count} art prizes or residencies within {months} months", "{months} 个月内入围 {count} 个艺术奖项或驻留项目", 2],
  ],
  "G6.5": [
    [6, "Sign with an agency, MCN or publisher within {months} months", "{months} 个月内与经纪公司、MCN 或出版社签约"],
    [3, "Get into the creator program of {platform} within {months} months", "{months} 个月内入驻{platform}的创作者计划"],
    [6, "Receive {count} signing offers to compare within {months} months", "{months} 个月内拿到 {count} 份签约邀约可供比较", 2],
  ],
  "G6.6": [
    [6, "Have work selected for {count} exhibitions or anthologies within {months} months", "{months} 个月内有作品入选 {count} 个展览或合集", 2],
    [9, "Win a prize in a competition in {field} within {months} months", "{months} 个月内在{field}比赛中获奖"],
    [3, "Submit to {count} open calls within {months} months", "{months} 个月内投递 {count} 个作品征集", 10],
  ],
  "G6.7": [
    [3, "Become a contributor on {count} stock or licensing platforms within {months} months", "{months} 个月内成为 {count} 个素材或版权平台的供稿人", 2],
    [6, "Earn {amount} from licensing within {months} months", "{months} 个月内通过版权授权收入{amount}"],
    [6, "License {count} works within {months} months", "{months} 个月内完成 {count} 件作品的授权", 20],
  ],

  "G7.1": [
    [12, "Give a TEDx or major conference talk within {months} months", "{months} 个月内在 TEDx 或重要大会上演讲"],
    [6, "Speak at {count} events within {months} months", "{months} 个月内在 {count} 场活动上演讲", 3],
    [9, "Give a keynote at {event} within {months} months", "{months} 个月内在{event}上做主题演讲"],
  ],
  "G7.2": [
    [3, "Publish {count} guest articles within {months} months", "{months} 个月内发表 {count} 篇客座文章", 3],
    [6, "Start a regular column about {topic} within {months} months", "{months} 个月内开设关于{topic}的固定专栏"],
    [6, "Get an op-ed published in a major outlet within {months} months", "{months} 个月内在主流媒体发表一篇评论文章"],
  ],
  "G7.3": [
    [3, "Appear on {count} podcasts within {months} months", "{months} 个月内登上 {count} 档播客", 5],
    [6, "Be a guest on a leading podcast in {field} within {months} months", "{months} 个月内做客一档{field}的头部播客"],
    [6, "Talk about {topic} on {count} shows within {months} months", "{months} 个月内在 {count} 档节目中谈{topic}", 3],
  ],
  "G7.4": [
    [12, "Sign a book deal within {months} months", "{months} 个月内签下出版合同"],
    [6, "Sign with a literary agent within {months} months", "{months} 个月内与一位版权经纪人签约"],
    [6, "Send your book proposal to {count} publishers or agents within {months} months", "{months} 个月内把出版提案发给 {count} 家出版社或经纪人", 15],
  ],
  "G7.5": [
    [12, "Make a recognised list in {field} within {months} months", "{months} 个月内登上{field}的知名榜单"],
    [12, "Win an award respected in your field within {months} months", "{months} 个月内获得一个业内认可的奖项"],
    [9, "Be nominated for {count} lists or awards within {months} months", "{months} 个月内获得 {count} 个榜单或奖项的提名", 3],
  ],

  "G8.1": [
    [12, "Be awarded a fellowship within {months} months", "{months} 个月内入选一个 Fellowship 项目"],
    [12, "Win a fellowship worth at least {amount} within {months} months", "{months} 个月内获得不低于{amount}的 Fellowship 资助"],
    [9, "Reach the final round of {count} fellowships within {months} months", "{months} 个月内进入 {count} 个 Fellowship 的终面", 2],
  ],
  "G8.2": [
    [9, "Be approved for a talent program in {city} within {months} months", "{months} 个月内入选{city}的人才计划"],
    [6, "Receive a personal subsidy of {amount} within {months} months", "{months} 个月内领到{amount}的个人补贴"],
    [3, "File applications to {count} programs you qualify for within {months} months", "{months} 个月内申报 {count} 个你符合条件的项目", 2],
  ],
  "G8.3": [
    [3, "Place in the top three of a competition within {months} months", "{months} 个月内在一场比赛中进入前三"],
    [6, "Win {amount} in prize money within {months} months", "{months} 个月内赢得{amount}奖金"],
    [3, "Enter {count} competitions or hackathons within {months} months", "{months} 个月内参加 {count} 场比赛或黑客松", 4],
  ],
  "G8.4": [
    [6, "Win a micro-grant for your project within {months} months", "{months} 个月内为你的项目拿到一笔微基金"],
    [9, "Raise {amount} in creative grants within {months} months", "{months} 个月内获得{amount}的创作资助"],
    [4, "Apply to {count} grants within {months} months", "{months} 个月内申请 {count} 项资助", 6],
  ],

  "G9.1": [
    [12, "Obtain a work visa for {country} within {months} months", "{months} 个月内拿到{country}的工作签证"],
    [6, "Complete the evidence package for a talent visa within {months} months", "{months} 个月内备齐人才签证的证据材料"],
    [9, "File a talent visa application with a lawyer within {months} months", "{months} 个月内在律师协助下递交人才签证申请"],
  ],
  "G9.2": [
    [9, "Be approved for a returnee talent program in {city} within {months} months", "{months} 个月内入选{city}的回国人才项目"],
    [6, "Receive returnee settlement support of {amount} within {months} months", "{months} 个月内获得{amount}的归国安家补贴"],
    [3, "Complete your returnee application package within {months} months", "{months} 个月内备齐回国人才申报材料"],
  ],
  "G9.3": [
    [9, "Pitch or exhibit in {country} within {months} months", "{months} 个月内在{country}参展或路演"],
    [12, "Open a local office or entity in {country} within {months} months", "{months} 个月内在{country}设立办公室或主体"],
    [12, "Sign {count} customers or partners in {country} within {months} months", "{months} 个月内在{country}签下 {count} 个客户或合作伙伴", 3],
  ],

  "G10.1": [
    [3, "Join {count} associations or chambers within {months} months", "{months} 个月内加入 {count} 个协会或商会", 2],
    [6, "Take on a role in your alumni association within {months} months", "{months} 个月内在校友会担任一个职务"],
    [3, "Attend {count} member events within {months} months", "{months} 个月内参加 {count} 场会员活动", 4],
  ],
  "G10.2": [
    [6, "Attend {count} industry events in {field} within {months} months", "{months} 个月内参加 {count} 场{field}行业活动", 4],
    [6, "Get a free or sponsored ticket to {event} within {months} months", "{months} 个月内获得{event}的免费票或资助票"],
    [3, "Meet {count} new people who matter for your goal within {months} months", "{months} 个月内结识 {count} 位对你目标有帮助的人", 10],
  ],
  "G10.3": [
    [3, "Find a mentor within {months} months", "{months} 个月内找到一位导师"],
    [6, "Mentor {count} people through a program within {months} months", "{months} 个月内通过导师项目带 {count} 位学员", 2],
    [6, "Meet a mentor every month for {months} months", "连续 {months} 个月，每月与导师交流一次"],
  ],

  "G11.1": [
    [3, "Start volunteering with {org} within {months} months", "{months} 个月内在{org}开始志愿服务"],
    [6, "Volunteer {count} hours within {months} months", "{months} 个月内完成 {count} 小时志愿服务", 50],
    [6, "Land a paid role at a nonprofit within {months} months", "{months} 个月内拿到公益机构的正式岗位"],
  ],
  "G11.2": [
    [6, "Reach the finals of a social innovation competition within {months} months", "{months} 个月内进入一场社会创新比赛的决赛"],
    [9, "Win funding of {amount} for your social project within {months} months", "{months} 个月内为公益项目获得{amount}资助"],
    [4, "Apply to {count} social innovation programs within {months} months", "{months} 个月内申请 {count} 个社会创新项目", 4],
  ],
  "G11.3": [
    [12, "Land a role at {org} within {months} months", "{months} 个月内拿到{org}的岗位"],
    [9, "Join a UN or international-organisation program (JPO, UNV, internship) within {months} months", "{months} 个月内入选联合国或国际组织项目（JPO、UNV、实习）"],
    [6, "Apply to {count} international-organisation roles within {months} months", "{months} 个月内申请 {count} 个国际组织岗位", 8],
  ],

  "G12.1": [
    [6, "Achieve {outcome} within {months} months", "{months} 个月内实现{outcome}"],
    [3, "Make measurable progress towards {outcome} within {months} months", "{months} 个月内朝{outcome}取得可衡量的进展"],
    [12, "Take {count} concrete steps towards {outcome} within {months} months", "{months} 个月内朝{outcome}完成 {count} 个具体步骤", 10],
  ],
};

export const SUCCESS_TEMPLATES: readonly SuccessTemplate[] = SUB_GOAL_IDS.flatMap((subGoal) =>
  DATA[subGoal].map(([horizonMonths, en, zh, count], i) => ({
    id: `${subGoal}-${"abc"[i]}`,
    subGoal,
    text: bi(en, zh),
    horizonMonths,
    ...(count !== undefined ? { count } : {}),
  })),
);

const BY_SUB = new Map<string, SuccessTemplate[]>();
for (const t of SUCCESS_TEMPLATES) BY_SUB.set(t.subGoal, [...(BY_SUB.get(t.subGoal) ?? []), t]);
const BY_ID = new Map<string, SuccessTemplate>(SUCCESS_TEMPLATES.map((t) => [t.id, t]));

export function successTemplatesFor(subGoal: SubGoalId): SuccessTemplate[] {
  return BY_SUB.get(subGoal) ?? [];
}

export function getSuccessTemplate(id: string): SuccessTemplate | null {
  return BY_ID.get(id) ?? null;
}

/** Placeholders used in a text (`{role}` → role), in order of first appearance. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{([a-z_]+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export type SuccessParams = Partial<Record<PlaceholderKey, string | number>> & { currency?: string };

export interface RenderedSuccess {
  templateId: string;
  text: string;
  horizonMonths: number;
  /** Placeholders filled with a neutral default (the UI can offer a one-tap value). */
  missing: PlaceholderKey[];
}

function formatValue(key: PlaceholderKey, value: string | number, locale: Locale, currency?: string): string {
  if (typeof value === "string") return value.trim();
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  if (MONEY_KEYS.has(key) && currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(tag, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(value);
    } catch {
      /* unknown currency code: fall through to a plain number */
    }
  }
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(value);
}

const ARTICLE = "\u0001";

/** English "a" vs "an" for the word that follows (acronyms by letter name, common exceptions). */
export function needsAn(word: string): boolean {
  const w = word.replace(/^[^A-Za-z]+/, "");
  if (!w) return false;
  if (/^[A-Z]{2,}\b/.test(w)) return "AEFHILMNORSX".includes(w[0]);
  const lower = w.toLowerCase();
  if (/^(hour|honest|honou?r|heir)/.test(lower)) return true;
  if (/^(uni|use|usu|uti|ura|ure|eu|ewe|one|once)/.test(lower)) return false;
  return /^[aeiou]/.test(lower);
}

/** Collapses the gaps an empty qualifier leaves and fixes the English article before it. */
function tidy(text: string, locale: Locale): string {
  let out = text.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?，。；：])/g, "$1").trim();
  if (locale === "en") out = out.replace(new RegExp(`${ARTICLE} (\\S+)`, "g"), (_m, w: string) => `${needsAn(w) ? "an" : "a"} ${w}`);
  return out.replace(new RegExp(ARTICLE, "g"), "a");
}

/** Renders one template in one locale. */
export function renderSuccessTemplate(template: SuccessTemplate, params: SuccessParams, locale: Locale): RenderedSuccess {
  // Mark "a {placeholder}" so the article can agree with whatever ends up after it.
  const raw = locale === "zh" ? template.text.zh : template.text.en.replace(/\ba \{/g, `${ARTICLE} {`);
  const months = typeof params.months === "number" && params.months > 0 ? params.months : template.horizonMonths;
  const missing: PlaceholderKey[] = [];
  const text = raw.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    const k = key as PlaceholderKey;
    if (k === "months") return String(months);
    const given = params[k];
    if (given !== undefined && given !== null && String(given).trim() !== "") return formatValue(k, given, locale, params.currency);
    if (k === "count") {
      if (template.count === undefined) throw new Error(`Template ${template.id} uses {count} without a default`);
      return String(template.count);
    }
    const fallback = PLACEHOLDER_DEFAULTS[k as Exclude<PlaceholderKey, "months" | "count">];
    if (!fallback) throw new Error(`Unknown placeholder {${key}} in ${template.id}`);
    if (!missing.includes(k)) missing.push(k);
    return locale === "zh" ? fallback.zh : fallback.en;
  });
  return { templateId: template.id, text: tidy(text, locale), horizonMonths: months, missing };
}

/**
 * The candidate success definitions for a sub-goal (three or more), rendered.
 *   render("G3.2", { amount: 3_000_000, currency: "CNY" }, "zh")[0].text
 *   → "12 个月内完成种子轮，金额不低于¥3,000,000"
 */
export function renderSuccessDefinitions(subGoal: SubGoalId, params: SuccessParams = {}, locale: Locale = "en"): RenderedSuccess[] {
  return successTemplatesFor(subGoal).map((t) => renderSuccessTemplate(t, params, locale));
}

/** Alias kept for the contract name in the build contract (`render(subGoalId, params, locale)`). */
export const render = renderSuccessDefinitions;
