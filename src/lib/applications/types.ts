import type { ApplicationAnswer, ApplicationEvidence, ApplicationOutcome, ApplicationQuestion, ApplicationStatus, ApplicationStepKind, ChannelId, FormField, StepStatus } from "@/lib/core/types";
import type { BoardColumn } from "@/lib/core/state-machine";

/*
 * Shapes shared by the engine, the API and the room UI (isomorphic, types only + tiny helpers).
 * The channel shapes mirror contracts §4 field for field (P3b's src/lib/channels owns the
 * implementation); keeping a structural copy here lets the client bundle and the pure planners
 * use them without importing server code.
 */

export interface FieldRequirement {
  name: string;
  label: string;
  type: FormField["type"];
  required: boolean;
  options?: string[];
  maxLength?: number;
  profilePath?: string;
  question?: boolean;
  /* optional extensions (P3b): value/label pairs, person-only fields, recognised semantic key */
  choices?: { value: string; label: string }[];
  userOnly?: boolean;
  help?: string;
  section?: string;
  key?: string;
}

export interface RequirementsLike {
  channel: ChannelId;
  fields: FieldRequirement[];
  materials: string[];
  questions: { id: string; prompt: string; maxWords?: number }[];
  requiresAccount: boolean;
  requiresPayment: boolean;
  captchaLikely: boolean;
  submitUrl?: string;
  notes: string[];
}

export interface HandoffPackage {
  url: string;
  steps: { n: number; text: string }[];
  fields: { label: string; value: string; long?: boolean }[];
  files: { name: string; documentId?: string; generatedDocumentId?: string }[];
  notes: string[];
}

export interface PreparedPackage {
  answers: Record<string, string>;
  files: { field: string; generatedDocumentId?: string; documentId?: string; filename: string }[];
  email?: { to: string; subject: string; body: string; contactId?: string };
  handoff: HandoffPackage;
}

export type SubmitResultLike =
  | { status: "submitted"; evidence: { confirmationText?: string; url?: string; ref?: string; screenshotKey?: string; messageId?: string } }
  | { status: "needs_you"; reason: "captcha" | "login" | "payment" | "unsupported" | "blocked" | "no_gmail"; handoff: HandoffPackage }
  | { status: "failed"; error: string; retryable: boolean; code?: string };

/** Why an application waits for the person (applications.needs_you_reason). */
export type NeedsYouReason =
  | "captcha"
  | "login"
  | "payment"
  | "unsupported"
  | "blocked"
  | "no_gmail"
  | "handoff"
  | "followup_approval"
  | "opportunity_missing"
  | "organiser_request"
  | "next_step";

/* ------------------------------------------------------------------ view models (API → UI) */

export interface StepView {
  n: number;
  kind: ApplicationStepKind;
  status: StepStatus;
  /** Short machine summary the UI turns into words (counts, document kinds, channel…). */
  summary: Record<string, string | number | boolean | null>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FactView {
  claim: string;
  quote: string | null;
  source: string | null;
  confirmedByUser: boolean;
}

export interface DocumentBlockView {
  type: "heading" | "paragraph" | "bullet" | "field";
  role: string;
  label?: string;
  text: string;
  factIds: string[];
  flags: string[];
}

export interface DocumentView {
  id: string;
  kind: string;
  title: string;
  language: string;
  version: number;
  label: "drafted_from_profile" | "written_with_ai" | "edited_by_you";
  blocks: DocumentBlockView[];
  gaps: { key: string; question: string }[];
  notes: string[];
  createdAt: string;
  /** Formats the person can download. */
  formats: ("pdf" | "docx" | "pptx")[];
}

export interface AnswerView {
  key: string;
  label: string;
  value: string;
  source: ApplicationAnswer["source"];
  factIds: string[];
  confirmed: boolean;
  long: boolean;
}

export interface OpportunityBrief {
  id: string;
  name: string;
  orgName: string | null;
  type: string;
  url: string | null;
  deadline: string | null;
  rolling: boolean;
}

export interface ApplicationView {
  id: string;
  status: ApplicationStatus;
  column: BoardColumn;
  channel: ChannelId;
  practice: boolean;
  needsYouReason: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  followUpAt: string | null;
  followUpsSent: number;
  opportunity: OpportunityBrief;
  goal: { id: string; label: string } | null;
  steps: StepView[];
  questions: ApplicationQuestion[];
  answers: AnswerView[];
  documents: DocumentView[];
  email: { documentId: string | null; to: string; subject: string; body: string } | null;
  handoff: HandoffPackage | null;
  evidence: ApplicationEvidence | null;
  outcome: ApplicationOutcome | null;
  facts: Record<string, FactView>;
  creditCost: number;
  creditsReserved: number;
  gmail: { connected: boolean; email: string | null } | null;
  /** A job is working on it right now (preparing, submitting, following up). */
  working: { kind: "prepare" | "submit" | "followup"; step: ApplicationStepKind | null } | null;
  /** Preparation gave up after its retries (the person can try again). */
  stalled: { error: string } | null;
  /** First submitted application of this person: the client fires the `unlock` event once. */
  unlock: boolean;
  /** Write-in label of the language the documents are in. */
  language: string;
}

export interface BoardCard {
  id: string;
  status: ApplicationStatus;
  column: BoardColumn;
  channel: ChannelId;
  practice: boolean;
  needsYouReason: string | null;
  openQuestions: number;
  goalId: string | null;
  opportunity: OpportunityBrief;
  updatedAt: string;
  submittedAt: string | null;
  followUpAt: string | null;
}

/** The key an answer to `q` is stored under in applications.answers. */
export function answerKeyOf(q: Pick<ApplicationQuestion, "id" | "fieldName">): string {
  return q.fieldName ?? q.id;
}

/** Statuses where a job is (or should be) running and the room polls. */
export const LIVE_STATUSES: readonly ApplicationStatus[] = ["draft", "preparing", "submitting"];
