/**
 * Opportunity types (plan §10.1, §11.2): what an `opportunities.type` can be, how it is applied
 * to by default, what it usually asks for, and whether it gets public SEO pages
 * (`/opportunities/<slug>`). Jobs-like and contact-like types are private (`publicSeo: false`):
 * they are ephemeral postings or people, not curated programs.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import {
  OPPORTUNITY_TYPE_IDS,
  channelIdSchema,
  materialIdSchema,
  opportunityGroupSchema,
  opportunityTypeIdSchema,
  type ChannelId,
  type MaterialId,
  type OpportunityGroup,
  type OpportunityTypeId,
} from "./types";

/** schema.org type P5b uses for JSON-LD on public pages. */
export const SCHEMA_ORG_TYPES = ["JobPosting", "Event", "MonetaryGrant", "EducationalOccupationalProgram", "Course", "Organization", "Service", "CreativeWork"] as const;
export type SchemaOrgType = (typeof SCHEMA_ORG_TYPES)[number];

export interface OpportunityTypeDef {
  id: OpportunityTypeId;
  /** URL segment: `/opportunities/<slug>`. */
  slug: string;
  label: Bilingual;
  plural: Bilingual;
  description: Bilingual;
  group: OpportunityGroup;
  defaultChannel: ChannelId;
  materials: MaterialId[];
  publicSeo: boolean;
  /** lucide icon name (kebab-case), e.g. `briefcase`. */
  icon: string;
  schemaOrg: SchemaOrgType;
}

export const opportunityTypeDefSchema = z.object({
  id: opportunityTypeIdSchema,
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label: bilingualSchema,
  plural: bilingualSchema,
  description: bilingualSchema,
  group: opportunityGroupSchema,
  defaultChannel: channelIdSchema,
  materials: z.array(materialIdSchema),
  publicSeo: z.boolean(),
  icon: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  schemaOrg: z.enum(SCHEMA_ORG_TYPES),
});

export const OPPORTUNITY_GROUP_LABELS: Record<OpportunityGroup, Bilingual> = {
  work: bi("Work", "工作"),
  venture: bi("Startups", "创业"),
  funding: bi("Funding & prizes", "资助与奖金"),
  academic: bi("Academia", "学术"),
  education: bi("Learning", "学习与升学"),
  creative: bi("Creative", "创作"),
  visibility: bi("Visibility", "曝光与影响力"),
  community: bi("Community", "社群与活动"),
  mobility: bi("Mobility", "迁移与签证"),
  system: bi("Practice", "练习"),
};

type Row = [
  id: OpportunityTypeId,
  slug: string,
  label: Bilingual,
  plural: Bilingual,
  description: Bilingual,
  group: OpportunityGroup,
  channel: ChannelId,
  materials: MaterialId[],
  publicSeo: boolean,
  icon: string,
  schemaOrg: SchemaOrgType,
];

const ROWS: Row[] = [
  /* ------------------------------------------------------------ work */
  ["job", "jobs", bi("Job", "全职岗位"), bi("Jobs", "全职岗位"),
    bi("Full-time roles at companies and organisations.", "企业与机构的全职岗位。"),
    "work", "CH1", ["resume_variant", "cover_letter", "portfolio"], false, "briefcase", "JobPosting"],
  ["internship", "internships", bi("Internship", "实习"), bi("Internships", "实习岗位"),
    bi("Internships for students and recent graduates.", "面向在校生与应届生的实习岗位。"),
    "work", "CH1", ["resume_variant", "transcript", "cover_letter"], false, "backpack", "JobPosting"],
  ["remote_job", "remote-jobs", bi("Remote job", "远程岗位"), bi("Remote jobs", "远程岗位"),
    bi("Roles you can do from anywhere, or from abroad.", "可以远程或在海外完成的岗位。"),
    "work", "CH1", ["resume_variant", "cover_letter"], false, "laptop", "JobPosting"],
  ["part_time", "part-time-jobs", bi("Part-time or gig work", "兼职与零工"), bi("Part-time and gig work", "兼职与零工"),
    bi("Part-time roles, shifts and short gigs.", "兼职、排班制与短期零工。"),
    "work", "CH2", ["resume"], false, "clock", "JobPosting"],
  ["graduate_program", "graduate-programs", bi("Graduate program", "校招与管培生项目"), bi("Graduate programs", "校招与管培生项目"),
    bi("Campus hiring and management-trainee schemes with fixed intakes.", "有固定批次的校园招聘与管培生项目。"),
    "work", "CH6", ["resume_variant", "interview_prep"], true, "sprout", "JobPosting"],
  ["public_sector_exam", "public-sector-exams", bi("Public-sector recruitment exam", "公职招考"), bi("Public-sector recruitment exams", "公职招考"),
    bi("Civil service, public institution and state-owned enterprise recruitment announcements.", "公务员、事业单位与国企的招考公告。"),
    "work", "CH6", ["application_form"], true, "landmark", "JobPosting"],
  ["returnship", "returnships", bi("Returnship", "重返职场计划"), bi("Returnships", "重返职场计划"),
    bi("Paid programs for people returning after a career break.", "面向职业空窗后重返职场者的带薪项目。"),
    "work", "CH2", ["resume_variant"], true, "rotate-ccw", "JobPosting"],
  ["referral", "referrals", bi("Referral", "内推"), bi("Referrals", "内推"),
    bi("People inside a company who can refer you.", "能在公司内部推荐你的人。"),
    "work", "CH4", ["resume_variant", "outreach_email"], false, "handshake", "Service"],
  ["recruiter", "recruiters", bi("Recruiter or headhunter", "猎头"), bi("Recruiters and headhunters", "猎头"),
    bi("Agency recruiters and executive-search firms in your field.", "你所在领域的猎头顾问与高管寻访机构。"),
    "work", "CH4", ["resume_variant", "outreach_email"], false, "user-search", "Service"],
  ["internal_role", "internal-opportunities", bi("Internal opportunity", "内部机会"), bi("Internal opportunities", "内部机会"),
    bi("Promotions, raises and transfers inside your current organisation.", "在现单位内的晋升、加薪与转岗机会。"),
    "work", "CH5", ["performance_record", "promotion_case", "negotiation_script"], false, "building-2", "Service"],
  ["freelance_project", "freelance-projects", bi("Freelance project", "自由职业项目"), bi("Freelance projects", "自由职业项目"),
    bi("Projects posted on freelance marketplaces.", "自由职业平台上发布的项目。"),
    "work", "CH6", ["project_proposal", "portfolio"], false, "laptop", "Service"],
  ["client_lead", "client-leads", bi("Direct client lead", "直客线索"), bi("Direct client leads", "直客线索"),
    bi("Companies that may buy your product or services.", "可能购买你的产品或服务的企业。"),
    "work", "CH4", ["company_profile", "portfolio", "outreach_email"], false, "target", "Organization"],
  ["ngo_job", "ngo-jobs", bi("NGO or international organisation job", "NGO 与国际组织岗位"), bi("NGO and international organisation jobs", "NGO 与国际组织岗位"),
    bi("Roles at NGOs and international organisations such as UN agencies.", "NGO 与联合国等国际组织的岗位。"),
    "work", "CH6", ["resume_variant", "cover_letter"], false, "earth", "JobPosting"],
  ["volunteer", "volunteering", bi("Volunteer role", "志愿者岗位"), bi("Volunteer roles", "志愿者岗位"),
    bi("Volunteer programs and nonprofit roles.", "志愿者项目与公益岗位。"),
    "work", "CH2", ["resume", "short_bio"], true, "heart-handshake", "JobPosting"],

  /* ------------------------------------------------------------ venture */
  ["investor", "investors", bi("Investor", "投资人"), bi("Investors", "投资人与投资机构"),
    bi("Angels and venture funds that invest at your stage and in your sector.", "投资你所在阶段与赛道的天使投资人和风险投资机构。"),
    "venture", "CH4", ["pitch_deck", "one_pager", "financial_summary", "outreach_email"], false, "trending-up", "Organization"],
  ["accelerator", "accelerators", bi("Accelerator", "加速器"), bi("Accelerators", "加速器"),
    bi("Cohort programs that offer funding, mentorship and a demo day.", "提供资金、导师与 Demo Day 的批次制项目。"),
    "venture", "CH2", ["pitch_deck", "business_plan", "demo_video"], true, "rocket", "EducationalOccupationalProgram"],
  ["incubator", "incubators", bi("Incubator", "孵化器"), bi("Incubators", "孵化器"),
    bi("Workspace, services and support for early-stage companies.", "为早期公司提供场地、服务与扶持。"),
    "venture", "CH2", ["pitch_deck", "business_plan"], true, "egg", "Organization"],
  ["startup_competition", "startup-competitions", bi("Startup competition", "创业比赛"), bi("Startup competitions", "创业比赛"),
    bi("Business plan and startup competitions with prizes and exposure.", "提供奖金与曝光的商业计划与创业大赛。"),
    "venture", "CH2", ["pitch_deck", "business_plan"], true, "trophy", "Event"],
  ["pitch_event", "pitch-events", bi("Pitch event", "路演活动"), bi("Pitch events", "路演活动"),
    bi("Demo days and pitch nights where founders present to investors.", "创始人向投资人展示项目的 Demo Day 与路演活动。"),
    "venture", "CH2", ["pitch_deck", "one_pager"], true, "presentation", "Event"],
  ["exhibition", "trade-shows", bi("Trade show", "展会"), bi("Trade shows and exhibitions", "展会"),
    bi("Trade shows and expos where you can exhibit, pitch, speak or attend.", "可以参展、路演、演讲或观展的行业展会。"),
    "venture", "CH2", ["company_profile", "product_images"], true, "store", "Event"],
  ["cofounder_match", "cofounder-matching", bi("Co-founder matching", "合伙人匹配"), bi("Co-founder matching programs", "合伙人匹配"),
    bi("Platforms and programs that help founders find co-founders.", "帮助创始人寻找合伙人的平台与项目。"),
    "venture", "CH2", ["one_pager", "short_bio"], true, "users", "Service"],
  ["crowdfunding", "crowdfunding", bi("Crowdfunding platform", "众筹平台"), bi("Crowdfunding platforms", "众筹平台"),
    bi("Reward and equity crowdfunding platforms.", "回报型与股权型众筹平台。"),
    "venture", "CH6", ["campaign_copy", "demo_video"], false, "hand-coins", "Service"],
  ["loan", "small-business-loans", bi("Loan or credit program", "贷款与信贷产品"), bi("Loans and credit programs", "贷款与信贷产品"),
    bi("Small-business loans and guaranteed credit programs.", "小微企业贷款与担保信贷项目。"),
    "venture", "CH5", ["document_checklist", "financial_summary"], true, "banknote", "Service"],
  ["hiring_channel", "hiring-channels", bi("Hiring channel", "招聘渠道"), bi("Hiring channels", "招聘渠道"),
    bi("Places where founders can post roles and meet candidates.", "创始人发布职位、接触候选人的渠道。"),
    "venture", "CH2", ["job_description"], false, "megaphone", "Service"],
  ["service_provider", "service-providers", bi("Legal, tax or compliance provider", "法律财税合规服务商"), bi("Legal, tax and compliance providers", "法律财税合规服务商"),
    bi("Firms that handle incorporation, legal, tax and compliance work.", "提供公司设立、法律、财税与合规服务的机构。"),
    "venture", "CH4", ["requirements_brief"], false, "scale", "Service"],
  ["government_program", "government-programs", bi("Government program", "政府项目与补贴"), bi("Government programs and subsidies", "政府项目与补贴"),
    bi("Public funds, subsidies, certifications and talent programs.", "政府资金、补贴、资质认定与人才计划。"),
    "venture", "CH6", ["grant_application"], true, "landmark", "MonetaryGrant"],

  /* ------------------------------------------------------------ funding */
  ["grant", "grants", bi("Grant", "基金与资助"), bi("Grants", "基金与资助"),
    bi("Research, creative and project grants.", "科研、创作与项目类资助。"),
    "funding", "CH2", ["grant_application", "project_proposal"], true, "coins", "MonetaryGrant"],
  ["fellowship", "fellowships", bi("Fellowship", "Fellowship 项目"), bi("Fellowships", "Fellowship 项目"),
    bi("Funded programs for people with promise in a field.", "资助有潜力人才的研修与资助项目。"),
    "funding", "CH2", ["personal_statement", "resume", "recommendation_letters"], true, "sparkles", "MonetaryGrant"],
  ["scholarship", "scholarships", bi("Scholarship", "奖学金"), bi("Scholarships", "奖学金与助学金"),
    bi("Scholarships and financial aid for study.", "用于求学的奖学金与助学金。"),
    "funding", "CH2", ["personal_statement", "transcript", "recommendation_letters"], true, "graduation-cap", "MonetaryGrant"],
  ["award", "awards", bi("Award", "奖项"), bi("Awards and lists", "奖项与榜单"),
    bi("Industry awards, honours and \"under 30\" style lists.", "行业奖项、荣誉与「30 岁以下」类榜单。"),
    "funding", "CH2", ["nomination_packet"], true, "medal", "Event"],
  ["competition", "competitions", bi("Competition", "竞赛"), bi("Competitions", "竞赛"),
    bi("Coding, design, writing and other prize competitions.", "编程、设计、写作等有奖竞赛。"),
    "funding", "CH2", ["application_form", "work_samples"], true, "flag", "Event"],
  ["hackathon", "hackathons", bi("Hackathon", "黑客松"), bi("Hackathons", "黑客松"),
    bi("Build-in-a-weekend events with prizes.", "限时开发、设有奖金的黑客松活动。"),
    "funding", "CH2", ["application_form"], true, "code", "Event"],

  /* ------------------------------------------------------------ academic */
  ["conference_cfp", "conference-cfps", bi("Conference call for papers", "学术会议征稿"), bi("Conference calls for papers", "学术会议征稿"),
    bi("Academic conferences accepting paper submissions.", "正在接受论文投稿的学术会议。"),
    "academic", "CH6", ["paper", "abstract"], true, "file-text", "Event"],
  ["journal", "journals", bi("Journal", "期刊"), bi("Journals", "期刊"),
    bi("Journals and special issues open for submission.", "接受投稿的期刊与专题征稿。"),
    "academic", "CH6", ["paper", "cover_letter"], true, "book-open", "CreativeWork"],
  ["phd_position", "phd-positions", bi("PhD position", "博士招生"), bi("PhD positions", "博士招生"),
    bi("Funded PhD openings in labs and graduate schools.", "实验室与研究生院的带资助博士名额。"),
    "academic", "CH4", ["cv", "research_statement", "recommendation_letters", "outreach_email"], false, "flask-conical", "EducationalOccupationalProgram"],
  ["postdoc", "postdocs", bi("Postdoc position", "博士后职位"), bi("Postdoc positions", "博士后职位"),
    bi("Postdoctoral positions in universities and institutes.", "高校与研究机构的博士后职位。"),
    "academic", "CH4", ["cv", "research_statement", "recommendation_letters", "outreach_email"], false, "microscope", "JobPosting"],
  ["visiting_scholar", "visiting-scholar-programs", bi("Visiting scholar program", "访问学者项目"), bi("Visiting scholar programs", "访问学者项目"),
    bi("Programs that host researchers for a term or a year.", "接收研究者访问一学期或一年的项目。"),
    "academic", "CH2", ["cv", "research_proposal"], true, "plane", "EducationalOccupationalProgram"],
  ["collaborator", "research-collaborators", bi("Research collaborator", "科研合作者"), bi("Research collaborators", "科研合作者"),
    bi("Researchers working on related problems.", "研究相近问题的学者。"),
    "academic", "CH4", ["research_statement", "outreach_email"], false, "network", "Service"],
  ["editorial_role", "editorial-roles", bi("Reviewer or editorial role", "审稿与编委"), bi("Reviewer and editorial roles", "审稿与编委"),
    bi("Calls for reviewers, program committees and editorial boards.", "审稿人、程序委员会与编委的征集。"),
    "academic", "CH4", ["cv", "outreach_email"], false, "pen-line", "Service"],
  ["industry_partnership", "industry-partnerships", bi("Industry partnership", "产学研合作"), bi("Industry partnerships", "产学研合作"),
    bi("Companies and tech-transfer offices looking for research partners.", "寻找科研合作的企业与技术转移机构。"),
    "academic", "CH4", ["one_pager", "outreach_email"], false, "factory", "Organization"],

  /* ------------------------------------------------------------ education */
  ["degree_program", "degree-programs", bi("Degree program", "学位项目"), bi("Degree programs", "学位项目"),
    bi("Bachelor's, master's and doctoral programs.", "本科、硕士与博士学位项目。"),
    "education", "CH6", ["personal_statement", "cv", "recommendation_letters", "transcript"], true, "school", "EducationalOccupationalProgram"],
  ["exchange_program", "exchange-programs", bi("Exchange or summer program", "交换、暑校与夏令营"), bi("Exchange and summer programs", "交换、暑校与夏令营"),
    bi("Exchange semesters, summer schools and summer camps.", "交换学期、暑期学校与夏令营。"),
    "education", "CH2", ["application_form", "transcript"], true, "globe", "EducationalOccupationalProgram"],
  ["standardized_test", "standardized-tests", bi("Language or standardized test", "语言与标化考试"), bi("Language and standardized tests", "语言与标化考试"),
    bi("Test dates and registration for IELTS, TOEFL, GRE, GMAT and more.", "雅思、托福、GRE、GMAT 等考试的日期与报名。"),
    "education", "CH6", ["study_plan"], true, "clipboard-check", "Event"],
  ["course", "courses", bi("Course or bootcamp", "课程与训练营"), bi("Courses and bootcamps", "课程与训练营"),
    bi("Training programs, bootcamps and funded course seats.", "培训项目、训练营与资助课程名额。"),
    "education", "CH2", ["application_form"], true, "library", "Course"],
  ["certification", "certifications", bi("Professional certification", "职业认证"), bi("Professional certifications", "职业认证考试"),
    bi("Certification exams such as PMP, CFA, AWS and CPA.", "PMP、CFA、AWS、CPA 等认证考试。"),
    "education", "CH6", ["application_form", "study_plan"], true, "badge-check", "Course"],
  ["mentorship", "mentorship-programs", bi("Mentorship program", "导师计划"), bi("Mentorship programs", "导师计划"),
    bi("Programs that pair you with a mentor, or with mentees.", "为你匹配导师或学员的项目。"),
    "education", "CH2", ["short_bio"], true, "compass", "EducationalOccupationalProgram"],

  /* ------------------------------------------------------------ creative */
  ["residency", "residencies", bi("Residency", "驻留项目"), bi("Residencies", "驻留项目"),
    bi("Artist, writer and maker residencies.", "面向艺术家、作家与创作者的驻留项目。"),
    "creative", "CH2", ["portfolio", "artist_statement"], true, "house", "EducationalOccupationalProgram"],
  ["open_call", "open-calls", bi("Open call", "作品征集"), bi("Open calls", "作品征集"),
    bi("Calls for work: exhibitions, anthologies, festivals and showcases.", "展览、选集、影展与展演的作品征集。"),
    "creative", "CH2", ["work_samples", "artist_statement"], true, "image", "Event"],
  ["brand_partnership", "brand-partnerships", bi("Brand partnership", "品牌合作"), bi("Brand partnerships", "品牌合作"),
    bi("Creator programs and sponsorships run by brands.", "品牌发起的创作者计划与赞助合作。"),
    "creative", "CH4", ["media_kit", "outreach_email"], true, "tag", "Service"],
  ["platform_signing", "creator-platforms", bi("Agency or platform deal", "平台入驻与签约"), bi("Agencies and platform programs", "平台入驻与签约"),
    bi("Creator platforms, agencies, MCNs and publishers that sign talent.", "签约创作者的平台、经纪公司、MCN 与出版社。"),
    "creative", "CH2", ["short_bio", "media_kit"], true, "signature", "Service"],
  ["licensing", "licensing-marketplaces", bi("Licensing or stock marketplace", "版权授权与素材库"), bi("Licensing and stock marketplaces", "版权授权与素材库"),
    bi("Stock libraries and licensing marketplaces that accept contributors.", "接受投稿者入驻的素材库与版权授权平台。"),
    "creative", "CH2", ["work_samples"], true, "copyright", "Service"],

  /* ------------------------------------------------------------ visibility */
  ["speaking", "speaking-opportunities", bi("Speaking slot", "演讲机会"), bi("Speaking opportunities", "演讲机会"),
    bi("Calls for speakers at conferences, TEDx events and meetups.", "行业大会、TEDx 与 Meetup 的讲者征集。"),
    "visibility", "CH2", ["talk_proposal", "speaker_bio"], true, "mic", "Event"],
  ["media", "media-submissions", bi("Media or guest article", "媒体与客座投稿"), bi("Media and guest-article openings", "媒体与客座投稿"),
    bi("Publications that accept columns, op-eds and guest articles.", "接受专栏、评论与客座文章的媒体。"),
    "visibility", "CH4", ["article", "short_bio"], true, "newspaper", "CreativeWork"],
  ["podcast", "podcasts", bi("Podcast guest spot", "播客嘉宾"), bi("Podcast guest spots", "播客嘉宾"),
    bi("Podcasts that invite guests in your field.", "邀请你所在领域嘉宾的播客。"),
    "visibility", "CH4", ["short_bio", "outreach_email"], false, "podcast", "CreativeWork"],
  ["book_publisher", "publishers", bi("Publisher or literary agent", "出版社与版权经纪"), bi("Publishers and literary agents", "出版社与版权经纪"),
    bi("Publishers and agents accepting book proposals.", "接受出版提案的出版社与版权经纪人。"),
    "visibility", "CH4", ["book_proposal", "outreach_email"], false, "book", "Organization"],

  /* ------------------------------------------------------------ community */
  ["community", "communities", bi("Community or association", "社群与协会"), bi("Communities and associations", "社群与协会"),
    bi("Professional associations, alumni networks and chambers of commerce.", "行业协会、校友会与商会。"),
    "community", "CH2", ["short_bio"], true, "users-round", "Organization"],
  ["event", "events", bi("Industry event or summit", "行业活动与峰会"), bi("Industry events and summits", "行业活动与峰会"),
    bi("Conferences and summits, including free and sponsored tickets.", "行业会议与峰会，包括免费票与资助票。"),
    "community", "CH2", ["application_form"], true, "calendar", "Event"],

  /* ------------------------------------------------------------ mobility */
  ["visa_pathway", "visa-pathways", bi("Visa pathway", "签证路径"), bi("Visa pathways", "签证路径"),
    bi("Work and talent visa routes, and the evidence each one needs.", "工作签证与人才签证路径，以及各自需要的证据材料。"),
    "mobility", "CH5", ["evidence_list", "document_checklist"], true, "stamp", "Service"],

  /* ------------------------------------------------------------ system */
  ["practice", "practice", bi("Practice application", "练习申请"), bi("Practice applications", "练习申请"),
    bi("A safe sandbox application that walks through the whole flow; nothing reaches a real organisation.", "在沙盒里走完整个申请流程，不会发送给任何真实机构。"),
    "system", "CH2", ["resume_variant", "cover_letter"], false, "play", "Service"],
];

export const OPPORTUNITY_TYPES: readonly OpportunityTypeDef[] = ROWS.map(
  ([id, slug, label, plural, description, group, defaultChannel, materials, publicSeo, icon, schemaOrg]) => ({
    id,
    slug,
    label,
    plural,
    description,
    group,
    defaultChannel,
    materials,
    publicSeo,
    icon,
    schemaOrg,
  }),
);

const BY_ID = new Map<string, OpportunityTypeDef>(OPPORTUNITY_TYPES.map((t) => [t.id, t]));
const BY_SLUG = new Map<string, OpportunityTypeDef>(OPPORTUNITY_TYPES.map((t) => [t.slug, t]));

export function getOpportunityType(id: OpportunityTypeId): OpportunityTypeDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown opportunity type: ${id}`);
  return def;
}

export function isOpportunityTypeId(value: unknown): value is OpportunityTypeId {
  return typeof value === "string" && (OPPORTUNITY_TYPE_IDS as readonly string[]).includes(value);
}

/** Resolves a `/opportunities/<slug>` segment; `null` for unknown or non-public types. */
export function opportunityTypeBySlug(slug: string, opts: { publicOnly?: boolean } = { publicOnly: true }): OpportunityTypeDef | null {
  const def = BY_SLUG.get(slug) ?? null;
  if (!def) return null;
  if ((opts.publicOnly ?? true) && !def.publicSeo) return null;
  return def;
}

/** Types that get programmatic SEO pages. */
export function publicOpportunityTypes(): OpportunityTypeDef[] {
  return OPPORTUNITY_TYPES.filter((t) => t.publicSeo);
}

export function opportunityTypesInGroup(group: OpportunityGroup): OpportunityTypeDef[] {
  return OPPORTUNITY_TYPES.filter((t) => t.group === group);
}

export function opportunityTypeLabel(id: OpportunityTypeId, locale: Locale | string, plural = false): string {
  const def = getOpportunityType(id);
  return localize(plural ? def.plural : def.label, locale);
}

