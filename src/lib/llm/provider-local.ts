import type {
  AnswerQuestionsInput,
  BrowserStep,
  ClassifyReplyInput,
  ComposedDocument,
  DirectionPlan,
  ComposeInput,
  ExtractProfileInput,
  ExtractProfileOutput,
  FieldMapping,
  Intelligence,
  MapFormFieldsInput,
  MatchScore,
  NormalizedOpportunity,
  NormalizeOpportunityInput,
  PlanBrowserStepInput,
  QuestionAnswer,
  RecommendDirectionsInput,
  ReplyClassification,
  ScoreMatchesInput,
} from "./types";
import { localAnswerQuestions } from "./local/answers";
import { localCompose } from "./local/compose";
import { localRecommendDirections } from "./local/directions";
import { localExtractProfile } from "./local/extract";
import { localMapFormFields, localPlanBrowserStep } from "./local/forms";
import { localScoreMatches } from "./local/match";
import { localNormalizeOpportunity } from "./local/opportunity";
import { localClassifyReply } from "./local/reply";

/*
 * The deterministic engine: what production runs until ANTHROPIC_API_KEY is enabled, and
 * the fallback whenever Claude fails, refuses or the person's monthly budget is spent.
 * Real output from real input — heuristic parsers, rule-based matching, template
 * composition from facts — labelled "drafted from your profile" in the UI. Pure CPU, no
 * network, no cost.
 */
export class LocalIntelligence implements Intelligence {
  readonly provider = "local" as const;

  async extractProfile(input: ExtractProfileInput): Promise<ExtractProfileOutput> {
    return localExtractProfile(input);
  }
  async normalizeOpportunity(input: NormalizeOpportunityInput): Promise<NormalizedOpportunity> {
    return localNormalizeOpportunity(input);
  }
  async scoreMatches(input: ScoreMatchesInput): Promise<MatchScore[]> {
    return localScoreMatches(input);
  }
  async compose(input: ComposeInput): Promise<ComposedDocument> {
    return localCompose(input);
  }
  async answerQuestions(input: AnswerQuestionsInput): Promise<QuestionAnswer[]> {
    return localAnswerQuestions(input);
  }
  async classifyReply(input: ClassifyReplyInput): Promise<ReplyClassification> {
    return localClassifyReply(input);
  }
  async mapFormFields(input: MapFormFieldsInput): Promise<FieldMapping[]> {
    return localMapFormFields(input);
  }
  async planBrowserStep(input: PlanBrowserStepInput): Promise<BrowserStep> {
    return localPlanBrowserStep(input);
  }
  async recommendDirections(input: RecommendDirectionsInput): Promise<DirectionPlan> {
    return localRecommendDirections(input);
  }
}

export const localIntelligence = new LocalIntelligence();
