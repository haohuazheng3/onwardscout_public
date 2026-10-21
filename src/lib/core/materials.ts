/**
 * Application materials (plan §4 "所需材料" and §11.3 文书类型). `producedBy` says who can supply
 * each one: the person (uploads only they have: transcripts, licences, papers…), the platform
 * (drafted from sourced facts by CH5), or either. `generatedKind` maps a platform-drafted
 * material to `generated_documents.kind`.
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { MATERIAL_IDS, generatedDocumentKindSchema, materialIdSchema, type GeneratedDocumentKind, type MaterialId } from "./types";

export type MaterialProducer = "user" | "platform" | "either";

export interface MaterialDef {
  id: MaterialId;
  label: Bilingual;
  producedBy: MaterialProducer;
  generatedKind: GeneratedDocumentKind | null;
}

export const materialDefSchema = z.object({
  id: materialIdSchema,
  label: bilingualSchema,
  producedBy: z.enum(["user", "platform", "either"]),
  generatedKind: generatedDocumentKindSchema.nullable(),
});

const m = (id: MaterialId, en: string, zh: string, producedBy: MaterialProducer, generatedKind: GeneratedDocumentKind | null = null): MaterialDef => ({
  id,
  label: bi(en, zh),
  producedBy,
  generatedKind,
});

export const MATERIALS: readonly MaterialDef[] = [
  m("resume", "Résumé", "简历", "either", "resume_variant"),
  m("resume_variant", "Tailored résumé", "定制简历", "platform", "resume_variant"),
  m("cv", "Academic CV", "学术简历（CV）", "either", "resume_variant"),
  m("cover_letter", "Cover letter", "求职信（Cover Letter）", "platform", "cover_letter"),
  m("portfolio", "Portfolio", "作品集", "either"),
  m("work_samples", "Work samples", "作品样本", "user"),
  m("transcript", "Transcript", "成绩单", "user"),
  m("test_scores", "Test scores", "考试成绩", "user"),
  m("recommendation_letters", "Recommendation letters (drafts for your referees)", "推荐信（供推荐人参考的草稿）", "either", "statement"),
  m("personal_statement", "Personal statement / SOP", "个人陈述与目的陈述（PS / SOP）", "platform", "statement"),
  m("research_statement", "Research statement", "研究陈述", "platform", "statement"),
  m("research_proposal", "Research proposal", "研究计划", "either", "proposal"),
  m("publication_list", "Publication list", "论文列表", "either", "other"),
  m("paper", "Paper", "论文全文", "user"),
  m("abstract", "Abstract", "摘要", "either", "other"),
  m("pitch_deck", "Pitch deck", "路演 Deck", "either", "pitch_notes"),
  m("business_plan", "Business plan", "商业计划书", "either", "proposal"),
  m("one_pager", "One-pager", "一页纸介绍", "platform", "one_pager"),
  m("financial_summary", "Financial summary", "财务摘要", "either", "other"),
  m("demo_video", "Product demo video", "产品演示视频", "user"),
  m("company_profile", "Company profile", "公司介绍", "either", "one_pager"),
  m("product_images", "Product images", "产品图片", "user"),
  m("press_release", "Press release", "新闻稿", "platform", "press_release"),
  m("founder_bio", "Founder bio", "创始人简介", "platform", "bio"),
  m("speaker_bio", "Speaker bio", "讲者简介", "platform", "bio"),
  m("short_bio", "Short bio", "个人简介", "platform", "bio"),
  m("talk_proposal", "Talk proposal and abstract", "演讲提案与摘要", "platform", "proposal"),
  m("artist_statement", "Artist statement", "艺术家陈述", "platform", "statement"),
  m("media_kit", "Media kit", "媒体资料包", "either", "one_pager"),
  m("project_proposal", "Project proposal", "项目提案", "platform", "proposal"),
  m("application_form", "Application form answers", "申请表与报名材料", "platform", "answers"),
  m("nomination_packet", "Nomination packet", "提名材料", "platform", "statement"),
  m("grant_application", "Grant or policy application", "申报书", "platform", "proposal"),
  m("evidence_list", "Evidence checklist", "证据清单", "platform", "other"),
  m("license", "Professional licence", "执业证书", "user"),
  m("certificate", "Certificate", "证书", "user"),
  m("performance_record", "Performance record", "业绩档案", "either", "other"),
  m("promotion_case", "Promotion case", "晋升材料", "platform", "statement"),
  m("negotiation_script", "Negotiation script", "谈判脚本", "platform", "other"),
  m("transfer_request", "Internal transfer request", "转岗申请", "platform", "statement"),
  m("job_description", "Job description", "职位描述（JD）", "platform", "other"),
  m("outreach_email", "Personalised outreach email", "个性化外联邮件", "platform", "email"),
  m("book_proposal", "Book proposal", "出版提案", "platform", "proposal"),
  m("article", "Article or pitch", "文章与选题提案", "either", "other"),
  m("campaign_copy", "Campaign page copy and video script", "众筹页面文案与视频脚本", "platform", "other"),
  m("requirements_brief", "Requirements brief", "需求描述", "platform", "other"),
  m("interview_prep", "Interview and assessment prep cards", "面试与测评准备卡", "platform", "other"),
  m("document_checklist", "Document checklist", "材料清单", "platform", "other"),
  m("study_plan", "Preparation plan", "备考规划", "platform", "other"),
];

const BY_ID = new Map<string, MaterialDef>(MATERIALS.map((x) => [x.id, x]));

export function getMaterial(id: MaterialId): MaterialDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown material: ${id}`);
  return def;
}

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === "string" && (MATERIAL_IDS as readonly string[]).includes(value);
}

export function materialLabel(id: MaterialId, locale: Locale | string): string {
  return localize(getMaterial(id).label, locale);
}
