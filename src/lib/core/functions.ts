/**
 * Job functions (plan §3): 21 cross-industry functions. An occupation is the crossing of an
 * industry and a function (occupations.ts).
 */
import { z } from "zod";
import { bi, bilingualSchema, localize, type Bilingual, type Locale } from "./labels";
import { createPhraseMatcher, type MatchOptions, type PhraseMatch } from "./text";
import { FUNCTION_IDS, functionIdSchema, type FunctionId } from "./types";

export interface FunctionDef {
  id: FunctionId;
  label: Bilingual;
  keywords: string[];
}

export const functionDefSchema = z.object({
  id: functionIdSchema,
  label: bilingualSchema,
  keywords: z.array(z.string().min(1)).min(1),
});

const f = (id: FunctionId, en: string, zh: string, keywords: string[]): FunctionDef => ({ id, label: bi(en, zh), keywords });

export const FUNCTIONS: readonly FunctionDef[] = [
  f("engineering", "Engineering & R&D", "工程与研发", ["engineering", "software development", "r and d", "developer", "engineer", "研发", "开发", "工程师", "技术"]),
  f("product", "Product", "产品", ["product management", "product manager", "product owner", "产品", "产品经理", "产品管理"]),
  f("design", "Design", "设计", ["design", "designer", "ux", "ui", "设计", "设计师"]),
  f("data", "Data", "数据", ["data", "analytics", "data science", "business intelligence", "数据", "数据分析", "数据科学"]),
  f("operations", "Operations", "运营", ["operations", "ops", "business operations", "运营", "业务运营"]),
  f("marketing", "Marketing", "市场", ["marketing", "brand", "growth", "communications", "市场", "营销", "品牌", "增长"]),
  f("sales", "Sales", "销售", ["sales", "business development", "account management", "销售", "商务拓展", "大客户"]),
  f("customer-success", "Customer success & service", "客户成功与服务", ["customer success", "customer service", "customer support", "client services", "客户成功", "客服", "客户服务", "售后"]),
  f("finance", "Finance & accounting", "财务", ["finance", "accounting", "fp and a", "treasury", "财务", "会计", "资金"]),
  f("legal", "Legal", "法务", ["legal", "compliance", "counsel", "法务", "合规", "法律"]),
  f("people", "People & HR", "人力资源", ["human resources", "hr", "people operations", "recruiting", "talent", "人力资源", "人事", "招聘"]),
  f("admin", "Administration", "行政", ["administration", "office management", "administrative", "行政", "办公室", "文秘"]),
  f("project-strategy", "Projects & strategy", "项目与战略", ["project management", "program management", "strategy", "consulting", "项目管理", "战略", "咨询"]),
  f("supply-chain", "Supply chain & procurement", "供应链与采购", ["supply chain", "procurement", "logistics", "purchasing", "供应链", "采购", "物流"]),
  f("manufacturing", "Production & manufacturing", "生产制造", ["manufacturing", "production", "plant", "factory", "生产", "制造", "车间"]),
  f("quality", "Quality", "质量", ["quality", "quality assurance", "quality control", "testing", "质量", "品质", "质检", "测试"]),
  f("research", "Research & academia", "研究与学术", ["research", "academic", "scientist", "laboratory", "研究", "科研", "学术", "实验室"]),
  f("teaching", "Teaching", "教学", ["teaching", "teacher", "instruction", "tutoring", "training", "教学", "教师", "授课", "培训"]),
  f("clinical", "Medical & clinical", "医疗与临床", ["clinical", "medical", "patient care", "nursing", "临床", "医疗", "护理"]),
  f("creative", "Creative & content", "创意与内容", ["creative", "content", "writing", "video", "editorial", "创意", "内容", "写作", "视频", "编辑"]),
  f("executive", "Executive & general management", "高管与管理", ["executive", "general management", "leadership", "c suite", "高管", "总经理", "管理层"]),
];

const BY_ID = new Map<string, FunctionDef>(FUNCTIONS.map((x) => [x.id, x]));

export function isFunctionId(value: unknown): value is FunctionId {
  return typeof value === "string" && (FUNCTION_IDS as readonly string[]).includes(value);
}

export function getFunction(id: FunctionId): FunctionDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown function: ${id}`);
  return def;
}

export function functionLabel(id: FunctionId, locale: Locale | string): string {
  return localize(getFunction(id).label, locale);
}

let matcher: ReturnType<typeof createPhraseMatcher> | null = null;

/** Maps free text (a department line, a posting's team) to function ids. */
export function mapFunction(text: string, opts: MatchOptions = {}): PhraseMatch[] {
  matcher ??= createPhraseMatcher(FUNCTIONS.map((x) => ({ code: x.id, phrases: [x.label.en, x.label.zh, ...x.keywords] })));
  return matcher(text, { limit: opts.limit ?? 3, minScore: opts.minScore ?? 0.5 });
}
