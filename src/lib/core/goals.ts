/**
 * Goal taxonomy (plan §4): 12 families and every sub-goal, each with the opportunity types it
 * pursues, its primary channel (plus fallbacks), the materials it needs, how much of it the
 * platform can carry out, and who it is for (`audience`: "ALL", a group or a single code).
 *
 * Automation follows the plan; where the plan says "低到中" (low to medium) we record `low`,
 * so the product never promises more than it can do.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { audienceIncludes, outreachAllowed } from "./identities";
import { getChannel } from "./channels";
import { createPhraseMatcher, type MatchOptions, type PhraseMatch } from "./text";
import {
  GOAL_FAMILIES,
  IDENTITY_GROUPS,
  SUB_GOAL_IDS,
  USER_IDENTITY_GROUPS,
  automationLevelSchema,
  channelIdSchema,
  goalFamilySchema,
  identityGroupSchema,
  identityTargetSchema,
  materialIdSchema,
  opportunityTypeIdSchema,
  subGoalIdSchema,
  type AutomationLevel,
  type ChannelId,
  type GoalFamily,
  type IdentityCode,
  type IdentityGroup,
  type IdentityTarget,
  type MaterialId,
  type OpportunityTypeId,
  type SubGoalId,
} from "./types";

export interface GoalFamilyDef {
  id: GoalFamily;
  label: Bilingual;
  description: Bilingual;
  /** lucide icon name. */
  icon: string;
}

export interface SubGoalDef {
  id: SubGoalId;
  family: GoalFamily;
  label: Bilingual;
  description: Bilingual;
  /** Empty only for G12.1 (custom goals discover opportunities dynamically). */
  opportunityTypes: OpportunityTypeId[];
  defaultChannel: ChannelId;
  fallbackChannels: ChannelId[];
  materials: MaterialId[];
  automation: AutomationLevel;
  /** Precise audience from the plan ("ALL", groups, or codes such as S5, E2…E5). */
  audience: IdentityTarget[];
  /** Identity groups covered by `audience` (ALL = every person-side group). */
  identities: IdentityGroup[];
}

export const goalFamilyDefSchema = z.object({
  id: goalFamilySchema,
  label: bilingualSchema,
  description: bilingualSchema,
  icon: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});

export const subGoalDefSchema = z.object({
  id: subGoalIdSchema,
  family: goalFamilySchema,
  label: bilingualSchema,
  description: bilingualSchema,
  opportunityTypes: z.array(opportunityTypeIdSchema),
  defaultChannel: channelIdSchema,
  fallbackChannels: z.array(channelIdSchema),
  materials: z.array(materialIdSchema),
  automation: automationLevelSchema,
  audience: z.array(identityTargetSchema).min(1),
  identities: z.array(identityGroupSchema).min(1),
});

export const GOAL_FAMILY_DEFS: readonly GoalFamilyDef[] = [
  { id: "G1", label: bi("Jobs & employment", "求职与就业"), icon: "briefcase",
    description: bi("Land a job: full-time, internships, campus hiring, remote, referrals, headhunters, part-time and public-sector roles.", "拿到工作：社招、实习、校招、远程、内推、猎头、兼职与体制内岗位。") },
  { id: "G2", label: bi("Career growth", "职业发展"), icon: "trending-up",
    description: bi("Move up or move across: promotion, certification, courses, mentors, talks and awards.", "向上或横向发展：晋升、认证、课程、导师、演讲与奖项。") },
  { id: "G3", label: bi("Startup", "创业"), icon: "rocket",
    description: bi("Build a company: co-founders, funding, programs, competitions, trade shows, customers, PR and hiring.", "把公司做起来：合伙人、融资、孵化加速、比赛、展会、客户、媒体与招人。") },
  { id: "G4", label: bi("Academia & research", "学术与研究"), icon: "microscope",
    description: bi("Advance your research: submissions, grants, positions, visits, collaborators, academic service and awards.", "推进学术：投稿、基金、职位、访学、合作、学术服务与奖项。") },
  { id: "G5", label: bi("Admissions & study abroad", "升学与留学"), icon: "graduation-cap",
    description: bi("Get into the right program: admissions, scholarships, exchanges, tests and visas.", "申请合适的学校与项目：录取、奖学金、交换、考试与签证。") },
  { id: "G6", label: bi("Freelance & creative work", "自由职业与创作"), icon: "image",
    description: bi("Win paid creative and freelance work: clients, platforms, brands, residencies and open calls.", "拿到创作与自由职业的机会：客户、平台、品牌、驻留与征集。") },
  { id: "G7", label: bi("Personal brand & influence", "个人品牌与影响力"), icon: "mic",
    description: bi("Be heard: talks, articles, podcasts, a book, lists and awards.", "让更多人听到你：演讲、文章、播客、出书、榜单与奖项。") },
  { id: "G8", label: bi("Personal funding", "资金与资源（个人）"), icon: "coins",
    description: bi("Fund yourself: fellowships, personal subsidies, prize competitions and micro-grants.", "为自己争取资金：Fellowship、个人补贴、竞赛奖金与微基金。") },
  { id: "G9", label: bi("Mobility & going global", "迁移与国际化"), icon: "plane",
    description: bi("Move across borders: visa routes, returnee programs and overseas market entry.", "跨越国界：签证路径、回国人才政策与海外落地。") },
  { id: "G10", label: bi("Network & community", "人脉与社群"), icon: "users-round",
    description: bi("Build your network: associations, events and mentors.", "拓展人脉：协会社群、行业活动与导师。") },
  { id: "G11", label: bi("Social impact", "公益与社会影响"), icon: "heart-handshake",
    description: bi("Do good: volunteering, social innovation and international organisations.", "投身公益：志愿服务、社会创新与国际组织。") },
  { id: "G12", label: bi("Custom goal", "自定义目标"), icon: "compass",
    description: bi("Describe any goal in a sentence; we map it to a known goal or search for it specifically.", "用一句话描述任何目标，我们会匹配已有目标，或专门为你搜索。") },
];

type Row = [
  id: SubGoalId,
  label: Bilingual,
  description: Bilingual,
  types: OpportunityTypeId[],
  channels: [ChannelId, ...ChannelId[]],
  materials: MaterialId[],
  automation: AutomationLevel,
  audience: IdentityTarget[],
];

const E3_UP: IdentityTarget[] = ["E3", "E4", "E5"];

const ROWS: Row[] = [
  /* ------------------------------------------------------------ G1 jobs */
  ["G1.1", bi("Full-time job (experienced hire)", "全职岗位（社招）"),
    bi("Tailored applications to full-time roles that fit your experience, sent through the company's own hiring system where possible.", "为匹配你经验的全职岗位逐一定制申请，能直连企业招聘系统的直接投递。"),
    ["job", "remote_job"], ["CH1", "CH2", "CH4", "CH6"], ["resume_variant", "cover_letter", "portfolio"], "high", ["E", "T", "S5", "P"]],
  ["G1.2", bi("Internship", "实习"),
    bi("Internships matched to your major, graduation date and the months you can work.", "按专业、毕业时间和可实习时长匹配实习岗位。"),
    ["internship"], ["CH1", "CH2", "CH4", "CH6"], ["resume_variant", "transcript", "cover_letter"], "high", ["S"]],
  ["G1.3", bi("Campus hiring & management trainee programs", "校招与管培生"),
    bi("Campus and trainee programs; for hiring systems that need your own account and assessments, everything is prepared for you.", "校招与管培生项目；对需要本人账号和测评的校招系统，材料与准备都提前做好。"),
    ["graduate_program"], ["CH6"], ["resume_variant", "interview_prep"], "medium", ["S"]],
  ["G1.4", bi("Remote & overseas jobs", "远程与海外岗位"),
    bi("Remote roles and jobs abroad that match your visa or work-permit situation.", "匹配你签证与工作许可情况的远程岗位和海外岗位。"),
    ["remote_job", "job"], ["CH1", "CH2"], ["resume_variant", "cover_letter"], "high", ["ALL"]],
  ["G1.5", bi("Referrals", "内推"),
    bi("Find people who can refer you and send each one a short, personal request.", "找到能为你内推的人，并给每个人发一封简短、个性化的请求。"),
    ["referral"], ["CH4", "CH5"], ["resume_variant", "outreach_email"], "medium", ["ALL"]],
  ["G1.6", bi("Working with headhunters", "猎头合作"),
    bi("Introduce yourself to headhunters who place people at your level.", "向擅长你这一层级的猎头介绍自己。"),
    ["recruiter"], ["CH4"], ["resume_variant", "outreach_email"], "high", ["E2", "E3", "E4", "E5"]],
  ["G1.7", bi("Part-time & gig work", "兼职与零工"),
    bi("Part-time roles, shifts and gigs that fit around your schedule.", "能安排进你时间表的兼职、排班与零工。"),
    ["part_time", "freelance_project"], ["CH2", "CH6"], ["resume"], "medium", ["S", "C", "T"]],
  ["G1.8", bi("Civil service, public institution & SOE recruitment", "政府、事业单位、国企招考"),
    bi("Recruitment announcements tracked and materials prepared; you register on the official system.", "跟踪招考公告、准备报名材料，在官方报名系统由你本人操作。"),
    ["public_sector_exam"], ["CH6", "CH5"], ["application_form"], "low", ["E6", "S", "T"]],
  ["G1.9", bi("Returnships", "重返职场计划（returnship）"),
    bi("Paid return-to-work programs after a career break.", "职业空窗后的带薪重返职场项目。"),
    ["returnship"], ["CH2"], ["resume_variant"], "high", ["T6"]],
  ["G1.10", bi("Disability employment programs", "残障就业专项"),
    bi("Employers and programs with dedicated hiring for people with disabilities.", "面向残障人士的专项招聘与就业项目。"),
    ["job", "remote_job", "part_time"], ["CH2", "CH4"], ["resume_variant"], "high", ["T8"]],

  /* ------------------------------------------------------------ G2 career growth */
  ["G2.1", bi("Promotion & raise", "晋升与加薪"),
    bi("A promotion case built from your record, plus a script for the pay conversation.", "根据你的业绩整理晋升材料，并准备加薪谈话脚本。"),
    ["internal_role"], ["CH5"], ["performance_record", "promotion_case", "negotiation_script"], "docs", ["E"]],
  ["G2.2", bi("Internal transfer", "转岗"),
    bi("A transfer request for the internal role you want.", "为你想去的内部岗位准备转岗申请。"),
    ["internal_role"], ["CH5"], ["transfer_request"], "docs", ["E"]],
  ["G2.3", bi("Career change", "转行"),
    bi("A path into a new field: a transition résumé, bridge courses and roles that value what you already have.", "转入新领域的路径：转型简历、衔接课程，以及看重你现有能力的岗位。"),
    ["job", "internship", "course", "certification", "mentorship"], ["CH1", "CH2", "CH4", "CH6"], ["resume_variant", "cover_letter"], "high", ["T2", "E"]],
  ["G2.4", bi("Professional certification (PMP, CFA, AWS, CPA…)", "技能认证（PMP、CFA、AWS、CPA 等）"),
    bi("Exam dates, eligibility and registration materials; you pay on the official site.", "考期、报考条件与报名材料；费用在官网由你本人支付。"),
    ["certification"], ["CH6"], ["application_form", "study_plan"], "medium", ["ALL"]],
  ["G2.5", bi("Training, courses & bootcamps", "培训、课程、训练营"),
    bi("Training programs and bootcamps, including scholarship and funded seats.", "培训项目与训练营，包括奖学金和资助名额。"),
    ["course"], ["CH2", "CH6"], ["application_form"], "high", ["ALL"]],
  ["G2.6", bi("Mentorship programs", "导师计划"),
    bi("Programs that match you with someone a few steps ahead.", "为你匹配领先几步的导师的项目。"),
    ["mentorship"], ["CH2", "CH4"], ["short_bio"], "high", ["S", "E1", "F"]],
  ["G2.7", bi("Professional communities & associations", "行业社群与协会会员"),
    bi("Professional communities and associations worth joining.", "值得加入的行业社群与协会。"),
    ["community"], ["CH2"], ["short_bio"], "high", ["ALL"]],
  ["G2.8", bi("Talks & speaking", "演讲与分享"),
    bi("Talks at conferences and meetups, with a proposal and speaker bio written for each.", "在行业会议和 Meetup 上演讲，逐个写好演讲提案与讲者简介。"),
    ["speaking"], ["CH2", "CH4"], ["talk_proposal", "speaker_bio"], "high", [...E3_UP, "R", "F", "C"]],
  ["G2.9", bi("Industry awards (40 under 40…)", "行业奖项（40 under 40 等）"),
    bi("Industry awards and \"40 under 40\" style lists, with nomination materials.", "行业奖项与「40 under 40」类榜单，并准备提名材料。"),
    ["award"], ["CH2"], ["nomination_packet"], "high", ["E", "F", "R", "C"]],

  /* ------------------------------------------------------------ G3 startup */
  ["G3.1", bi("Find a co-founder", "找合伙人"),
    bi("Co-founder matching programs and founder communities.", "合伙人匹配项目与创业者社群。"),
    ["cofounder_match", "community"], ["CH2", "CH4"], ["one_pager"], "medium", ["F1", "F2"]],
  ["G3.2", bi("Raise funding (angels, VCs)", "融资（天使、VC）"),
    bi("Investors who back your stage and sector, each contacted with a personal email from your own Gmail.", "投资你所在阶段和赛道的投资人，从你自己的 Gmail 逐一发出个性化邮件。"),
    ["investor"], ["CH4", "CH2"], ["pitch_deck", "one_pager", "financial_summary"], "high", ["F2", "F3"]],
  ["G3.3", bi("Government funds, subsidies & certifications", "政府引导基金、补贴与资质"),
    bi("Government funds, subsidies and certifications (high-tech enterprise, specialised SME, talent programs, startup subsidies); you file on the official portal.", "政府引导基金、补贴与资质（高新、专精特新、人才计划、创业补贴）；在政务系统由你本人申报。"),
    ["government_program", "grant"], ["CH6", "CH5"], ["grant_application"], "low", ["F"]],
  ["G3.4", bi("Incubators, accelerators & founder programs", "孵化器、加速器、创业营"),
    bi("Incubators, accelerators and founder programs that fit your stage.", "适合你所处阶段的孵化器、加速器与创业营。"),
    ["accelerator", "incubator"], ["CH2", "CH3", "CH6"], ["pitch_deck", "business_plan", "demo_video"], "high", ["F"]],
  ["G3.5", bi("Startup competitions & pitch events", "创业比赛与路演"),
    bi("Competitions and pitch events with prizes or investor exposure.", "有奖金或投资人曝光的创业比赛与路演活动。"),
    ["startup_competition", "pitch_event"], ["CH2", "CH3", "CH6"], ["pitch_deck", "business_plan"], "high", ["F", "S", "R"]],
  ["G3.6", bi("Trade shows (exhibit, pitch, speak, attend)", "展会（参展、路演、演讲、观展）"),
    bi("Trade shows where you can exhibit, pitch, speak or attend.", "可以参展、路演、演讲或观展的展会。"),
    ["exhibition"], ["CH2", "CH4"], ["company_profile", "product_images"], "high", ["F"]],
  ["G3.7", bi("Crowdfunding", "众筹"),
    bi("Platform choice, page copy and video script; you launch the campaign.", "选平台、写页面文案和视频脚本，由你发起项目。"),
    ["crowdfunding"], ["CH6", "CH5"], ["campaign_copy"], "medium", ["F", "C"]],
  ["G3.8", bi("Loans & credit (information and documents)", "贷款与信用（信息与材料）"),
    bi("Small-business loan and credit options with a document checklist.", "小微企业贷款与信贷选项，附材料清单。"),
    ["loan"], ["CH5"], ["document_checklist"], "low", ["F6"]],
  ["G3.9", bi("Customers, channels & distributors", "找客户、渠道、经销商"),
    bi("Potential customers, channel partners and distributors, contacted one by one.", "潜在客户、渠道伙伴与经销商，逐一联系。"),
    ["client_lead"], ["CH4"], ["company_profile"], "high", ["F"]],
  ["G3.10", bi("Media coverage & PR", "媒体曝光与 PR"),
    bi("Journalists, podcasts and lists for your news, with a press release and founder bio.", "为你的消息对接记者、播客与榜单，并准备新闻稿和创始人简介。"),
    ["media", "podcast", "award"], ["CH4", "CH2"], ["press_release", "founder_bio"], "high", ["F"]],
  ["G3.11", bi("Hiring", "招人"),
    bi("Places to post your roles and meet candidates, with job descriptions written.", "发布职位、接触候选人的渠道，并写好职位描述。"),
    ["hiring_channel"], ["CH2"], ["job_description"], "medium", ["F"]],
  ["G3.12", bi("Going global & overseas markets", "出海与海外市场"),
    bi("Overseas trade shows, programs and market-entry schemes, with English materials.", "海外展会、项目与落地计划，并准备英文材料。"),
    ["exhibition", "accelerator", "government_program", "pitch_event"], ["CH2", "CH4"], ["pitch_deck", "company_profile"], "high", ["F"]],
  ["G3.13", bi("Legal, finance, tax & compliance providers", "法律、财税、合规服务匹配"),
    bi("Quotes from legal, tax and compliance providers, from one brief.", "用一份需求说明向法律、财税与合规服务商询价。"),
    ["service_provider"], ["CH4"], ["requirements_brief"], "medium", ["F"]],

  /* ------------------------------------------------------------ G4 academia */
  ["G4.1", bi("Conference submissions (CFP)", "会议投稿（CFP）"),
    bi("Conferences open for submission in your field; you submit on OpenReview, EasyChair or CMT with everything prepared.", "你所在领域正在征稿的会议；在 OpenReview、EasyChair 或 CMT 上由你提交，材料都已备好。"),
    ["conference_cfp"], ["CH6", "CH5"], ["paper", "abstract"], "medium", ["R", "S4"]],
  ["G4.2", bi("Journal submissions", "期刊投稿"),
    bi("A journal shortlist and cover letter; you submit through the journal's system.", "期刊推荐与投稿信；在期刊系统由你提交。"),
    ["journal"], ["CH6", "CH5"], ["paper", "cover_letter"], "medium", ["R"]],
  ["G4.3", bi("Research grants (NSFC, national & industry funds)", "基金与课题（NSFC、各国基金、企业基金）"),
    bi("Research grants with application drafts; you file on the funder's system.", "科研基金及申报书草稿；在资助方系统由你申报。"),
    ["grant"], ["CH6", "CH5"], ["grant_application", "cv"], "low", ["R"]],
  ["G4.4", bi("PhD & postdoc applications", "申博与博后"),
    bi("PhD and postdoc openings, with a personal email to each supervisor.", "博士与博士后机会，并给每位导师写一封个性化邮件。"),
    ["phd_position", "postdoc"], ["CH4", "CH2"], ["cv", "research_statement", "recommendation_letters"], "high", ["S3", "S4", "R1"]],
  ["G4.5", bi("Visiting scholar & academic exchange", "访问学者与学术交流"),
    bi("Visiting-scholar and exchange programs, with a research plan.", "访问学者与学术交流项目，并准备研究计划。"),
    ["visiting_scholar", "exchange_program"], ["CH4", "CH2"], ["cv", "research_proposal"], "high", ["R"]],
  ["G4.6", bi("Find collaborators", "找合作者"),
    bi("Researchers working on related problems, contacted with a short research summary.", "联系研究相近问题的学者，附上简短的研究介绍。"),
    ["collaborator"], ["CH4"], ["research_statement"], "high", ["R"]],
  ["G4.7", bi("Invited talks, reviewing & editorial boards", "会议演讲、评审、编委"),
    bi("Invited talks, reviewing and editorial-board openings.", "受邀报告、审稿与编委机会。"),
    ["speaking", "editorial_role"], ["CH4", "CH2"], ["cv"], "high", ["R2", "R3"]],
  ["G4.8", bi("Academic awards", "学术奖项"),
    bi("Academic awards and prizes, with nomination materials.", "学术奖项，并准备提名材料。"),
    ["award"], ["CH2"], ["nomination_packet"], "high", ["R"]],
  ["G4.9", bi("Industry partnerships & tech transfer", "产学研与技术转化"),
    bi("Companies and tech-transfer offices interested in your research.", "对你的研究感兴趣的企业与技术转移机构。"),
    ["industry_partnership"], ["CH4"], ["one_pager"], "medium", ["R", "F"]],

  /* ------------------------------------------------------------ G5 admissions */
  ["G5.1", bi("Bachelor's, master's & PhD admissions", "本科、硕士、博士申请"),
    bi("Essays and documents prepared; you submit on Common App or each school's portal.", "文书与材料备好；在 Common App 或各校系统由你提交。"),
    ["degree_program"], ["CH6", "CH5"], ["personal_statement", "cv", "recommendation_letters", "transcript"], "medium", ["S"]],
  ["G5.2", bi("Scholarships & financial aid", "奖学金与助学金"),
    bi("Scholarships and financial aid you are eligible for.", "你符合条件的奖学金与助学金。"),
    ["scholarship"], ["CH2"], ["personal_statement"], "high", ["S"]],
  ["G5.3", bi("Exchange, summer school & summer camps", "交换、暑校、夏令营"),
    bi("Exchange semesters, summer schools and summer camps.", "交换学期、暑期学校与夏令营。"),
    ["exchange_program"], ["CH2"], ["application_form"], "high", ["S"]],
  ["G5.4", bi("Language & standardized test registration", "语言与标化考试报名"),
    bi("Test dates with a preparation plan; you register and pay.", "考期与备考规划；由你本人报名并缴费。"),
    ["standardized_test"], ["CH6"], ["study_plan"], "low", ["S"]],
  ["G5.5", bi("Visa documents", "签证材料准备"),
    bi("A visa document checklist for your destination.", "针对目的地的签证材料清单。"),
    ["visa_pathway"], ["CH5"], ["document_checklist"], "low", ["S6", "T4"]],

  /* ------------------------------------------------------------ G6 freelance & creative */
  ["G6.1", bi("Freelance platforms (Upwork, Fiverr, Toptal…)", "平台接单（Upwork、Fiverr、Toptal、猪八戒、特赞等）"),
    bi("Projects on freelance platforms with proposals written; you send them from your own account.", "自由职业平台上的项目并写好提案；由你在自己的账号里发送。"),
    ["freelance_project"], ["CH6", "CH5"], ["project_proposal", "portfolio"], "medium", ["C"]],
  ["G6.2", bi("Direct client outreach", "直客外联"),
    bi("Companies that need your work, contacted one by one with your portfolio.", "需要你作品的公司，附上作品集逐一联系。"),
    ["client_lead"], ["CH4"], ["portfolio"], "high", ["C"]],
  ["G6.3", bi("Brand partnerships & sponsorships", "品牌合作与赞助"),
    bi("Brand creator programs and sponsorships that fit your audience.", "契合你受众的品牌创作者计划与赞助合作。"),
    ["brand_partnership"], ["CH4", "CH2"], ["media_kit"], "high", ["C4"]],
  ["G6.4", bi("Residencies, creative grants & art prizes", "驻留、创作基金、艺术奖项"),
    bi("Residencies, creative grants and art prizes.", "驻留项目、创作基金与艺术奖项。"),
    ["residency", "grant", "award"], ["CH2"], ["portfolio", "artist_statement"], "high", ["C1", "C2", "C5"]],
  ["G6.5", bi("Platform, agency & publisher deals (MCN…)", "平台入驻与签约（MCN、经纪、出版社）"),
    bi("Platforms, MCNs, agencies and publishers that sign creators.", "签约创作者的平台、MCN、经纪公司与出版社。"),
    ["platform_signing"], ["CH2", "CH4"], ["short_bio", "media_kit"], "high", ["C"]],
  ["G6.6", bi("Submissions, exhibitions & competitions", "作品投稿、展览、比赛"),
    bi("Open calls, exhibitions and competitions for your work.", "适合你作品的征集、展览与比赛。"),
    ["open_call", "competition", "award"], ["CH2", "CH4"], ["work_samples"], "high", ["C"]],
  ["G6.7", bi("Licensing & stock marketplaces", "版权授权与素材库入驻"),
    bi("Stock libraries and licensing marketplaces that accept contributors.", "接受投稿者入驻的素材库与版权授权平台。"),
    ["licensing"], ["CH2"], ["work_samples"], "high", ["C3", "C5"]],

  /* ------------------------------------------------------------ G7 influence */
  ["G7.1", bi("Speaking (TEDx, industry conferences)", "演讲（TEDx、行业大会）"),
    bi("Speaking slots with a talk proposal written for each.", "演讲机会，并逐一写好演讲提案。"),
    ["speaking"], ["CH2"], ["talk_proposal"], "high", ["ALL"]],
  ["G7.2", bi("Columns, bylines & guest articles", "专栏、投稿、客座文章"),
    bi("Columns, op-eds and guest articles, pitched to each editor.", "专栏、评论与客座文章，逐一向编辑投稿。"),
    ["media"], ["CH4", "CH2"], ["article"], "high", ["ALL"]],
  ["G7.3", bi("Podcast guest spots", "播客嘉宾"),
    bi("Podcasts that would want you as a guest.", "会邀请你做嘉宾的播客。"),
    ["podcast"], ["CH4"], ["short_bio"], "high", ["ALL"]],
  ["G7.4", bi("Publish a book", "出书"),
    bi("Publishers and literary agents, with a book proposal.", "出版社与版权经纪人，并准备出版提案。"),
    ["book_publisher"], ["CH4"], ["book_proposal"], "high", ["ALL"]],
  ["G7.5", bi("Lists & awards", "榜单与奖项"),
    bi("Lists and awards you can be nominated for.", "你可以被提名的榜单与奖项。"),
    ["award"], ["CH2"], ["nomination_packet"], "high", ["ALL"]],

  /* ------------------------------------------------------------ G8 personal funding */
  ["G8.1", bi("Fellowships", "Fellowship 项目"),
    bi("Fellowships that fund people like you.", "资助像你这样的人的 Fellowship 项目。"),
    ["fellowship"], ["CH2"], ["personal_statement"], "high", ["ALL"]],
  ["G8.2", bi("Personal subsidies & talent programs", "个人补贴与人才计划（各国各地）"),
    bi("Personal subsidies and talent programs where you live or want to live; you file on the official system.", "你所在地或目标城市的个人补贴与人才计划；在官方系统由你本人申报。"),
    ["government_program"], ["CH6", "CH5"], ["grant_application"], "low", ["ALL"]],
  ["G8.3", bi("Prize competitions (coding, design, writing, hackathons)", "竞赛奖金（编程、设计、写作、黑客松）"),
    bi("Coding, design and writing competitions and hackathons with prizes.", "有奖金的编程、设计、写作竞赛与黑客松。"),
    ["competition", "hackathon"], ["CH2"], ["application_form"], "high", ["S", "C", "F"]],
  ["G8.4", bi("Creative grants & micro-grants", "创作基金与微基金"),
    bi("Creative grants and micro-grants.", "创作基金与微基金。"),
    ["grant"], ["CH2"], ["project_proposal"], "high", ["C", "R"]],

  /* ------------------------------------------------------------ G9 mobility */
  ["G9.1", bi("Work visa pathways abroad (O-1, H-1B, Global Talent…)", "海外工作签证路径（O-1、H-1B、Global Talent、各国人才签）"),
    bi("Visa routes that fit your record, with an evidence checklist; an immigration lawyer files.", "适合你履历的签证路径及证据清单；由移民律师递交。"),
    ["visa_pathway"], ["CH5"], ["evidence_list"], "low", ["ALL"]],
  ["G9.2", bi("Returnee talent policies", "回国人才政策"),
    bi("Returnee talent programs and the documents they need; you file on the official system.", "回国人才政策及所需材料；在官方系统由你本人申报。"),
    ["government_program"], ["CH6", "CH5"], ["grant_application"], "low", ["T3"]],
  ["G9.3", bi("Overseas trade shows, roadshows & market entry", "海外展会、路演、落地"),
    bi("Overseas trade shows, roadshows and market-entry programs.", "海外展会、路演与落地项目。"),
    ["exhibition", "pitch_event", "accelerator", "government_program"], ["CH2", "CH4"], ["pitch_deck", "company_profile"], "high", ["F"]],

  /* ------------------------------------------------------------ G10 network */
  ["G10.1", bi("Alumni associations, professional bodies & chambers", "校友会、协会、商会"),
    bi("Alumni associations, professional bodies and chambers of commerce.", "校友会、行业协会与商会。"),
    ["community"], ["CH2"], ["short_bio"], "high", ["ALL"]],
  ["G10.2", bi("Industry events & summits (incl. free & sponsored tickets)", "行业活动与峰会（含免费票与资助票）"),
    bi("Industry events and summits, including free and sponsored tickets.", "行业活动与峰会，包括免费票和资助票。"),
    ["event"], ["CH2"], ["application_form"], "high", ["ALL"]],
  ["G10.3", bi("Mentors & mentees", "导师与被导"),
    bi("Find a mentor, or mentor others.", "找导师，或成为别人的导师。"),
    ["mentorship"], ["CH2", "CH4"], ["short_bio"], "high", ["ALL"]],

  /* ------------------------------------------------------------ G11 social impact */
  ["G11.1", bi("Volunteering & nonprofit roles", "志愿者与公益岗位"),
    bi("Volunteer programs and nonprofit roles.", "志愿者项目与公益岗位。"),
    ["volunteer"], ["CH2"], ["resume"], "high", ["ALL"]],
  ["G11.2", bi("Social innovation competitions & funds", "社会创新比赛与基金"),
    bi("Social innovation competitions and funds.", "社会创新比赛与基金。"),
    ["startup_competition", "competition", "grant"], ["CH2"], ["project_proposal"], "high", ["F8", "S"]],
  ["G11.3", bi("NGO & international organisation jobs (UN…)", "NGO 与国际组织岗位（联合国等）"),
    bi("Jobs at NGOs and international organisations; you apply on their official systems.", "NGO 与国际组织的岗位；在其官方系统由你本人提交。"),
    ["ngo_job"], ["CH6", "CH5"], ["resume_variant"], "medium", ["ALL"]],

  /* ------------------------------------------------------------ G12 custom */
  ["G12.1", bi("Custom goal", "自定义目标"),
    bi("Tell us the goal in one sentence; we map it to the closest goal or search for opportunities specifically.", "用一句话告诉我们你的目标，我们会匹配最接近的目标，或专门为你搜索机会。"),
    [], ["CH6"], [], "medium", ["ALL"]],
];

function groupsForAudience(audience: readonly IdentityTarget[]): IdentityGroup[] {
  const set = new Set<IdentityGroup>();
  for (const t of audience) {
    if (t === "ALL") USER_IDENTITY_GROUPS.forEach((g) => set.add(g));
    else set.add(t[0] as IdentityGroup);
  }
  return IDENTITY_GROUPS.filter((g) => set.has(g));
}

export const SUB_GOALS: readonly SubGoalDef[] = ROWS.map(([id, label, description, opportunityTypes, channels, materials, automation, audience]) => ({
  id,
  family: id.slice(0, id.indexOf(".")) as GoalFamily,
  label,
  description,
  opportunityTypes,
  defaultChannel: channels[0],
  fallbackChannels: channels.slice(1),
  materials,
  automation,
  audience,
  identities: groupsForAudience(audience),
}));

const FAMILY_BY_ID = new Map<string, GoalFamilyDef>(GOAL_FAMILY_DEFS.map((f) => [f.id, f]));
const SUB_BY_ID = new Map<string, SubGoalDef>(SUB_GOALS.map((s) => [s.id, s]));

export function isGoalFamily(value: unknown): value is GoalFamily {
  return typeof value === "string" && (GOAL_FAMILIES as readonly string[]).includes(value);
}

export function isSubGoalId(value: unknown): value is SubGoalId {
  return typeof value === "string" && (SUB_GOAL_IDS as readonly string[]).includes(value);
}

export function getGoalFamily(id: GoalFamily): GoalFamilyDef {
  const def = FAMILY_BY_ID.get(id);
  if (!def) throw new Error(`Unknown goal family: ${id}`);
  return def;
}

export function getSubGoal(id: SubGoalId): SubGoalDef {
  const def = SUB_BY_ID.get(id);
  if (!def) throw new Error(`Unknown sub-goal: ${id}`);
  return def;
}

export function subGoalsOf(family: GoalFamily): SubGoalDef[] {
  return SUB_GOALS.filter((s) => s.family === family);
}

export function goalFamilyLabel(id: GoalFamily, locale: Locale | string): string {
  return localize(getGoalFamily(id).label, locale);
}

export function subGoalLabel(id: SubGoalId, locale: Locale | string): string {
  return localize(getSubGoal(id).label, locale);
}

/** Sub-goals that pursue a given opportunity type (e.g. `accelerator` → G3.4, G3.12, G9.3). */
export function subGoalsForOpportunityType(type: OpportunityTypeId): SubGoalDef[] {
  return SUB_GOALS.filter((s) => s.opportunityTypes.includes(type));
}

/** Union of opportunity types a family pursues, in sub-goal order. */
export function opportunityTypesOfFamily(family: GoalFamily): OpportunityTypeId[] {
  const out: OpportunityTypeId[] = [];
  for (const s of subGoalsOf(family)) for (const t of s.opportunityTypes) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * Whether a sub-goal is offered to a person with these identity codes: the audience must
 * include them, and minors (S1) never get a sub-goal whose only way to act is outreach (CH4).
 */
export function subGoalAppliesTo(id: SubGoalId, codes: readonly IdentityCode[]): boolean {
  const def = getSubGoal(id);
  if (!audienceIncludes(def.audience, codes)) return false;
  if (!outreachAllowed(codes)) {
    const usable = [def.defaultChannel, ...def.fallbackChannels].filter((c) => !getChannel(c).outreach);
    if (!usable.length) return false;
  }
  return true;
}

let matcher: ReturnType<typeof createPhraseMatcher> | null = null;

/**
 * Maps a one-sentence goal ("I want to raise a seed round", "想申请美国博士") to sub-goals.
 * Used for G12 custom goals before falling back to targeted search.
 */
export function mapGoalText(text: string, opts: MatchOptions = {}): PhraseMatch[] {
  matcher ??= createPhraseMatcher(
    SUB_GOALS.filter((s) => s.id !== "G12.1").map((s) => ({
      code: s.id,
      phrases: [s.label.en, s.label.zh, ...GOAL_KEYWORDS[s.id as Exclude<SubGoalId, "G12.1">]],
    })),
  );
  return matcher(text, { limit: opts.limit ?? 3, minScore: opts.minScore ?? 0.4 });
}

/** Extra phrases people use for each sub-goal (English and Chinese). */
const GOAL_KEYWORDS: Record<Exclude<SubGoalId, "G12.1">, string[]> = {
  "G1.1": ["find a job", "new job", "get hired", "job offer", "找工作", "跳槽", "社招", "换工作"],
  "G1.2": ["internship", "summer internship", "找实习", "实习"],
  "G1.3": ["campus recruiting", "graduate scheme", "management trainee", "校招", "秋招", "春招", "管培生"],
  "G1.4": ["remote job", "work remotely", "work abroad", "远程工作", "海外工作", "出海工作"],
  "G1.5": ["referral", "get referred", "内推"],
  "G1.6": ["headhunter", "recruiter", "猎头"],
  "G1.7": ["part time job", "side gig", "兼职", "零工"],
  "G1.8": ["civil service exam", "government job", "公务员", "考公", "考编", "事业编", "国企招聘"],
  "G1.9": ["returnship", "return to work", "重返职场"],
  "G1.10": ["disability employment", "残障就业"],
  "G2.1": ["promotion", "pay raise", "get promoted", "升职", "加薪", "晋升"],
  "G2.2": ["internal transfer", "change team", "转岗", "内部转岗"],
  "G2.3": ["career change", "switch careers", "change industry", "转行", "换行业"],
  "G2.4": ["certification", "pmp", "cfa", "cpa", "aws certification", "考证", "认证考试"],
  "G2.5": ["bootcamp", "online course", "training program", "训练营", "培训课程"],
  "G2.6": ["find a mentor", "mentorship", "找导师", "导师计划"],
  "G2.7": ["join an association", "professional association", "加入协会", "行业协会"],
  "G2.8": ["give a talk", "conference speaker", "做分享", "当讲者"],
  "G2.9": ["industry award", "40 under 40", "行业奖项"],
  "G3.1": ["find a cofounder", "co founder", "找合伙人", "联合创始人"],
  "G3.2": ["raise money", "fundraise", "seed round", "series a", "angel investment", "融资", "找投资", "天使轮", "种子轮"],
  "G3.3": ["government subsidy", "high tech enterprise", "政府补贴", "高新企业", "专精特新", "创业补贴", "人才计划"],
  "G3.4": ["accelerator", "incubator", "y combinator", "加速器", "孵化器", "创业营"],
  "G3.5": ["startup competition", "pitch competition", "创业大赛", "路演"],
  "G3.6": ["trade show", "expo", "exhibit at", "展会", "参展"],
  "G3.7": ["crowdfunding", "kickstarter", "众筹"],
  "G3.8": ["business loan", "small business loan", "贷款", "创业贷款"],
  "G3.9": ["find customers", "distributors", "sales leads", "找客户", "经销商", "渠道"],
  "G3.10": ["press coverage", "media coverage", "pr", "媒体报道", "公关"],
  "G3.11": ["hire engineers", "recruit team", "招人", "招聘团队"],
  "G3.12": ["expand overseas", "go global", "international expansion", "出海", "海外市场"],
  "G3.13": ["lawyer for startup", "accountant for startup", "注册公司", "财税服务", "合规服务"],
  "G4.1": ["submit a paper", "conference paper", "neurips", "iclr", "投会议", "会议论文"],
  "G4.2": ["journal publication", "publish in a journal", "期刊发表", "投期刊", "sci"],
  "G4.3": ["research grant", "nsfc", "nsf grant", "国自然", "申请基金", "课题申报"],
  "G4.4": ["apply for phd", "phd application", "postdoc position", "申博", "读博", "申请博士", "博士申请", "博后", "套磁"],
  "G4.5": ["visiting scholar", "academic visit", "访问学者", "访学"],
  "G4.6": ["research collaboration", "find collaborators", "科研合作"],
  "G4.7": ["reviewer", "editorial board", "invited talk", "审稿", "编委"],
  "G4.8": ["academic award", "research prize", "学术奖"],
  "G4.9": ["tech transfer", "industry collaboration", "产学研", "成果转化"],
  "G5.1": ["apply to university", "graduate school", "master's application", "college application", "申请研究生", "出国读研", "申请本科", "留学申请"],
  "G5.2": ["scholarship", "financial aid", "奖学金", "助学金"],
  "G5.3": ["exchange program", "summer school", "summer camp", "交换生", "暑校", "夏令营"],
  "G5.4": ["ielts", "toefl", "gre", "gmat", "雅思", "托福", "考试报名"],
  "G5.5": ["student visa", "visa documents", "签证材料", "学生签证"],
  "G6.1": ["upwork", "fiverr", "freelance gigs", "接单", "自由职业平台"],
  "G6.2": ["find clients", "client outreach", "找客户 自由职业", "直客"],
  "G6.3": ["brand deal", "sponsorship", "品牌合作", "商单"],
  "G6.4": ["artist residency", "creative grant", "art prize", "驻留", "艺术奖"],
  "G6.5": ["sign with an agency", "mcn", "签约", "经纪公司"],
  "G6.6": ["open call", "art exhibition", "submit my work", "投稿", "作品征集", "展览"],
  "G6.7": ["stock photos", "license my music", "素材库", "版权授权"],
  "G7.1": ["tedx", "keynote", "演讲", "ted演讲"],
  "G7.2": ["write for", "guest post", "op ed", "专栏", "客座文章"],
  "G7.3": ["podcast guest", "be on podcasts", "播客嘉宾", "上播客"],
  "G7.4": ["write a book", "book deal", "出书", "出版"],
  "G7.5": ["forbes 30 under 30", "top list", "上榜", "榜单"],
  "G8.1": ["fellowship"],
  "G8.2": ["talent program", "personal subsidy", "人才补贴", "落户补贴"],
  "G8.3": ["hackathon", "coding competition", "design competition", "黑客松", "竞赛"],
  "G8.4": ["micro grant", "creative fund", "微基金"],
  "G9.1": ["o 1 visa", "h 1b", "global talent visa", "work visa", "工作签证", "人才签证"],
  "G9.2": ["return to china", "returnee program", "回国", "归国人才"],
  "G9.3": ["overseas roadshow", "enter us market", "海外路演", "海外落地"],
  "G10.1": ["alumni association", "chamber of commerce", "校友会", "商会"],
  "G10.2": ["attend conferences", "industry summit", "networking events", "行业峰会", "参会"],
  "G10.3": ["mentor others", "become a mentor", "带新人", "当导师"],
  "G11.1": ["volunteer", "志愿者", "做公益"],
  "G11.2": ["social innovation", "social enterprise competition", "社会创新"],
  "G11.3": ["united nations job", "ngo job", "联合国", "国际组织工作"],
};
