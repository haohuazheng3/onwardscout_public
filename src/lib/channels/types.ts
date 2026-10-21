/*
 * Channel contracts (docs/contracts-features.md §4). Pure types: safe to import anywhere,
 * including client components (`import type`). The implementations live next to this file;
 * `@/lib/channels` (index.ts) is the server entry point P3a uses.
 *
 * Extensions beyond the contract are all OPTIONAL properties, so a consumer written against
 * the contract alone keeps compiling and behaving the same.
 */
import type { ChannelId, FormField } from "@/lib/core/types";
import type { Application, Opportunity } from "@/lib/db/schema";

export type { ChannelId };

/** One field of the target form, in the form's own order. */
export interface FieldRequirement {
  /** The form's own field name (submitted as-is; Google Forms: `entry.123`). */
  name: string;
  /** The label as the form shows it. */
  label: string;
  type: FormField["type"];
  required: boolean;
  /** Human-readable choices (labels) for select / multiselect / radio fields. */
  options?: string[];
  maxLength?: number;
  /** JSON pointer into the profile that answers this field (`/identity/email`). */
  profilePath?: string;
  /** A custom application question (as opposed to a standard contact field). */
  question?: boolean;
  /* ---- extensions (optional) ---- */
  /** Value + label pairs when the submitted value differs from the label (Greenhouse option ids, HTML option values). */
  choices?: { value: string; label: string }[];
  /** Only the person may answer: consent, signature, voluntary self-identification (EEO). Never pre-filled. */
  userOnly?: boolean;
  /** The organiser's help text under the field (plain text; data, never instructions). */
  help?: string;
  /** Accepted file types for `file` fields (".pdf,.docx"). */
  accept?: string;
  /** Section heading the field sits under ("Voluntary self-identification"). */
  section?: string;
  /** Semantic key the field was recognised as (`full_name`, `why_this`…), or undefined. */
  key?: string;
}

export interface Requirements {
  channel: ChannelId;
  fields: FieldRequirement[];
  /** Material ids (src/lib/core MATERIAL_IDS) the application needs. */
  materials: string[];
  /** Long-form prompts to compose (custom questions), keyed by the field name. */
  questions: { id: string; prompt: string; maxWords?: number }[];
  requiresAccount: boolean;
  requiresPayment: boolean;
  captchaLikely: boolean;
  /** Where the application is submitted (hosted form, form page, mailto:). */
  submitUrl?: string;
  /** Honest notes for the person ("This form uses a CAPTCHA: you'll finish it in a 30-second handoff"). */
  notes: string[];
}

export interface PreparedFile {
  /** The form field the file goes into (`resume`, `cover_letter`, `question_123`). */
  field: string;
  generatedDocumentId?: string;
  documentId?: string;
  filename: string;
}

export interface PreparedPackage {
  /** Final answers keyed by field name (choice fields: the option label or value). */
  answers: Record<string, string>;
  files: PreparedFile[];
  email?: { to: string; subject: string; body: string; contactId?: string };
  handoff: HandoffPackage;
}

export interface HandoffPackage {
  url: string;
  steps: { n: number; text: string }[];
  fields: { label: string; value: string; long?: boolean }[];
  files: { name: string; documentId?: string; generatedDocumentId?: string }[];
  notes: string[];
}

export interface SubmitContext {
  userId: string;
  application: Application;
  opportunity: Opportunity;
  prepared: PreparedPackage;
  /**
   * Do everything except the final send. A `submitted` result then means "ready to submit"
   * (its evidence.confirmationText starts with "Dry run"); nothing left Onward Scout.
   */
  dryRun?: boolean;
}

export type NeedsYouReason = "captcha" | "login" | "payment" | "unsupported" | "blocked" | "no_gmail";

export type SubmitResult =
  | { status: "submitted"; evidence: { confirmationText?: string; url?: string; ref?: string; screenshotKey?: string; messageId?: string } }
  | { status: "needs_you"; reason: NeedsYouReason; handoff: HandoffPackage }
  | { status: "failed"; error: string; retryable: boolean };

/** A file ready to upload or attach. */
export interface LoadedFile {
  field: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Optional dependencies a caller (or a test) may inject. Production callers pass nothing:
 * every default reads from the database / R2 / the documents module.
 */
export interface ChannelDeps {
  /** Loads the bytes of a prepared file. */
  loadFile?: (userId: string, file: PreparedFile) => Promise<LoadedFile | null>;
  /** Stores a CH3 step screenshot; returns its R2 key (default: `screenKey` in R2). */
  storeScreenshot?: (input: { userId: string; applicationId: string; n: number; png: Uint8Array }) => Promise<string | null>;
  /** Overrides BROWSER_AGENT_ENABLED (tests, local runs). */
  browserEnabled?: boolean;
  /** CH3: hard time budget in ms (default 120 000). */
  timeBudgetMs?: number;
  /** CH3: called after every browser action (for the application's step log). */
  onStep?: (step: { n: number; action: string; target: string | null; ok: boolean; note: string | null; screenshotKey: string | null }) => void;
  /** Overrides how the person's profile and facts are loaded (tests, local runs). */
  loadPerson?: (userId: string) => Promise<PersonContext>;
}

/** The person's profile as the channels need it (see context.ts). */
export interface PersonContext {
  profile: unknown;
  facts: { id: string; path: string; claim: string; value?: unknown; quote?: string | null; sourceDocId?: string | null; confidence?: number | null; confirmedByUser?: boolean | null }[];
  name: string | null;
  isMinor: boolean;
  language: "en" | "zh";
}

export interface Channel {
  id: ChannelId;
  analyze(opp: Opportunity): Promise<Requirements>;
  submit(ctx: SubmitContext, deps?: ChannelDeps): Promise<SubmitResult>;
  followUp?(ctx: SubmitContext & { attempt: number }, deps?: ChannelDeps): Promise<SubmitResult>;
}
