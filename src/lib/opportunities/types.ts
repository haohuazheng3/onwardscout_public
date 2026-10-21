/**
 * Client-safe shapes the opportunity engine hands to pages, API responses and other features
 * (P1 home "this week's picks", P5b public lists, P6 digest). Dates are ISO strings so the same
 * object travels through RSC props and JSON responses unchanged.
 */
import type {
  ApplicationStatus,
  ChannelId,
  Eligibility,
  MatchFeedback,
  MaterialId,
  OpportunityBenefits,
  OpportunityCost,
  OpportunityGeo,
  OpportunityStatus,
  OpportunityTypeId,
} from "@/lib/core/types";

/** One opportunity as a list shows it (no description, no raw form schema). */
export interface OpportunityCard {
  id: string;
  slug: string;
  type: OpportunityTypeId;
  name: string;
  orgName: string | null;
  orgSlug: string | null;
  /** The official page (null when unknown → "check the official page"). */
  url: string | null;
  summary: string | null;
  /** ISO timestamp, or null when the organiser gives none. */
  deadline: string | null;
  rolling: boolean;
  cycle: string | null;
  geo: OpportunityGeo;
  benefits: OpportunityBenefits | null;
  cost: OpportunityCost | null;
  /** How Onward Scout applies (apply.channel, else the type's default channel). */
  channel: ChannelId;
  requiresAccount: boolean;
  requiresPayment: boolean;
  captchaLikely: boolean;
  requiredMaterials: MaterialId[];
  tags: string[];
  estEffortMinutes: number | null;
  qualityScore: number | null;
  verifiedAt: string | null;
  /** Last real change of the row (sitemap lastmod). */
  updatedAt: string | null;
  status: OpportunityStatus;
  public: boolean;
  /** Added by this person from a link (private to them, not yet reviewed). */
  mine: boolean;
  createdAt: string;
}

/** The person-specific half of a match row. */
export interface MatchInfo {
  id: string;
  goalId: string | null;
  /** 0–100. */
  fit: number;
  /** 0–1, null until estimated. */
  winProbability: number | null;
  /** Estimated minutes of the person's own time (we prepare the rest). */
  effortMinutes: number | null;
  /** 0–100 value to the goal. */
  value: number | null;
  reasons: string[];
  gaps: string[];
  /** 0 = pinned (the practice run, links the person added), 1 = best; null = not on the board. */
  rank: number | null;
  feedback: MatchFeedback | null;
  feedbackReason: string | null;
  createdAt: string;
  /** Matched in the last seven days and not acted on yet. */
  isNew: boolean;
}

/** `topMatches()` result: a match with its opportunity. */
export interface MatchCard extends MatchInfo {
  opportunity: OpportunityCard;
}

/** One row of the Scout board (a pick, a "later", or a catalog result in the "all" view). */
export interface BoardItem {
  opportunity: OpportunityCard;
  match: MatchInfo | null;
  application: { id: string; status: ApplicationStatus } | null;
}

export interface BoardPage {
  items: BoardItem[];
  /** Offset of the next page, null at the end. */
  next: number | null;
}

/** Everything the detail page needs. */
export interface OpportunityDetail extends OpportunityCard {
  description: string | null;
  eligibility: Eligibility | null;
  languages: string[];
  industries: string[];
  functions: string[];
  applyUrl: string | null;
  applyEmail: string | null;
  platform: string | null;
  instructions: string | null;
  estAcceptanceRate: number | null;
}

export const FEEDBACK_REASONS = ["wrong_location", "not_my_field", "bad_timing", "not_this_type", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
