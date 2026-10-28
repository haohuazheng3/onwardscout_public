import { sha256 } from "@/lib/ids";
import { buildProfile } from "./build";
import { fieldKey } from "./local/forms";
import {
  AnswerQuestionsInput,
  ClassifyReplyInput,
  ComposeInput,
  ExtractProfileInput,
  MapFormFieldsInput,
  NormalizeOpportunityInput,
  PlanBrowserStepInput,
  RecommendDirectionsInput,
  ScoreMatchesInput,
  emptyIR,
  type BrowserStep,
  type CallContext,
  type ComposedDocument,
  type DirectionPlan,
  type ExtractProfileOutput,
  type FieldMapping,
  type Intelligence,
  type MatchScore,
  type NormalizedOpportunity,
  type QuestionAnswer,
  type ReplyClassification,
} from "./types";

/*
 * Canned, deterministic intelligence for tests (LLM_PROVIDER=mock; refused on production by
 * the selector). Shapes are identical to the real providers so feature tests exercise the
 * same code paths; content is obviously fictional ("Morgan Example") so it can never be
 * mistaken for a real person's data. Usage is reported at zero cost.
 */

function hashInt(s: string): number {
  return parseInt(sha256(s).slice(0, 8), 16);
}

export class MockIntelligence implements Intelligence {
  readonly provider = "mock" as const;

  private report(ctx?: CallContext): void {
    ctx?.report?.({ model: "mock", inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costCents: 0 });
  }

  async extractProfile(raw: ExtractProfileInput, ctx?: CallContext): Promise<ExtractProfileOutput> {
    const input = ExtractProfileInput.parse(raw);
    this.report(ctx);
    const doc = input.documents[0];
    const quote = doc?.text.trim().split("\n")[0]?.slice(0, 60) || "mock";
    const src = { docId: doc?.id ?? null, quote, confidence: 0.9 };
    const ir = emptyIR();
    ir.identity.push({ field: "name", value: "Morgan Example", src }, { field: "email", value: "morgan@example.com", src }, { field: "location", value: "Austin, TX", src });
    ir.experience.push({ organization: "Example Labs", title: "Product Analyst", employmentType: "full_time", location: null, startDate: "2022-01", endDate: null, current: true, summary: null, highlights: ["Built the weekly metrics review used by 3 teams"], skills: [], src });
    ir.education.push({ institution: "Example State University", degree: "B.S.", level: "bachelor", field: "Economics", location: null, startDate: "2017", endDate: "2021", current: false, gpa: null, honors: [], courses: [], description: null, src });
    ir.skills.push({ name: "SQL", category: "technical", level: null, src }, { name: "Python", category: "technical", level: null, src });
    const { profile, facts } = buildProfile(ir, { locale: input.locale, documents: input.documents, links: input.links, now: input.now ? new Date(input.now) : new Date("2026-10-21") });
    profile.roles = [{ code: "E2", stage: null, since: null, inferred: true }];
    return {
      profile,
      facts,
      identities: [{ code: "E2", confidence: 0.9, why: input.locale === "zh" ? "示例数据" : "Mock data", stage: null }],
      gaps: [input.locale === "zh" ? "你下一份工作想做什么职位？" : "What kind of role do you want next?"],
    };
  }

  async normalizeOpportunity(raw: NormalizeOpportunityInput, ctx?: CallContext): Promise<NormalizedOpportunity> {
    const input = NormalizeOpportunityInput.parse(raw);
    this.report(ctx);
    return {
      type: input.hint?.type ?? "job",
      name: input.hint?.name ?? "Mock opportunity",
      orgName: input.hint?.orgName ?? "Example Org",
      summary: "A mock opportunity for tests.",
      description: input.text?.slice(0, 500) ?? null,
      url: input.url,
      deadline: null,
      rolling: true,
      cycle: null,
      geo: { countries: [], cities: [], remote: "remote", worldwide: true },
      languages: ["en"],
      tags: [],
      industries: [],
      functions: [],
      eligibility: { identities: [], stages: [], degree: null, minYears: null, maxYears: null, nationality: [], residency: [], ageMin: null, ageMax: null, studentsOnly: null, notes: null },
      benefits: { summary: null, money: null, perks: [] },
      cost: { free: true, applicationFee: null, equityPercent: null, notes: null },
      requiredMaterials: ["resume"],
      apply: { channel: "CH2", url: input.url, email: null, platform: "own_site", requiresAccount: false, requiresPayment: false },
      estEffortMinutes: 15,
      confidence: 0.5,
      missing: ["deadline"],
      expired: false,
    };
  }

  async scoreMatches(raw: ScoreMatchesInput, ctx?: CallContext): Promise<MatchScore[]> {
    const input = ScoreMatchesInput.parse(raw);
    this.report(ctx);
    return input.opportunities.map((o) => {
      const fit = 40 + (hashInt(o.id) % 60);
      return { opportunityId: o.id, goalId: input.goals[0]?.id ?? null, fit, winProbability: Math.round((fit / 200) * 1000) / 1000, effort: 20, value: 50, eligible: true, reasons: [input.language === "zh" ? "示例匹配" : "Mock match"], gaps: [], blockers: [] };
    });
  }

  async compose(raw: ComposeInput, ctx?: CallContext): Promise<ComposedDocument> {
    const input = ComposeInput.parse(raw);
    this.report(ctx);
    const zh = input.language === "zh";
    const fact = input.facts[0];
    const blocks: ComposedDocument["blocks"] = [];
    if (input.kind.startsWith("email_")) blocks.push({ type: "field", role: "subject", label: zh ? "主题" : "Subject", text: zh ? "示例主题" : "Mock subject", factIds: [], flags: [] });
    blocks.push({ type: "paragraph", role: "greeting", text: zh ? "您好：" : "Hello,", factIds: [], flags: [] });
    if (fact) blocks.push({ type: "paragraph", role: "body", text: fact.claim, factIds: [fact.id], flags: [] });
    else blocks.push({ type: "paragraph", role: "gap", text: zh ? "【需要补充事实】" : "[Facts needed]", factIds: [], flags: ["needs_confirmation"] });
    blocks.push({ type: "paragraph", role: "closing", text: zh ? "谢谢。" : "Thank you.", factIds: [], flags: [] });
    return {
      format: "blocks",
      kind: input.kind,
      language: input.language,
      title: zh ? "示例文档" : "Mock document",
      blocks,
      gaps: fact ? [] : [{ key: "facts", question: zh ? "请补充档案。" : "Add your profile first." }],
      notes: [],
      factIds: fact ? [fact.id] : [],
      wordCount: blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0),
      label: "drafted_from_profile",
    };
  }

  async answerQuestions(raw: AnswerQuestionsInput, ctx?: CallContext): Promise<QuestionAnswer[]> {
    const input = AnswerQuestionsInput.parse(raw);
    this.report(ctx);
    const fact = input.facts[0];
    return input.questions.map((q) =>
      fact
        ? { questionId: q.id, answer: `${fact.claim}`, factIds: [fact.id], confidence: 0.5, needsUser: false, reason: null }
        : { questionId: q.id, answer: null, factIds: [], confidence: 0, needsUser: true, reason: "Mock: no facts" },
    );
  }

  async classifyReply(raw: ClassifyReplyInput, ctx?: CallContext): Promise<ReplyClassification> {
    const input = ClassifyReplyInput.parse(raw);
    this.report(ctx);
    const rejected = /unfortunately|很遗憾/i.test(input.text);
    return { classification: rejected ? "rejected" : "interested", summary: rejected ? "Mock: declined" : "Mock: interested", nextStep: "Mock next step", confidence: 0.5 };
  }

  async mapFormFields(raw: MapFormFieldsInput, ctx?: CallContext): Promise<FieldMapping[]> {
    const input = MapFormFieldsInput.parse(raw);
    this.report(ctx);
    return input.fields.map((f) => {
      const k = fieldKey(f);
      if (k?.user || f.type === "checkbox") return { name: f.name, value: null, source: "user", key: k?.key ?? null, factIds: [], confidence: 1, needsUser: true };
      if (f.type === "file") return { name: f.name, value: input.documents[0]?.id ?? null, source: input.documents[0] ? "document" : "none", key: k?.key ?? null, factIds: [], confidence: 0.5, needsUser: !input.documents[0] };
      return { name: f.name, value: `mock:${f.name}`, source: "profile", key: k?.key ?? null, factIds: [], confidence: 0.5, needsUser: false };
    });
  }

  async planBrowserStep(raw: PlanBrowserStepInput, ctx?: CallContext): Promise<BrowserStep> {
    PlanBrowserStepInput.parse(raw);
    this.report(ctx);
    return { action: "stop", target: null, value: null, done: true, needsUser: false, reason: "Mock: nothing to do" };
  }

  async recommendDirections(raw: RecommendDirectionsInput, ctx?: CallContext): Promise<DirectionPlan> {
    const input = RecommendDirectionsInput.parse(raw);
    this.report(ctx);
    const picks = input.candidates.filter((c) => c.open > 0 && c.forThem).slice(0, 2);
    return { summary: "Mock summary", directions: picks.map((c, i) => ({ id: c.id, reason: `Mock reason ${i + 1}`, strength: 1 - i * 0.2 })) };
  }
}

export const mockIntelligence = new MockIntelligence();
