/**
 * The domain vocabulary every feature codes against: enums (as const arrays + zod enums + TS
 * unions) and the zod schemas of every jsonb column. `src/lib/db/schema/domain.ts` types its
 * jsonb columns with these (`$type<…>()`), and every write path validates with the schemas.
 *
 * Honesty rule: unknown values are `null` ("check the official page"), never a guess, so most
 * fields of extracted or crawled data are `nullable()`.
 *
 * This module imports nothing from the other taxonomy files (they import from here).
 */
import { z } from "zod";

/* ================================================================== JSON */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.json() as z.ZodType<JsonValue>;
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema) as z.ZodType<JsonObject>;

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (résumés rarely give full dates). */
export const partialDateSchema = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD");
export type PartialDate = z.infer<typeof partialDateSchema>;

/** ISO 4217 code, upper case (USD, CNY, EUR…). */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");

/** ISO 3166-1 alpha-2 code, upper case (US, CN, GB…). */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code");

export const moneySchema = z.object({
  amount: z.number().nonnegative().nullable(),
  currency: currencySchema.nullable(),
});
export type Money = z.infer<typeof moneySchema>;

/* ================================================================== identities */

export const IDENTITY_GROUPS = ["S", "E", "F", "R", "C", "P", "T", "I"] as const;
export type IdentityGroup = (typeof IDENTITY_GROUPS)[number];
export const identityGroupSchema = z.enum(IDENTITY_GROUPS);

/** Groups a person can be (I = opportunity providers, supply side, phase 2). */
export const USER_IDENTITY_GROUPS = ["S", "E", "F", "R", "C", "P", "T"] as const satisfies readonly IdentityGroup[];

/** Every identity code of the plan §2 (S1–S7, E1–E8, F1–F8, R1–R6, C1–C9, P1–P7, T1–T8, I1–I7). */
export const IDENTITY_CODES = [
  "S1", "S2", "S3", "S4", "S5", "S6", "S7",
  "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8",
  "R1", "R2", "R3", "R4", "R5", "R6",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9",
  "P1", "P2", "P3", "P4", "P5", "P6", "P7",
  "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8",
  "I1", "I2", "I3", "I4", "I5", "I6", "I7",
] as const;
export type IdentityCode = (typeof IDENTITY_CODES)[number];
export const identityCodeSchema = z.enum(IDENTITY_CODES);

/** Who a sub-goal or an opportunity is for: everyone, a whole group, or one code. */
export type IdentityTarget = "ALL" | IdentityGroup | IdentityCode;
export const identityTargetSchema = z.union([z.literal("ALL"), identityGroupSchema, identityCodeSchema]);

export function groupOfIdentity(code: IdentityCode): IdentityGroup {
  return code[0] as IdentityGroup;
}

/* ================================================================== goals */

export const GOAL_FAMILIES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"] as const;
export type GoalFamily = (typeof GOAL_FAMILIES)[number];
export const goalFamilySchema = z.enum(GOAL_FAMILIES);

/** Every sub-goal of the plan §4 (G12.1 is the custom goal). */
export const SUB_GOAL_IDS = [
  "G1.1", "G1.2", "G1.3", "G1.4", "G1.5", "G1.6", "G1.7", "G1.8", "G1.9", "G1.10",
  "G2.1", "G2.2", "G2.3", "G2.4", "G2.5", "G2.6", "G2.7", "G2.8", "G2.9",
  "G3.1", "G3.2", "G3.3", "G3.4", "G3.5", "G3.6", "G3.7", "G3.8", "G3.9", "G3.10", "G3.11", "G3.12", "G3.13",
  "G4.1", "G4.2", "G4.3", "G4.4", "G4.5", "G4.6", "G4.7", "G4.8", "G4.9",
  "G5.1", "G5.2", "G5.3", "G5.4", "G5.5",
  "G6.1", "G6.2", "G6.3", "G6.4", "G6.5", "G6.6", "G6.7",
  "G7.1", "G7.2", "G7.3", "G7.4", "G7.5",
  "G8.1", "G8.2", "G8.3", "G8.4",
  "G9.1", "G9.2", "G9.3",
  "G10.1", "G10.2", "G10.3",
  "G11.1", "G11.2", "G11.3",
  "G12.1",
] as const;
export type SubGoalId = (typeof SUB_GOAL_IDS)[number];
export const subGoalIdSchema = z.enum(SUB_GOAL_IDS);

export function familyOfSubGoal(id: SubGoalId): GoalFamily {
  return id.slice(0, id.indexOf(".")) as GoalFamily;
}

/** How much of a sub-goal the platform can carry out (plan §4: 高 / 中 / 低 / 文书). */
export const AUTOMATION_LEVELS = ["high", "medium", "low", "docs"] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];
export const automationLevelSchema = z.enum(AUTOMATION_LEVELS);

/** How hard the scout pushes each week (drives playbook quotas and milestone targets). */
export const INTENSITIES = ["light", "steady", "intense"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const intensitySchema = z.enum(INTENSITIES);

export const GOAL_STATUSES = ["active", "paused", "achieved", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const goalStatusSchema = z.enum(GOAL_STATUSES);

export const MILESTONE_METRICS = ["applications", "replies", "interviews", "offers", "meetings", "custom"] as const;
export type MilestoneMetric = (typeof MILESTONE_METRICS)[number];
export const milestoneMetricSchema = z.enum(MILESTONE_METRICS);

export const MILESTONE_STATUSES = ["open", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/* ================================================================== channels, opportunity types, materials */

export const CHANNEL_IDS = ["CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export const channelIdSchema = z.enum(CHANNEL_IDS);

export const OPPORTUNITY_GROUPS = ["work", "venture", "funding", "academic", "education", "creative", "visibility", "community", "mobility", "system"] as const;
export type OpportunityGroup = (typeof OPPORTUNITY_GROUPS)[number];
export const opportunityGroupSchema = z.enum(OPPORTUNITY_GROUPS);

export const OPPORTUNITY_TYPE_IDS = [
  // work
  "job", "internship", "remote_job", "part_time", "graduate_program", "public_sector_exam", "returnship",
  "referral", "recruiter", "internal_role", "freelance_project", "client_lead", "ngo_job", "volunteer",
  // venture
  "investor", "accelerator", "incubator", "startup_competition", "pitch_event", "exhibition",
  "cofounder_match", "crowdfunding", "loan", "hiring_channel", "service_provider", "government_program",
  // funding
  "grant", "fellowship", "scholarship", "award", "competition", "hackathon",
  // academic
  "conference_cfp", "journal", "phd_position", "postdoc", "visiting_scholar", "collaborator", "editorial_role", "industry_partnership",
  // education
  "degree_program", "exchange_program", "standardized_test", "course", "certification", "mentorship",
  // creative
  "residency", "open_call", "brand_partnership", "platform_signing", "licensing",
  // visibility
  "speaking", "media", "podcast", "book_publisher",
  // community
  "community", "event",
  // mobility
  "visa_pathway",
  // system
  "practice",
] as const;
export type OpportunityTypeId = (typeof OPPORTUNITY_TYPE_IDS)[number];
export const opportunityTypeIdSchema = z.enum(OPPORTUNITY_TYPE_IDS);

export const MATERIAL_IDS = [
  "resume", "resume_variant", "cv", "cover_letter", "portfolio", "work_samples", "transcript", "test_scores",
  "recommendation_letters", "personal_statement", "research_statement", "research_proposal", "publication_list",
  "paper", "abstract", "pitch_deck", "business_plan", "one_pager", "financial_summary", "demo_video",
  "company_profile", "product_images", "press_release", "founder_bio", "speaker_bio", "short_bio",
  "talk_proposal", "artist_statement", "media_kit", "project_proposal", "application_form", "nomination_packet",
  "grant_application", "evidence_list", "license", "certificate", "performance_record", "promotion_case",
  "negotiation_script", "transfer_request", "job_description", "outreach_email", "book_proposal", "article",
  "campaign_copy", "requirements_brief", "interview_prep", "document_checklist", "study_plan",
] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];
export const materialIdSchema = z.enum(MATERIAL_IDS);

/** The 21 cross-industry functions of plan §3. */
export const FUNCTION_IDS = [
  "engineering", "product", "design", "data", "operations", "marketing", "sales", "customer-success",
  "finance", "legal", "people", "admin", "project-strategy", "supply-chain", "manufacturing", "quality",
  "research", "teaching", "clinical", "creative", "executive",
] as const;
export type FunctionId = (typeof FUNCTION_IDS)[number];
export const functionIdSchema = z.enum(FUNCTION_IDS);

/** Industry codes are `top` or `top.sub` (see industries.ts); validated there with `isIndustryCode`. */
export type IndustryCode = string;

/* ================================================================== shared value enums */

export const REMOTE_MODES = ["remote", "hybrid", "onsite"] as const;
export type RemoteMode = (typeof REMOTE_MODES)[number];
export const remoteModeSchema = z.enum(REMOTE_MODES);

export const REMOTE_PREFERENCES = ["remote_only", "remote_ok", "onsite_only"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];
export const remotePreferenceSchema = z.enum(REMOTE_PREFERENCES);

export const DEGREE_LEVELS = ["none", "high_school", "vocational", "associate", "bachelor", "master", "professional", "doctorate"] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];
export const degreeLevelSchema = z.enum(DEGREE_LEVELS);

export const LANGUAGE_LEVELS = ["native", "fluent", "professional", "conversational", "basic"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

export const LINK_KINDS = [
  "website", "portfolio", "linkedin", "github", "gitlab", "scholar", "orcid", "dblp", "researchgate", "behance",
  "dribbble", "youtube", "bilibili", "xiaohongshu", "douyin", "tiktok", "instagram", "x", "weibo", "wechat",
  "medium", "substack", "crunchbase", "app_store", "product_hunt", "other",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const WORK_AUTH_STATUSES = ["citizen", "permanent_resident", "work_visa", "student_visa", "dependent_visa", "needs_sponsorship", "other"] as const;
export type WorkAuthStatus = (typeof WORK_AUTH_STATUSES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "freelance", "volunteer", "self_employed", "apprenticeship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const VENTURE_STAGES = ["idea", "mvp", "pre_seed", "seed", "series_a", "series_b_plus", "bootstrapped", "profitable"] as const;
export type VentureStage = (typeof VENTURE_STAGES)[number];

export const FUNDING_INSTRUMENTS = ["safe", "equity", "convertible_note", "grant", "loan", "revenue_based", "other"] as const;
export type FundingInstrument = (typeof FUNDING_INSTRUMENTS)[number];

/* ================================================================== profile document */

export const profileLinkSchema = z.object({
  kind: z.enum(LINK_KINDS).default("other"),
  url: z.string().trim().min(1),
  label: z.string().nullable().default(null),
});
export type ProfileLink = z.infer<typeof profileLinkSchema>;

export const languageSkillSchema = z.object({
  /** BCP 47 language tag: en, zh, ja, es… */
  code: z.string().trim().min(2).max(12),
  level: z.enum(LANGUAGE_LEVELS).nullable().default(null),
});
export type LanguageSkill = z.infer<typeof languageSkillSchema>;

export const workAuthorizationSchema = z.object({
  countryCode: countryCodeSchema,
  status: z.enum(WORK_AUTH_STATUSES),
  note: z.string().nullable().default(null),
});
export type WorkAuthorization = z.infer<typeof workAuthorizationSchema>;

export const profileIdentitySchema = z.object({
  name: z.string().trim().nullable().default(null),
  /** One-line professional headline ("Backend engineer, payments"). */
  headline: z.string().nullable().default(null),
  email: z.string().trim().nullable().default(null),
  phone: z.string().trim().nullable().default(null),
  /** Free text as the person wrote it ("Shanghai, China"). */
  location: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  countryCode: countryCodeSchema.nullable().default(null),
  workAuthorization: z.array(workAuthorizationSchema).default([]),
  languages: z.array(languageSkillSchema).default([]),
  links: z.array(profileLinkSchema).default([]),
  birthYear: z.number().int().min(1900).max(2100).nullable().default(null),
  /** Required for minors (identity S1): outreach is disabled and the guardian confirms. */
  guardianEmail: z.string().trim().nullable().default(null),
});
export type ProfileIdentity = z.infer<typeof profileIdentitySchema>;

export const roleSchema = z.object({
  code: identityCodeSchema,
  /** A stage id from identities.ts `stagesFor(code)`. */
  stage: z.string().nullable().default(null),
  since: partialDateSchema.nullable().default(null),
  /** Set when the role was inferred from documents and not yet confirmed by the person. */
  inferred: z.boolean().default(false),
});
export type Role = z.infer<typeof roleSchema>;

/** Stable item id inside a profile array, so facts can point at `/experience/<id>/title`. */
const itemId = z.string().trim().min(1).max(64);

export const educationItemSchema = z.object({
  id: itemId,
  institution: z.string().trim().min(1),
  degree: z.string().nullable().default(null),
  level: degreeLevelSchema.nullable().default(null),
  field: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  startDate: partialDateSchema.nullable().default(null),
  endDate: partialDateSchema.nullable().default(null),
  current: z.boolean().default(false),
  gpa: z.object({ value: z.number().nonnegative(), scale: z.number().positive() }).nullable().default(null),
  honors: z.array(z.string()).default([]),
  courses: z.array(z.string()).default([]),
  description: z.string().nullable().default(null),
});
export type EducationItem = z.infer<typeof educationItemSchema>;

export const experienceItemSchema = z.object({
  id: itemId,
  organization: z.string().trim().min(1),
  title: z.string().trim().min(1),
  /** Occupation code from occupations.ts (mapped, never asked). */
  occupation: z.string().nullable().default(null),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().default(null),
  industry: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  startDate: partialDateSchema.nullable().default(null),
  endDate: partialDateSchema.nullable().default(null),
  current: z.boolean().default(false),
  summary: z.string().nullable().default(null),
  highlights: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
export type ExperienceItem = z.infer<typeof experienceItemSchema>;

export const projectItemSchema = z.object({
  id: itemId,
  name: z.string().trim().min(1),
  role: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  startDate: partialDateSchema.nullable().default(null),
  endDate: partialDateSchema.nullable().default(null),
  summary: z.string().nullable().default(null),
  highlights: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
export type ProjectItem = z.infer<typeof projectItemSchema>;

export const SKILL_CATEGORIES = ["technical", "tool", "language", "domain", "creative", "soft", "other"] as const;
export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;

export const skillItemSchema = z.object({
  name: z.string().trim().min(1),
  category: z.enum(SKILL_CATEGORIES).default("other"),
  level: z.enum(SKILL_LEVELS).nullable().default(null),
  years: z.number().nonnegative().max(70).nullable().default(null),
});
export type SkillItem = z.infer<typeof skillItemSchema>;

export const ACHIEVEMENT_KINDS = ["award", "competition", "scholarship", "grant", "press", "ranking", "other"] as const;

export const achievementItemSchema = z.object({
  id: itemId,
  title: z.string().trim().min(1),
  kind: z.enum(ACHIEVEMENT_KINDS).default("other"),
  issuer: z.string().nullable().default(null),
  date: partialDateSchema.nullable().default(null),
  amount: moneySchema.nullable().default(null),
  description: z.string().nullable().default(null),
});
export type AchievementItem = z.infer<typeof achievementItemSchema>;

export const PUBLICATION_KINDS = ["journal", "conference", "preprint", "book", "chapter", "patent", "thesis", "article", "other"] as const;
export const PUBLICATION_STATUSES = ["published", "accepted", "under_review", "in_preparation"] as const;

export const publicationItemSchema = z.object({
  id: itemId,
  title: z.string().trim().min(1),
  kind: z.enum(PUBLICATION_KINDS).default("other"),
  status: z.enum(PUBLICATION_STATUSES).default("published"),
  venue: z.string().nullable().default(null),
  year: z.number().int().min(1900).max(2100).nullable().default(null),
  authors: z.array(z.string()).default([]),
  /** 1-based position of the person in the author list (first author = 1). */
  authorPosition: z.number().int().positive().nullable().default(null),
  doi: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  citations: z.number().int().nonnegative().nullable().default(null),
});
export type PublicationItem = z.infer<typeof publicationItemSchema>;

export const certificationItemSchema = z.object({
  id: itemId,
  name: z.string().trim().min(1),
  issuer: z.string().nullable().default(null),
  /** Licence or credential number, only when the person supplied it. */
  credentialId: z.string().nullable().default(null),
  jurisdiction: z.string().nullable().default(null),
  issuedAt: partialDateSchema.nullable().default(null),
  expiresAt: partialDateSchema.nullable().default(null),
  url: z.string().nullable().default(null),
});
export type CertificationItem = z.infer<typeof certificationItemSchema>;

/* ---------------------------------------------------------------- identity packs (plan §9) */

export const jobSeekerPackSchema = z.object({
  targetFunctions: z.array(functionIdSchema).default([]),
  targetOccupations: z.array(z.string()).default([]),
  targetIndustries: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  remote: remotePreferenceSchema.nullable().default(null),
  salaryMin: z.number().nonnegative().nullable().default(null),
  salaryMax: z.number().nonnegative().nullable().default(null),
  currency: currencySchema.nullable().default(null),
  salaryPeriod: z.enum(["year", "month", "hour"]).nullable().default(null),
  /** 到岗时间: earliest start. */
  availableFrom: partialDateSchema.nullable().default(null),
  needsSponsorship: z.boolean().nullable().default(null),
  /** 求职状态可见性: may the current employer find out? */
  searchVisibility: z.enum(["open", "discreet", "confidential"]).nullable().default(null),
});
export type JobSeekerPack = z.infer<typeof jobSeekerPackSchema>;

export const fundingRoundSchema = z.object({
  round: z.string().trim().min(1),
  amount: z.number().nonnegative().nullable().default(null),
  currency: currencySchema.nullable().default(null),
  date: partialDateSchema.nullable().default(null),
  investors: z.array(z.string()).default([]),
  instrument: z.enum(FUNDING_INSTRUMENTS).nullable().default(null),
});
export type FundingRound = z.infer<typeof fundingRoundSchema>;

export const tractionSchema = z.object({
  revenue: z
    .object({
      amount: z.number().nonnegative().nullable().default(null),
      currency: currencySchema.nullable().default(null),
      period: z.enum(["month", "year", "total"]).nullable().default(null),
      text: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  users: z
    .object({
      count: z.number().int().nonnegative().nullable().default(null),
      /** What is counted: MAU, paying customers, pilots… */
      label: z.string().nullable().default(null),
      text: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  growth: z
    .object({
      percent: z.number().nullable().default(null),
      period: z.enum(["week", "month", "quarter", "year"]).nullable().default(null),
      text: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type Traction = z.infer<typeof tractionSchema>;

export const ventureSchema = z.object({
  id: itemId,
  company: z.string().trim().min(1),
  oneLiner: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  /** Industry code (industries.ts) or free text when it cannot be mapped. */
  industry: z.string().nullable().default(null),
  stage: z.enum(VENTURE_STAGES).nullable().default(null),
  teamSize: z.number().int().positive().nullable().default(null),
  founded: partialDateSchema.nullable().default(null),
  location: z.string().nullable().default(null),
  product: z.string().nullable().default(null),
  businessModel: z.string().nullable().default(null),
  traction: tractionSchema.default({ revenue: null, users: null, growth: null }),
  fundingHistory: z.array(fundingRoundSchema).default([]),
  currentRound: z
    .object({
      amount: z.number().nonnegative().nullable().default(null),
      currency: currencySchema.nullable().default(null),
      instrument: z.enum(FUNDING_INSTRUMENTS).nullable().default(null),
      valuationCap: z.number().nonnegative().nullable().default(null),
      committed: z.number().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** The person's role in the venture (CEO, CTO…). */
  role: z.string().nullable().default(null),
  /** documents.id of the deck / business plan this venture was read from. */
  deckDocumentId: z.string().nullable().default(null),
});
export type Venture = z.infer<typeof ventureSchema>;

export const founderPackSchema = z.object({
  ventures: z.array(ventureSchema).default([]),
});
export type FounderPack = z.infer<typeof founderPackSchema>;

export const grantItemSchema = z.object({
  title: z.string().trim().min(1),
  funder: z.string().nullable().default(null),
  amount: moneySchema.nullable().default(null),
  role: z.enum(["pi", "co_pi", "participant"]).nullable().default(null),
  startDate: partialDateSchema.nullable().default(null),
  endDate: partialDateSchema.nullable().default(null),
});
export type GrantItem = z.infer<typeof grantItemSchema>;

export const researcherPackSchema = z.object({
  /** 研究方向, in the person's words. */
  fields: z.array(z.string()).default([]),
  hIndex: z.number().int().nonnegative().nullable().default(null),
  citations: z.number().int().nonnegative().nullable().default(null),
  grants: z.array(grantItemSchema).default([]),
  advisors: z.array(z.string()).default([]),
  scholarUrl: z.string().nullable().default(null),
  orcid: z.string().nullable().default(null),
  targetVenues: z.array(z.string()).default([]),
  /** 目标期刊等级. */
  targetTier: z.enum(["top", "high", "solid", "any"]).nullable().default(null),
});
export type ResearcherPack = z.infer<typeof researcherPackSchema>;

export const audienceMetricSchema = z.object({
  platform: z.string().trim().min(1),
  handle: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  followers: z.number().int().nonnegative().nullable().default(null),
  avgViews: z.number().int().nonnegative().nullable().default(null),
  engagementRate: z.number().min(0).max(1).nullable().default(null),
});
export type AudienceMetric = z.infer<typeof audienceMetricSchema>;

export const creatorPackSchema = z.object({
  disciplines: z.array(z.string()).default([]),
  styles: z.array(z.string()).default([]),
  audienceMetrics: z.array(audienceMetricSchema).default([]),
  rates: z
    .object({
      min: z.number().nonnegative().nullable().default(null),
      max: z.number().nonnegative().nullable().default(null),
      currency: currencySchema.nullable().default(null),
      unit: z.enum(["project", "hour", "day", "month", "post", "video", "word"]).nullable().default(null),
    })
    .nullable()
    .default(null),
  brandsWorkedWith: z.array(z.string()).default([]),
  portfolioUrls: z.array(z.string()).default([]),
});
export type CreatorPack = z.infer<typeof creatorPackSchema>;

export const testScoreSchema = z.object({
  /** SAT, ACT, GRE, GMAT, TOEFL, IELTS, Duolingo, gaokao, kaoyan, HSK… */
  test: z.string().trim().min(1),
  score: z.string().trim().min(1),
  date: partialDateSchema.nullable().default(null),
});
export type TestScore = z.infer<typeof testScoreSchema>;

export const studentPackSchema = z.object({
  gpa: z.object({ value: z.number().nonnegative(), scale: z.number().positive() }).nullable().default(null),
  testScores: z.array(testScoreSchema).default([]),
  targetDegree: degreeLevelSchema.nullable().default(null),
  targetFields: z.array(z.string()).default([]),
  targetCountries: z.array(countryCodeSchema).default([]),
  /** Yearly budget for tuition + living. */
  budget: moneySchema.nullable().default(null),
  graduationDate: partialDateSchema.nullable().default(null),
  /** 可实习时长 (months) and earliest start. */
  internshipMonths: z.number().int().positive().max(24).nullable().default(null),
  availableFrom: partialDateSchema.nullable().default(null),
});
export type StudentPack = z.infer<typeof studentPackSchema>;

export const licenseItemSchema = z.object({
  type: z.string().trim().min(1),
  number: z.string().nullable().default(null),
  jurisdiction: z.string().nullable().default(null),
  issuedAt: partialDateSchema.nullable().default(null),
  expiresAt: partialDateSchema.nullable().default(null),
  status: z.enum(["active", "expired", "pending"]).nullable().default(null),
});
export type LicenseItem = z.infer<typeof licenseItemSchema>;

export const professionalPackSchema = z.object({
  licenses: z.array(licenseItemSchema).default([]),
  /** 执业地. */
  practiceLocation: z.string().nullable().default(null),
  yearsInPractice: z.number().nonnegative().max(70).nullable().default(null),
  specialties: z.array(z.string()).default([]),
});
export type ProfessionalPack = z.infer<typeof professionalPackSchema>;

export const packsSchema = z.object({
  jobSeeker: jobSeekerPackSchema.optional(),
  founder: founderPackSchema.optional(),
  researcher: researcherPackSchema.optional(),
  creator: creatorPackSchema.optional(),
  student: studentPackSchema.optional(),
  professional: professionalPackSchema.optional(),
});
export type Packs = z.infer<typeof packsSchema>;
export type PackKey = keyof Packs;

/** The whole profile document (the content columns of `profiles`, and `profile_versions.snapshot`). */
export const profileSchema = z.object({
  identity: profileIdentitySchema.default(() => profileIdentitySchema.parse({})),
  roles: z.array(roleSchema).default([]),
  industries: z.array(z.string()).default([]),
  functions: z.array(functionIdSchema).default([]),
  occupations: z.array(z.string()).default([]),
  education: z.array(educationItemSchema).default([]),
  experience: z.array(experienceItemSchema).default([]),
  projects: z.array(projectItemSchema).default([]),
  skills: z.array(skillItemSchema).default([]),
  achievements: z.array(achievementItemSchema).default([]),
  publications: z.array(publicationItemSchema).default([]),
  certifications: z.array(certificationItemSchema).default([]),
  packs: packsSchema.default({}),
  summary: z.string().nullable().default(null),
});
export type Profile = z.infer<typeof profileSchema>;
/** Alias: the snapshot stored in `profile_versions.snapshot`. */
export type ProfileSnapshot = Profile;

export function emptyProfile(): Profile {
  return profileSchema.parse({});
}

export const PROFILE_STATUSES = ["empty", "parsing", "draft", "confirmed"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/* ================================================================== documents & facts */

export const DOCUMENT_KINDS = ["resume", "cv", "deck", "business_plan", "portfolio", "transcript", "certificate", "license", "paper", "cover_letter", "link", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const DOCUMENT_STATUSES = ["uploaded", "parsing", "parsed", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const EXTRACTION_METHODS = ["pdf_text", "pdf_llm", "image_llm", "docx", "pptx", "text", "html", "github", "scholar", "orcid", "manual"] as const;

/** What ingestion learned about a document (the facts themselves live in `facts`). */
export const documentExtractionSchema = z.object({
  method: z.enum(EXTRACTION_METHODS).nullable().default(null),
  /** BCP 47 tag of the main language. */
  language: z.string().nullable().default(null),
  pages: z.number().int().nonnegative().nullable().default(null),
  title: z.string().nullable().default(null),
  /** "Recognised: 3 experiences, 2 projects, 1 paper" — keys are profile sections. */
  counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  links: z.array(z.string()).default([]),
  /** og:/meta tags or API fields kept for provenance. */
  meta: z.record(z.string(), z.string()).default({}),
  warnings: z.array(z.string()).default([]),
  truncated: z.boolean().default(false),
});
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;

/* ================================================================== goals */

export const goalConstraintsSchema = z.object({
  /** Country codes (US) or "City, CC" strings the person accepts. Empty = anywhere. */
  geo: z.array(z.string()).default([]),
  remote: remotePreferenceSchema.nullable().default(null),
  /** Money the person can spend on this goal (fees, travel), in `currency`. */
  budget: z.number().nonnegative().nullable().default(null),
  /** Hours per week the person can give (reviewing, interviews, handoffs). */
  timePerWeek: z.number().min(0).max(80).nullable().default(null),
  salaryMin: z.number().nonnegative().nullable().default(null),
  currency: currencySchema.nullable().default(null),
  intensity: intensitySchema.nullable().default(null),
  /** Playbook override: only these opportunity types (empty = playbook default). */
  opportunityTypes: z.array(opportunityTypeIdSchema).default([]),
  languages: z.array(z.string()).default([]),
  startBy: partialDateSchema.nullable().default(null),
  /** Why Onward Scout set this direction for the person (shown on the dashboard), in their language. */
  rationale: z.string().max(400).nullable().default(null),
});
export type GoalConstraints = z.infer<typeof goalConstraintsSchema>;

/* ================================================================== opportunities */

export const SOURCE_KINDS = ["greenhouse", "lever", "ashby", "crawl", "feed", "manual", "user"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const sourceKindSchema = z.enum(SOURCE_KINDS);

export const OPPORTUNITY_STATUSES = ["active", "expired", "unverified", "rejected"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const MONEY_PERIODS = ["once", "year", "month", "week", "day", "hour", "project"] as const;
export const BENEFIT_MONEY_KINDS = ["salary", "stipend", "grant", "prize", "investment", "scholarship", "fee", "other"] as const;

export const opportunityBenefitsSchema = z.object({
  summary: z.string().nullable().default(null),
  money: z
    .object({
      kind: z.enum(BENEFIT_MONEY_KINDS).default("other"),
      min: z.number().nonnegative().nullable().default(null),
      max: z.number().nonnegative().nullable().default(null),
      currency: currencySchema.nullable().default(null),
      period: z.enum(MONEY_PERIODS).nullable().default(null),
    })
    .nullable()
    .default(null),
  /** Mentorship, office space, cloud credits, publication, media exposure… */
  perks: z.array(z.string()).default([]),
  visaSponsorship: z.boolean().nullable().default(null),
  travelSupport: z.boolean().nullable().default(null),
  housing: z.boolean().nullable().default(null),
});
export type OpportunityBenefits = z.infer<typeof opportunityBenefitsSchema>;

export const opportunityCostSchema = z.object({
  /** True only when the organiser states it is free to apply and take part. */
  free: z.boolean().nullable().default(null),
  applicationFee: moneySchema.nullable().default(null),
  participationFee: moneySchema.nullable().default(null),
  /** Equity an accelerator takes, in percent. */
  equityPercent: z.number().min(0).max(100).nullable().default(null),
  /** "3 months on site in San Francisco". */
  timeCommitment: z.string().nullable().default(null),
  relocationRequired: z.boolean().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type OpportunityCost = z.infer<typeof opportunityCostSchema>;

export const opportunityGeoSchema = z.object({
  countries: z.array(countryCodeSchema).default([]),
  cities: z.array(z.string()).default([]),
  remote: remoteModeSchema.nullable().default(null),
  /** Open to applicants anywhere in the world. */
  worldwide: z.boolean().default(false),
});
export type OpportunityGeo = z.infer<typeof opportunityGeoSchema>;

export const eligibilitySchema = z.object({
  identities: z.array(identityTargetSchema).default([]),
  stages: z.array(z.string()).default([]),
  /** Minimum degree. */
  degree: degreeLevelSchema.nullable().default(null),
  minYears: z.number().nonnegative().nullable().default(null),
  maxYears: z.number().nonnegative().nullable().default(null),
  nationality: z.array(countryCodeSchema).default([]),
  residency: z.array(countryCodeSchema).default([]),
  ageMin: z.number().int().positive().nullable().default(null),
  ageMax: z.number().int().positive().nullable().default(null),
  studentsOnly: z.boolean().nullable().default(null),
  /** Startup programs: company founded at most N years ago. */
  companyMaxAgeYears: z.number().nonnegative().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type Eligibility = z.infer<typeof eligibilitySchema>;

export const FORM_FIELD_TYPES = ["text", "email", "tel", "url", "textarea", "select", "multiselect", "checkbox", "file", "date", "number"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type Option = z.infer<typeof optionSchema>;

export const formFieldSchema = z.object({
  /** The form's own field name / id (submitted as-is). */
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(optionSchema).optional(),
  maxLength: z.number().int().positive().optional(),
  /** JSON pointer into the profile that answers this field (`/identity/email`). */
  profilePath: z.string().optional(),
  help: z.string().optional(),
  /** Accepted file types for `file` fields (".pdf,.docx"). */
  accept: z.string().optional(),
  section: z.string().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const ATS_PROVIDERS = ["greenhouse", "lever", "ashby"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

export const applyInfoSchema = z.object({
  channel: channelIdSchema,
  url: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  /** Where the form lives: greenhouse, lever, ashby, google_forms, typeform, tally, jotform, f6s, devpost, openreview, easychair, common_app, linkedin, workday, own_site… */
  platform: z.string().nullable().default(null),
  fieldsSchema: z.array(formFieldSchema).default([]),
  requiresAccount: z.boolean().default(false),
  requiresPayment: z.boolean().default(false),
  captchaLikely: z.boolean().default(false),
  /** Public posting coordinates for CH1. */
  ats: z
    .object({ provider: z.enum(ATS_PROVIDERS), board: z.string().min(1), postingId: z.string().min(1) })
    .nullable()
    .default(null),
  /** Organiser's own instructions, quoted. */
  instructions: z.string().nullable().default(null),
});
export type ApplyInfo = z.infer<typeof applyInfoSchema>;

/** Raw material kept for change detection; never shown verbatim to users. */
export const opportunitySnapshotRawSchema = z.object({
  url: z.string().nullable().default(null),
  httpStatus: z.number().int().nullable().default(null),
  contentType: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  text: z.string().nullable().default(null),
  data: jsonValueSchema.nullable().default(null),
});
export type OpportunitySnapshotRaw = z.infer<typeof opportunitySnapshotRawSchema>;

export const sourceConfigSchema = z.object({
  /** ATS board token (greenhouse/lever/ashby). */
  board: z.string().optional(),
  orgName: z.string().optional(),
  orgSlug: z.string().optional(),
  defaultType: opportunityTypeIdSchema.optional(),
  channel: channelIdSchema.optional(),
  countries: z.array(countryCodeSchema).optional(),
  industries: z.array(z.string()).optional(),
  functions: z.array(functionIdSchema).optional(),
  tags: z.array(z.string()).optional(),
  feedFormat: z.enum(["rss", "atom", "json", "ics"]).optional(),
  /** CSS selectors for `crawl` sources (list, item, title, link, deadline…). */
  selectors: z.record(z.string(), z.string()).optional(),
  maxPages: z.number().int().positive().max(100).optional(),
  /** Whether opportunities from this source may get public SEO pages. */
  public: z.boolean().optional(),
  notes: z.string().optional(),
  extra: jsonObjectSchema.optional(),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const SOURCE_RUN_STATUSES = ["ok", "partial", "error"] as const;
export type SourceRunStatus = (typeof SOURCE_RUN_STATUSES)[number];

/* ================================================================== matches */

export const MATCH_FEEDBACK = ["interested", "later", "not_interested"] as const;
export type MatchFeedback = (typeof MATCH_FEEDBACK)[number];
export const matchFeedbackSchema = z.enum(MATCH_FEEDBACK);

/* ================================================================== applications */

export const APPLICATION_STATUSES = [
  "draft",
  "needs_info",
  "preparing",
  "ready",
  "submitting",
  "submitted",
  "waiting",
  "needs_you",
  "progress",
  "rejected",
  "expired",
  "withdrawn",
  "closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);

export const APPLICATION_STEP_KINDS = ["analyze", "gaps", "compose", "render", "preview", "confirm", "submit", "followup", "reply", "handoff"] as const;
export type ApplicationStepKind = (typeof APPLICATION_STEP_KINDS)[number];

export const STEP_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const QUESTION_KINDS = ["choice", "multi", "text", "file", "confirm"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** A gap question: asked only when the selected application needs it and the profile lacks it. */
export const applicationQuestionSchema = z.object({
  id: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  kind: z.enum(QUESTION_KINDS),
  options: z.array(optionSchema).optional(),
  /** Why we ask, shown under the question. */
  why: z.string().trim().min(1),
  /** Where the answer is written back so it is never asked again. */
  profilePath: z.string().optional(),
  /** Form field this answers, when it maps to one. */
  fieldName: z.string().optional(),
  required: z.boolean().default(true),
  /** For long text: a draft from the profile the person keeps, edits or rewrites. */
  draft: z.string().optional(),
});
export type ApplicationQuestion = z.infer<typeof applicationQuestionSchema>;

export const ANSWER_SOURCES = ["profile", "user", "generated", "default"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const applicationAnswerSchema = z.object({
  value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()]),
  source: z.enum(ANSWER_SOURCES),
  /** Facts the value rests on; empty for user-typed answers. */
  factIds: z.array(z.string()).default([]),
  confirmed: z.boolean().default(false),
  /** R2 key of an uploaded/generated file for `file` fields. */
  fileKey: z.string().nullable().default(null),
});
export type ApplicationAnswer = z.infer<typeof applicationAnswerSchema>;

/** Keyed by form field name or question id. */
export const applicationAnswersSchema = z.record(z.string(), applicationAnswerSchema);
export type ApplicationAnswers = z.infer<typeof applicationAnswersSchema>;

export const applicationEvidenceSchema = z.object({
  screenshotKey: z.string().nullable().default(null),
  confirmationText: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  /** Organiser's reference number, when the confirmation shows one. */
  reference: z.string().nullable().default(null),
  channel: channelIdSchema.nullable().default(null),
  /** ISO timestamp of capture. */
  capturedAt: z.string().nullable().default(null),
  /** True for CH6 handoffs the person confirmed with "I submitted it". */
  userConfirmed: z.boolean().default(false),
});
export type ApplicationEvidence = z.infer<typeof applicationEvidenceSchema>;

export const OUTCOME_RESULTS = [
  "offer", "accepted", "declined", "admitted", "funded", "awarded", "published", "selected",
  "interview", "meeting", "rejected", "no_response", "withdrawn", "expired", "other",
] as const;
export type OutcomeResult = (typeof OUTCOME_RESULTS)[number];

export const applicationOutcomeSchema = z.object({
  result: z.enum(OUTCOME_RESULTS),
  note: z.string().nullable().default(null),
  amount: moneySchema.nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  /** Retrospective notes (复盘) fed back into matching. */
  lessons: z.array(z.string()).default([]),
});
export type ApplicationOutcome = z.infer<typeof applicationOutcomeSchema>;

/** What a channel's `analyze(opp)` returns. */
export const requirementsSchema = z.object({
  fields: z.array(formFieldSchema).default([]),
  materials: z.array(materialIdSchema).default([]),
  questions: z.array(applicationQuestionSchema).default([]),
  requiresAccount: z.boolean().default(false),
  requiresPayment: z.boolean().default(false),
  captchaLikely: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});
export type Requirements = z.infer<typeof requirementsSchema>;

/* ================================================================== generated documents */

export const GENERATED_DOCUMENT_KINDS = ["cover_letter", "resume_variant", "one_pager", "email", "answers", "statement", "proposal", "bio", "press_release", "pitch_notes", "other"] as const;
export type GeneratedDocumentKind = (typeof GENERATED_DOCUMENT_KINDS)[number];
export const generatedDocumentKindSchema = z.enum(GENERATED_DOCUMENT_KINDS);

export const GENERATED_BLOCK_TYPES = ["heading", "paragraph", "bullet", "field"] as const;
export type GeneratedBlockType = (typeof GENERATED_BLOCK_TYPES)[number];

export const BLOCK_FLAGS = ["unsourced", "needs_confirmation"] as const;
export type BlockFlag = (typeof BLOCK_FLAGS)[number];

export const generatedBlockSchema = z.object({
  type: z.enum(GENERATED_BLOCK_TYPES),
  /** Field label for `field` blocks (form answers). */
  label: z.string().optional(),
  text: z.string(),
  /** Facts this block states. A claim without facts must carry the `unsourced` flag. */
  factIds: z.array(z.string()).default([]),
  flags: z.array(z.enum(BLOCK_FLAGS)).default([]),
});
export type GeneratedBlock = z.infer<typeof generatedBlockSchema>;

export const generatedContentSchema = z.object({
  format: z.literal("blocks"),
  blocks: z.array(generatedBlockSchema).default([]),
});
export type GeneratedContent = z.infer<typeof generatedContentSchema>;

/* ================================================================== outreach */

export const CONTACT_KINDS = ["investor", "recruiter", "professor", "editor", "brand", "client", "organizer", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const MESSAGE_DIRECTIONS = ["out", "in"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_CHANNELS = ["gmail", "mailto", "platform", "forward"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = ["draft", "queued", "sent", "failed", "received"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_CLASSIFICATIONS = ["interested", "meeting", "rejected", "needs_info", "auto_reply", "other"] as const;
export type MessageClassification = (typeof MESSAGE_CLASSIFICATIONS)[number];
export const messageClassificationSchema = z.enum(MESSAGE_CLASSIFICATIONS);

/* ================================================================== authorizations & integrations */

export type AuthorizationScope = `auto_submit:${OpportunityTypeId}` | "auto_followup" | "weekly_digest";
export const AUTHORIZATION_FIXED_SCOPES = ["auto_followup", "weekly_digest"] as const;

export const authorizationScopeSchema = z.custom<AuthorizationScope>(
  (v) =>
    typeof v === "string" &&
    ((AUTHORIZATION_FIXED_SCOPES as readonly string[]).includes(v) ||
      (v.startsWith("auto_submit:") && (OPPORTUNITY_TYPE_IDS as readonly string[]).includes(v.slice("auto_submit:".length)))),
  { message: "Unknown authorization scope" },
);

export function autoSubmitScope(type: OpportunityTypeId): AuthorizationScope {
  return `auto_submit:${type}`;
}

export const INTEGRATION_PROVIDERS = ["google"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = ["active", "revoked", "error"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/* ================================================================== queue & LLM ledger */

export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/* ================================================================== billing */

export const LOT_KINDS = ["trial", "subscription", "pack", "adjust"] as const;
export type LotKind = (typeof LOT_KINDS)[number];

export const LOT_STATUSES = ["active", "revoked"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const CREDIT_EVENT_KINDS = ["reserve", "debit", "release", "grant", "revoke"] as const;
export type CreditEventKind = (typeof CREDIT_EVENT_KINDS)[number];

export const ORDER_KINDS = ["pack", "subscription"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const ORDER_STATUSES = ["paid", "refunded", "disputed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["success_page", "webhook", "reconcile"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
