/**
 * Identity taxonomy (plan §2): group → code → stage. A person can hold several codes at once
 * (E2 + F5, S4 + C6); packs stack, they never conflict. Codes are inferred from documents and
 * pre-selected; the person taps to change. `cues` are the inference hints the local engine
 * scans for in résumés, decks and profiles (English + Chinese).
 *
 * Note: the plan lists 60 codes (S1–S7, E1–E8, F1–F8, R1–R6, C1–C9, P1–P7, T1–T8, I1–I7).
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { compilePhrase, containsPhrase, prepareText, type CompiledPhrase } from "./text";
import {
  IDENTITY_CODES,
  IDENTITY_GROUPS,
  USER_IDENTITY_GROUPS,
  groupOfIdentity,
  identityCodeSchema,
  identityGroupSchema,
  type IdentityCode,
  type IdentityGroup,
  type IdentityTarget,
} from "./types";

export interface StageOption {
  id: string;
  label: Bilingual;
}

export interface IdentityGroupDef {
  id: IdentityGroup;
  label: Bilingual;
  description: Bilingual;
  stages: StageOption[];
  /** I = supply side (organisations publishing opportunities), phase 2. */
  supplySide: boolean;
}

export interface IdentityDef {
  code: IdentityCode;
  group: IdentityGroup;
  label: Bilingual;
  /** Overrides the group's stage options when the code needs its own (e.g. S1 grades). */
  stages?: StageOption[];
  cues: { en: string[]; zh: string[] };
  /** Minors: guardian email required, no outreach channel (S1). */
  minor?: boolean;
}

const stageSchema = z.object({ id: z.string().regex(/^[a-z0-9_]+$/), label: bilingualSchema });

export const identityGroupDefSchema = z.object({
  id: identityGroupSchema,
  label: bilingualSchema,
  description: bilingualSchema,
  stages: z.array(stageSchema).min(2),
  supplySide: z.boolean(),
});

export const identityDefSchema = z.object({
  code: identityCodeSchema,
  group: identityGroupSchema,
  label: bilingualSchema,
  stages: z.array(stageSchema).min(2).optional(),
  cues: z.object({ en: z.array(z.string().min(1)).min(1), zh: z.array(z.string().min(1)).min(1) }),
  minor: z.boolean().optional(),
});

const st = (id: string, en: string, zh: string): StageOption => ({ id, label: bi(en, zh) });

export const IDENTITY_GROUP_DEFS: readonly IdentityGroupDef[] = [
  {
    id: "S",
    label: bi("Students", "学生"),
    description: bi("High school to PhD, recent graduates, international and vocational students.", "从高中到博士，包括应届毕业生、留学生与职校生。"),
    stages: [st("first_year", "First years", "低年级"), st("middle_years", "Middle years", "中间年级"), st("final_year", "Final year", "毕业年级")],
    supplySide: false,
  },
  {
    id: "E",
    label: bi("Professionals", "职场人"),
    description: bi("Employees at every level, the public sector, skilled trades and service work.", "各层级的在职人士，包括体制内、技术工人与服务业从业者。"),
    stages: [
      st("settled", "Not looking", "暂不考虑机会"),
      st("open", "Open to offers", "看看机会"),
      st("actively_looking", "Actively looking", "积极求职"),
      st("leaving", "Leaving soon", "已提离职或即将离职"),
    ],
    supplySide: false,
  },
  {
    id: "F",
    label: bi("Founders", "创业者"),
    description: bi("From an idea to a growing company, solo founders, shop owners and social entrepreneurs.", "从一个想法到成长期公司，包括一人公司、小店主与社会企业创业者。"),
    stages: [
      st("idea", "Idea", "想法阶段"),
      st("mvp", "Prototype or MVP", "原型或 MVP"),
      st("pre_seed", "Pre-seed", "Pre-seed 轮"),
      st("seed", "Seed", "种子轮"),
      st("series_a", "Series A", "A 轮"),
      st("series_b_plus", "Series B or later", "B 轮及以后"),
      st("bootstrapped", "Bootstrapped", "自筹资金"),
      st("profitable", "Profitable", "已盈利"),
    ],
    supplySide: false,
  },
  {
    id: "R",
    label: bi("Researchers", "研究者"),
    description: bi("Postdocs, faculty, industry, independent and clinical researchers.", "博士后、高校教师、企业研究员、独立研究者与临床研究者。"),
    stages: [
      st("early_career", "Early career (within 7 years of PhD)", "早期（博士毕业 7 年内）"),
      st("mid_career", "Mid-career", "中期"),
      st("senior", "Senior", "资深"),
    ],
    supplySide: false,
  },
  {
    id: "C",
    label: bi("Freelancers & creators", "自由职业者与创作者"),
    description: bi("Designers, writers, filmmakers, creators, artists, freelance developers, consultants and makers.", "设计师、写作者、影像创作者、博主、艺术家、自由开发者、顾问与手作人。"),
    stages: [
      st("side", "Side project", "业余或副业"),
      st("part_time", "Part-time freelance", "半职自由职业"),
      st("full_time", "Full-time freelance", "全职自由职业"),
      st("studio", "Studio or team", "工作室或团队"),
    ],
    supplySide: false,
  },
  {
    id: "P",
    label: bi("Licensed professionals", "持证专业人士"),
    description: bi("Healthcare, law, accounting, architecture and engineering, teaching, counselling and finance.", "医护、法律、会计、建筑与工程、教育、心理咨询与金融等持证职业。"),
    stages: [
      st("in_training", "In training", "培训或实习期"),
      st("licensed", "Licensed", "已执业"),
      st("senior", "Senior", "资深"),
      st("independent", "Independent practice", "独立执业"),
    ],
    supplySide: false,
  },
  {
    id: "T",
    label: bi("People in transition", "转型期"),
    description: bi("Between jobs, changing careers, moving countries, returning to work.", "待业、转行、跨国迁移或重返职场的人。"),
    stages: [st("planning", "Planning", "计划中"), st("in_transition", "In transition", "过渡中"), st("long_gap", "Gap over six months", "空窗半年以上")],
    supplySide: false,
  },
  {
    id: "I",
    label: bi("Opportunity providers", "资源方"),
    description: bi("Investors, programs, organisers, employers and agencies that publish opportunities (coming later).", "发布机会的投资方、项目方、主办方、招聘方与机构（后续开放）。"),
    stages: [st("evaluating", "Evaluating", "评估中"), st("active", "Active", "已入驻")],
    supplySide: true,
  },
];

const id = (
  code: IdentityCode,
  en: string,
  zh: string,
  cuesEn: string[],
  cuesZh: string[],
  extra: Partial<Pick<IdentityDef, "stages" | "minor">> = {},
): IdentityDef => ({ code, group: groupOfIdentity(code), label: bi(en, zh), cues: { en: cuesEn, zh: cuesZh }, ...extra });

export const IDENTITIES: readonly IdentityDef[] = [
  /* ------------------------------------------------------------ S students */
  id("S1", "High school student", "高中生",
    ["high school", "secondary school", "grade 10", "grade 11", "grade 12", "a levels", "ib diploma", "gcse", "ap courses"],
    ["高中", "高一", "高二", "高三", "中学生", "高考", "国际学校"],
    { minor: true, stages: [st("lower_grades", "Grade 10 or below", "高一及以下"), st("grade_11", "Grade 11", "高二"), st("grade_12", "Grade 12", "高三")] }),
  id("S2", "Undergraduate", "本科生",
    ["bachelor", "undergraduate", "b sc", "bachelor of science", "bachelor of arts", "freshman", "sophomore", "junior year", "senior year", "expected graduation"],
    ["本科", "学士", "大一", "大二", "大三", "大四", "本科在读", "预计毕业"],
    { stages: [st("year_1", "Year 1", "大一"), st("year_2", "Year 2", "大二"), st("year_3", "Year 3", "大三"), st("year_4_plus", "Year 4 or later", "大四及以上")] }),
  id("S3", "Master's student", "硕士研究生",
    ["master's student", "masters student", "msc", "m sc", "master of science", "master of arts", "mba candidate", "meng", "pursuing a master"],
    ["硕士", "研究生", "研一", "研二", "研三", "硕士在读", "专硕", "学硕"],
    { stages: [st("first_year", "First year", "研一"), st("final_year", "Final year", "毕业年级")] }),
  id("S4", "PhD student", "博士研究生",
    ["phd student", "phd candidate", "doctoral student", "doctoral candidate", "pursuing a phd", "dissertation"],
    ["博士生", "博士研究生", "博士在读", "直博", "读博"],
    { stages: [st("coursework", "Coursework and qualifying exams", "课程与资格考试阶段"), st("candidate", "Candidate (research)", "研究阶段（博士候选人）"), st("final_year", "Final year (defending)", "毕业年级（准备答辩）")] }),
  id("S5", "Recent graduate (within one year)", "应届毕业生（毕业 1 年内）",
    ["recent graduate", "new grad", "new graduate", "graduated in", "class of"],
    ["应届", "应届生", "应届毕业生", "毕业生"],
    { stages: [st("within_6_months", "Graduated within 6 months", "毕业 6 个月内"), st("within_12_months", "Graduated 6–12 months ago", "毕业 6–12 个月")] }),
  id("S6", "International student", "留学生",
    ["international student", "f 1 visa", "f1 visa", "opt", "cpt", "student visa", "study abroad"],
    ["留学生", "留学", "海外留学", "f1签证", "学生签证"],
    { stages: [st("language_foundation", "Language or foundation", "语言与预科"), st("undergraduate", "Undergraduate", "本科"), st("masters", "Master's", "硕士"), st("doctoral", "Doctoral", "博士")] }),
  id("S7", "Vocational or associate-degree student", "专科与职校生",
    ["vocational", "associate degree", "community college", "technical college", "polytechnic", "apprentice", "apprenticeship"],
    ["专科", "大专", "高职", "中职", "职校", "技校", "职业技术学院"]),

  /* ------------------------------------------------------------ E professionals */
  id("E1", "Early career (0–3 years)", "初级（0–3 年）",
    ["junior", "entry level", "associate", "graduate trainee", "assistant"],
    ["初级", "助理", "专员", "职场新人"]),
  id("E2", "Mid-level (3–8 years)", "中级（3–8 年）",
    ["mid level", "intermediate", "3 years of experience", "5 years of experience", "experienced"],
    ["中级", "3年经验", "5年经验", "骨干"]),
  id("E3", "Senior or specialist", "资深与专家",
    ["senior", "staff", "principal", "specialist", "expert", "lead"],
    ["资深", "高级", "专家", "首席", "骨干专家"]),
  id("E4", "Manager or director", "经理与总监",
    ["manager", "director", "head of", "team lead", "supervisor"],
    ["经理", "总监", "主管", "负责人", "部门长"]),
  id("E5", "Executive", "高管",
    ["vice president", "chief", "ceo", "cto", "cfo", "coo", "c level", "general manager", "managing director", "executive"],
    ["副总裁", "总裁", "总经理", "首席", "高管", "董事"]),
  id("E6", "Public sector (civil service, public institutions, SOEs)", "体制内（公务员、事业单位、国企）",
    ["civil service", "civil servant", "public sector", "government", "state owned", "public institution"],
    ["公务员", "事业单位", "国企", "央企", "机关", "体制内", "编制"]),
  id("E7", "Skilled trades and blue-collar work", "技术工人与蓝领",
    ["technician", "operator", "welder", "electrician", "machinist", "mechanic", "plumber", "forklift", "assembly", "trades"],
    ["技工", "技师", "操作工", "电工", "焊工", "普工", "蓝领", "师傅"]),
  id("E8", "Service industry", "服务业从业者",
    ["customer service", "retail", "hospitality", "restaurant", "barista", "cashier", "server", "front desk", "housekeeping", "salon"],
    ["服务员", "店员", "收银", "客服", "餐饮", "酒店", "导购", "美发", "外卖", "快递"]),

  /* ------------------------------------------------------------ F founders */
  id("F1", "Idea stage, not yet started", "有想法未启动",
    ["idea stage", "aspiring founder", "planning to start", "side project", "pre idea"],
    ["想创业", "创业想法", "准备创业", "筹备中", "副业项目"]),
  id("F2", "Early stage (pre-seed and seed)", "早期（Pre-seed 与 Seed）",
    ["pre seed", "seed round", "angel round", "mvp", "early stage startup", "co founder", "founder"],
    ["天使轮", "种子轮", "早期创业", "联合创始人", "创始人", "初创"]),
  id("F3", "Growth stage (Series A and later)", "成长期（A 轮及以后）",
    ["series a", "series b", "series c", "scale up", "growth stage"],
    ["a轮", "b轮", "c轮", "成长期", "规模化"]),
  id("F4", "Serial founder", "连续创业者",
    ["serial entrepreneur", "serial founder", "exited", "acquired by", "previous startup", "second startup"],
    ["连续创业", "连续创业者", "被收购", "成功退出", "二次创业"]),
  id("F5", "Indie developer or solo founder", "独立开发者与一人公司",
    ["indie hacker", "indie developer", "solo founder", "solopreneur", "bootstrapped", "one person company"],
    ["独立开发", "独立开发者", "一人公司", "个人开发者", "自筹资金"]),
  id("F6", "Small business or shop owner", "小微企业主与店主",
    ["small business owner", "shop owner", "store owner", "restaurant owner", "family business", "sole proprietor"],
    ["个体户", "店主", "小微企业", "老板", "门店", "夫妻店", "个体工商户"]),
  id("F7", "Transforming a traditional business", "传统企业转型者",
    ["digital transformation", "traditional business", "family business transformation", "second generation"],
    ["传统企业", "企业转型", "数字化转型", "厂二代", "家族企业", "工厂老板"]),
  id("F8", "Social entrepreneur", "社会企业与公益创业者",
    ["social enterprise", "social entrepreneur", "nonprofit founder", "impact startup", "b corp"],
    ["社会企业", "社会创新", "公益创业", "公益组织", "社企"]),

  /* ------------------------------------------------------------ R researchers */
  id("R1", "Postdoc", "博士后",
    ["postdoc", "postdoctoral", "research fellow"],
    ["博士后", "博后", "博士后研究员"]),
  id("R2", "Early-career faculty or assistant professor", "青年教师与助理教授",
    ["assistant professor", "lecturer", "tenure track", "junior faculty"],
    ["助理教授", "讲师", "青年教师", "准聘", "青年研究员"]),
  id("R3", "Associate or full professor", "副教授与教授",
    ["associate professor", "full professor", "professor", "chair professor", "principal investigator", "lab director"],
    ["副教授", "教授", "博导", "课题组长", "实验室主任"]),
  id("R4", "Industry researcher", "企业研究员",
    ["research scientist", "industry researcher", "research lab", "applied scientist", "r and d"],
    ["企业研究院", "研究员", "研发中心", "实验室研究员"]),
  id("R5", "Independent researcher", "独立研究者",
    ["independent researcher", "independent scholar", "citizen scientist", "unaffiliated"],
    ["独立研究者", "独立学者", "自由研究者"]),
  id("R6", "Clinical researcher", "临床研究者",
    ["clinical researcher", "clinical trial", "physician scientist", "irb", "good clinical practice"],
    ["临床研究", "临床试验", "临床研究者", "gcp"]),

  /* ------------------------------------------------------------ C freelancers & creators */
  id("C1", "Designer", "设计师",
    ["designer", "graphic design", "ui", "ux", "figma", "dribbble", "behance"],
    ["设计师", "平面设计", "交互设计", "视觉设计", "站酷"]),
  id("C2", "Writer or screenwriter", "写作者与编剧",
    ["writer", "author", "screenwriter", "novelist", "copywriter", "substack"],
    ["作家", "作者", "编剧", "撰稿", "写作", "网文"]),
  id("C3", "Photographer or videographer", "摄影与视频创作者",
    ["photographer", "videographer", "filmmaker", "cinematographer", "video editor"],
    ["摄影师", "摄像", "导演", "剪辑", "视频创作"]),
  id("C4", "Blogger or streamer", "博主与主播",
    ["youtuber", "content creator", "influencer", "streamer", "blogger", "subscribers", "followers", "tiktok", "twitch"],
    ["博主", "up主", "主播", "自媒体", "粉丝", "小红书", "抖音", "b站", "网红"]),
  id("C5", "Musician or artist", "音乐人与艺术家",
    ["musician", "artist", "painter", "singer", "composer", "solo exhibition", "gallery"],
    ["音乐人", "艺术家", "画家", "歌手", "作曲", "个展", "画廊"]),
  id("C6", "Freelance developer", "自由开发者",
    ["freelance developer", "contract developer", "freelancer", "upwork", "toptal", "fiverr"],
    ["自由开发者", "外包开发", "接单", "自由职业"]),
  id("C7", "Consultant or coach", "顾问与教练",
    ["consultant", "coach", "advisor", "independent consultant", "fractional"],
    ["顾问", "教练", "咨询师", "独立顾问"]),
  id("C8", "Translator or localization specialist", "翻译与本地化",
    ["translator", "interpreter", "localization", "translation"],
    ["翻译", "口译", "笔译", "本地化", "同传"]),
  id("C9", "Craftsperson or independent brand owner", "手工艺人与独立品牌主理人",
    ["handmade", "craft", "artisan", "etsy", "maker", "ceramics", "jewelry", "independent brand"],
    ["手工", "手作", "手艺人", "陶艺", "独立品牌", "主理人", "匠人"]),

  /* ------------------------------------------------------------ P licensed professionals */
  id("P1", "Healthcare professional", "医护人员",
    ["physician", "nurse", "registered nurse", "medical license", "residency program", "hospital", "clinic", "pharmacist", "md"],
    ["医生", "护士", "医师", "执业医师", "护士执业证", "医院", "药师"]),
  id("P2", "Lawyer", "律师",
    ["lawyer", "attorney", "bar admission", "juris doctor", "solicitor", "barrister", "law firm"],
    ["律师", "执业律师", "法律职业资格", "律所", "法考"]),
  id("P3", "Accounting, audit or tax professional", "会计、审计与税务",
    ["cpa", "acca", "cma", "chartered accountant", "audit", "tax advisor", "big four"],
    ["注册会计师", "会计", "审计", "税务师", "四大"]),
  id("P4", "Architect or licensed engineer", "建筑师与注册工程师",
    ["registered architect", "licensed engineer", "professional engineer", "chartered engineer", "architect", "structural engineer"],
    ["注册建筑师", "注册工程师", "一级建造师", "注册结构工程师", "建筑师", "造价工程师"]),
  id("P5", "Teacher", "教师",
    ["teacher", "teaching certificate", "teaching license", "qualified teacher status", "classroom"],
    ["教师资格证", "教师", "老师", "班主任", "教龄"]),
  id("P6", "Counselor or therapist", "心理咨询师",
    ["counselor", "therapist", "psychotherapist", "lpc", "lmft", "clinical psychologist", "counseling"],
    ["心理咨询师", "心理咨询", "心理治疗", "个案时长"]),
  id("P7", "Licensed finance professional", "金融持证人",
    ["cfa", "frm", "cfp", "series 7", "series 63", "chartered financial analyst"],
    ["基金从业", "证券从业", "保荐代表人", "金融持证", "特许金融分析师"]),

  /* ------------------------------------------------------------ T people in transition */
  id("T1", "Between jobs or laid off", "待业与被裁",
    ["laid off", "layoff", "between jobs", "unemployed", "open to work", "job seeking"],
    ["被裁", "裁员", "待业", "失业", "求职中", "找工作"]),
  id("T2", "Career changer", "转行",
    ["career change", "career changer", "transitioning into", "pivot", "bootcamp graduate", "switching careers"],
    ["转行", "转型", "跨行", "转换赛道"]),
  id("T3", "Returning from abroad", "海归",
    ["returnee", "returning to china", "moved back", "overseas experience"],
    ["海归", "回国发展", "归国", "留学回国", "海外工作经历"]),
  id("T4", "Moving abroad", "出国发展",
    ["relocating", "moving abroad", "relocation", "work visa", "immigrate", "emigrate"],
    ["出国", "移民", "海外发展", "出国工作", "工签"]),
  id("T5", "Veteran", "退役军人",
    ["veteran", "military", "army", "navy", "air force", "marine corps", "honorably discharged"],
    ["退役军人", "退伍", "部队", "服役", "军人"]),
  id("T6", "Returning after caregiving", "育儿后重返职场",
    ["return to work", "returner", "career break", "stay at home parent", "caregiving", "parental leave"],
    ["全职妈妈", "全职爸爸", "育儿", "重返职场", "宝妈", "产假后"]),
  id("T7", "Older worker returning to work", "银发再就业",
    ["retired", "retiree", "over 50", "encore career", "semi retired"],
    ["退休", "银发", "返聘", "退休再就业", "50岁以上"]),
  id("T8", "Person with a disability", "残障人士",
    ["disability", "disabled", "accessibility needs", "neurodivergent", "wheelchair", "deaf", "blind"],
    ["残障", "残疾", "残疾人", "听障", "视障", "肢体障碍", "残疾证"]),

  /* ------------------------------------------------------------ I opportunity providers (phase 2) */
  id("I1", "Angel investor or VC", "天使投资人与 VC",
    ["angel investor", "venture capital", "vc fund", "general partner", "limited partner"],
    ["天使投资人", "风险投资", "投资机构", "基金合伙人"]),
  id("I2", "Incubator or accelerator", "孵化器与加速器",
    ["accelerator", "incubator", "startup program"],
    ["孵化器", "加速器", "众创空间"]),
  id("I3", "Event or exhibition organiser", "展会与活动主办方",
    ["event organizer", "trade show organizer", "conference organizer", "exhibition organizer"],
    ["主办方", "展会主办", "会展公司", "活动主办"]),
  id("I4", "Employer", "招聘方",
    ["hiring manager", "talent acquisition", "we are hiring", "employer"],
    ["招聘方", "用人单位", "企业招聘"]),
  id("I5", "University career office", "高校就业办",
    ["career services", "career center", "university career office"],
    ["就业办", "就业指导中心", "高校就业", "招生就业处"]),
  id("I6", "Headhunting firm", "猎头",
    ["headhunter", "executive search", "recruitment agency"],
    ["猎头", "猎头公司", "人力资源服务"]),
  id("I7", "Government or industrial park", "政府与园区",
    ["government agency", "economic development", "industrial park", "investment promotion"],
    ["政府", "园区", "招商", "管委会", "开发区"]),
];

const BY_CODE = new Map<string, IdentityDef>(IDENTITIES.map((d) => [d.code, d]));
const GROUP_BY_ID = new Map<string, IdentityGroupDef>(IDENTITY_GROUP_DEFS.map((g) => [g.id, g]));

export function isIdentityCode(value: unknown): value is IdentityCode {
  return typeof value === "string" && (IDENTITY_CODES as readonly string[]).includes(value);
}

export function isIdentityGroup(value: unknown): value is IdentityGroup {
  return typeof value === "string" && (IDENTITY_GROUPS as readonly string[]).includes(value);
}

export function getIdentity(code: IdentityCode): IdentityDef {
  const def = BY_CODE.get(code);
  if (!def) throw new Error(`Unknown identity: ${code}`);
  return def;
}

export function getIdentityGroup(group: IdentityGroup): IdentityGroupDef {
  const def = GROUP_BY_ID.get(group);
  if (!def) throw new Error(`Unknown identity group: ${group}`);
  return def;
}

export function identitiesInGroup(group: IdentityGroup): IdentityDef[] {
  return IDENTITIES.filter((d) => d.group === group);
}

export function identityLabel(code: IdentityCode, locale: Locale | string): string {
  return localize(getIdentity(code).label, locale);
}

/** Stage options for a code: its own when defined, else its group's. */
export function stagesFor(code: IdentityCode): StageOption[] {
  const def = getIdentity(code);
  return def.stages ?? getIdentityGroup(def.group).stages;
}

export function isValidStage(code: IdentityCode, stage: string): boolean {
  return stagesFor(code).some((s) => s.id === stage);
}

/** Unique groups of a set of codes, in canonical order. */
export function groupsOf(codes: readonly IdentityCode[]): IdentityGroup[] {
  const set = new Set(codes.map(groupOfIdentity));
  return IDENTITY_GROUPS.filter((g) => set.has(g));
}

/** True when any code marks a minor (S1): guardian email required, no outreach. */
export function isMinor(codes: readonly IdentityCode[]): boolean {
  return codes.some((c) => BY_CODE.get(c)?.minor === true);
}

/** Outreach on the person's behalf (CH4) is never offered to minors. */
export function outreachAllowed(codes: readonly IdentityCode[]): boolean {
  return !isMinor(codes);
}

/**
 * Does an audience list (`"ALL"`, groups, codes) include a person with these codes?
 * `"ALL"` means every person-side group (not the supply side I).
 */
export function audienceIncludes(audience: readonly IdentityTarget[], codes: readonly IdentityCode[]): boolean {
  if (!codes.length) return audience.includes("ALL");
  for (const target of audience) {
    if (target === "ALL") {
      if (codes.some((c) => (USER_IDENTITY_GROUPS as readonly string[]).includes(groupOfIdentity(c)))) return true;
    } else if (target.length === 1) {
      if (codes.some((c) => groupOfIdentity(c) === target)) return true;
    } else if (codes.includes(target as IdentityCode)) {
      return true;
    }
  }
  return false;
}

/** Expands an audience list to the codes it covers. */
export function expandAudience(audience: readonly IdentityTarget[]): IdentityCode[] {
  const out = new Set<IdentityCode>();
  for (const target of audience) {
    if (target === "ALL") IDENTITIES.filter((d) => !getIdentityGroup(d.group).supplySide).forEach((d) => out.add(d.code));
    else if (target.length === 1) identitiesInGroup(target as IdentityGroup).forEach((d) => out.add(d.code));
    else out.add(target as IdentityCode);
  }
  return IDENTITY_CODES.filter((c) => out.has(c));
}

export interface IdentityCueMatch {
  code: IdentityCode;
  score: number;
  hits: string[];
}

let compiledCues: { code: IdentityCode; cues: { phrase: string; compiled: CompiledPhrase }[] }[] | null = null;

function cues() {
  if (!compiledCues) {
    compiledCues = IDENTITIES.map((d) => ({
      code: d.code,
      cues: [...d.cues.en, ...d.cues.zh]
        .map((phrase) => ({ phrase, compiled: compilePhrase(phrase) }))
        .filter((x): x is { phrase: string; compiled: CompiledPhrase } => x.compiled !== null),
    }));
  }
  return compiledCues;
}

/**
 * Scans a document (résumé text, bio, deck) for identity cues. Multi-word or 3+ character
 * Chinese cues weigh 2, single words 1. Supply-side codes (I*) are excluded unless asked.
 * This is a hint for pre-selection; the person always confirms.
 */
export function matchIdentityCues(text: string, opts: { includeSupplySide?: boolean; limit?: number } = {}): IdentityCueMatch[] {
  const prepared = prepareText(text.slice(0, 50_000));
  const out: IdentityCueMatch[] = [];
  for (const entry of cues()) {
    if (!opts.includeSupplySide && groupOfIdentity(entry.code) === "I") continue;
    const hits: string[] = [];
    let score = 0;
    for (const cue of entry.cues) {
      if (!containsPhrase(prepared, cue.compiled)) continue;
      hits.push(cue.phrase);
      const strong = cue.compiled.kind === "latin" ? cue.compiled.tokens.length > 1 : cue.compiled.compact.length >= 3;
      score += strong ? 2 : 1;
    }
    if (hits.length) out.push({ code: entry.code, score, hits });
  }
  out.sort((a, b) => b.score - a.score || IDENTITY_CODES.indexOf(a.code) - IDENTITY_CODES.indexOf(b.code));
  return out.slice(0, opts.limit ?? 10);
}
