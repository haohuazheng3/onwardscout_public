import { z } from "zod";
import {
  DOCUMENT_KINDS,
  GENERATED_BLOCK_TYPES,
  BLOCK_FLAGS,
  IDENTITY_CODES,
  MESSAGE_CLASSIFICATIONS,
  profileSchema,
  type GeneratedContent,
  type Profile,
} from "@/lib/core/types";

/*
 * The intelligence contract. ONE interface (`Intelligence`) with three implementations:
 * `anthropic` (Claude via the Messages API), `local` (the deterministic engine production
 * runs until the key is enabled) and `mock` (canned, tests only). Every input and output is
 * a zod schema: providers validate what they return, callers can trust the shapes.
 *
 * The profile is F2's `Profile` (src/lib/core/types.ts). Facts point into it with JSON
 * pointers that use item ids: `/experience/<id>`, `/identity/email`, `/skills/3`,
 * `/packs/founder/ventures/<id>/traction/items/0`.
 *
 * Honesty rules encoded here:
 *  - every extracted fact carries the source document id and a verbatim quote (quotes are
 *    checked against the document text; unverifiable ones lose confidence);
 *  - every generated claim block carries the fact ids it rests on; a missing fact becomes a
 *    `gap` block plus a `gaps[]` question, never invented text;
 *  - unknown opportunity fields are null ("check the official page").
 */

export const LANGUAGES = ["en", "zh"] as const;
export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

export const DocumentKind = z.enum(DOCUMENT_KINDS);

/** Reads a stored profile leniently: defaults fill missing keys, invalid items are dropped. */
export function readProfile(input: unknown): Profile {
  const whole = profileSchema.safeParse(input ?? {});
  if (whole.success) return whole.data;
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const base = profileSchema.parse({});
  const shape = profileSchema.shape;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    const field = shape[key];
    const value = src[key];
    if (value === undefined) continue;
    const parsed = field.safeParse(value);
    if (parsed.success) {
      out[key] = parsed.data;
      continue;
    }
    // Arrays: keep the items that are valid on their own.
    if (Array.isArray(value)) {
      const itemSchema = (field as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.() as unknown as { element?: z.ZodTypeAny } | undefined;
      const element = itemSchema?.element;
      if (element) out[key] = value.map((v) => element.safeParse(v)).filter((r) => r.success).map((r) => r.data);
    }
  }
  return profileSchema.parse(out);
}

/* ------------------------------------------------------------------ facts */

/** A fact as extracted (no id yet): P1 inserts it into `facts` and gets an id. */
export const ExtractedFact = z.object({
  /** JSON pointer into the Profile, e.g. "/experience/exp_3fa9c1d2e0" or "/identity/email". */
  path: z.string(),
  /** One human sentence, e.g. "Worked as Product Designer at Quillfeather Health (2021–present)". */
  claim: z.string(),
  /** The value at `path` (a string, number, or the whole item object). */
  value: z.unknown(),
  sourceDocId: z.string().nullable(),
  /** Verbatim excerpt from the source document (≤ 300 chars). */
  quote: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

/** A stored fact as the composer receives it (a `facts` row). */
export const FactRef = z.object({
  id: z.string(),
  path: z.string(),
  claim: z.string(),
  value: z.unknown().optional(),
  quote: z.string().nullable().optional(),
  sourceDocId: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  confirmedByUser: z.boolean().nullable().optional(),
});
export type FactRef = z.infer<typeof FactRef>;

export const IdentityGuess = z.object({
  code: z.enum(IDENTITY_CODES),
  confidence: z.number().min(0).max(1),
  /** Why we think so, one short sentence quoting the cue. */
  why: z.string(),
  /** A stage id from core/identities.ts `stagesFor(code)`, when evident. */
  stage: z.string().nullable(),
});
export type IdentityGuess = z.infer<typeof IdentityGuess>;

/* ------------------------------------------------------------------ extraction IR */

/*
 * The intermediate representation every extractor produces (local parsers and Claude alike):
 * items with their source. `buildProfile` (src/lib/llm/build.ts) turns it into a Profile plus
 * facts, assigning stable item ids and checking quotes against the documents.
 */

export const Src = z.object({
  docId: z.string().nullable(),
  /** Verbatim excerpt from that document supporting the item. */
  quote: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Src = z.infer<typeof Src>;

const S = z.string().nullable();

export const IrIdentityField = z.enum(["name", "headline", "email", "phone", "location", "birthYear", "summary"]);

export const ExtractionIR = z.object({
  identity: z.array(z.object({ field: IrIdentityField, value: z.string(), src: Src })),
  links: z.array(z.object({ url: z.string(), label: S, src: Src })),
  languages: z.array(z.object({ name: z.string(), level: S, src: Src })),
  workAuthorization: z.array(z.object({ countryCode: z.string(), status: z.string(), note: S, src: Src })),
  experience: z.array(
    z.object({
      organization: S,
      title: S,
      employmentType: S,
      location: S,
      startDate: S,
      endDate: S,
      current: z.boolean(),
      summary: S,
      highlights: z.array(z.string()),
      skills: z.array(z.string()),
      src: Src,
    }),
  ),
  education: z.array(
    z.object({
      institution: S,
      degree: S,
      level: S,
      field: S,
      location: S,
      startDate: S,
      endDate: S,
      current: z.boolean(),
      gpa: S,
      honors: z.array(z.string()),
      courses: z.array(z.string()),
      description: S,
      src: Src,
    }),
  ),
  projects: z.array(z.object({ name: z.string(), role: S, url: S, startDate: S, endDate: S, summary: S, highlights: z.array(z.string()), skills: z.array(z.string()), src: Src })),
  skills: z.array(z.object({ name: z.string(), category: S, level: S, src: Src })),
  achievements: z.array(z.object({ title: z.string(), kind: S, issuer: S, date: S, amountText: S, description: S, src: Src })),
  publications: z.array(z.object({ title: z.string(), kind: S, status: S, venue: S, year: z.number().int().nullable(), authors: z.array(z.string()), doi: S, url: S, src: Src })),
  certifications: z.array(z.object({ name: z.string(), issuer: S, credentialId: S, issuedAt: S, expiresAt: S, src: Src })),
  ventures: z.array(
    z.object({
      company: z.string(),
      /** field ∈ oneLiner | website | industry | stage | teamSize | product | businessModel | problem | market | useOfFunds | round | raising | role | founded | location */
      fields: z.array(z.object({ field: z.string(), value: z.string(), src: Src })),
      traction: z.array(z.object({ text: z.string(), src: Src })),
      team: z.array(z.object({ name: z.string(), role: S, background: S, src: Src })),
      src: Src,
    }),
  ),
  jobSeeker: z.object({
    targetTitles: z.array(z.object({ value: z.string(), src: Src })),
    locations: z.array(z.object({ value: z.string(), src: Src })),
  }),
  testScores: z.array(z.object({ test: z.string(), score: z.string(), src: Src })),
  research: z.object({
    fields: z.array(z.object({ value: z.string(), src: Src })),
    hIndex: z.object({ value: z.number().int(), src: Src }).nullable(),
    orcid: z.object({ value: z.string(), src: Src }).nullable(),
    grants: z.array(z.object({ title: z.string(), funder: S, year: z.number().int().nullable(), amountText: S, src: Src })),
  }),
  creator: z.object({
    audience: z.array(z.object({ platform: z.string(), followers: z.number().nullable(), url: S, src: Src })),
    brands: z.array(z.object({ value: z.string(), src: Src })),
  }),
  licenses: z.array(z.object({ type: z.string(), number: S, jurisdiction: S, expiresAt: S, src: Src })),
});
export type ExtractionIR = z.infer<typeof ExtractionIR>;

export function emptyIR(): ExtractionIR {
  return {
    identity: [],
    links: [],
    languages: [],
    workAuthorization: [],
    experience: [],
    education: [],
    projects: [],
    skills: [],
    achievements: [],
    publications: [],
    certifications: [],
    ventures: [],
    jobSeeker: { targetTitles: [], locations: [] },
    testScores: [],
    research: { fields: [], hIndex: null, orcid: null, grants: [] },
    creator: { audience: [], brands: [] },
    licenses: [],
  };
}

/* ------------------------------------------------------------------ extractProfile */

export const ExtractDocument = z.object({
  id: z.string(),
  kind: DocumentKind,
  filename: z.string(),
  /** Extracted text (may be empty for images and scans). */
  text: z.string(),
  /** Original bytes, base64, for files only a vision-capable model can read (scans, images). */
  imageBase64: z.string().optional(),
  /** "application/pdf" or image/png|jpeg|gif|webp for `imageBase64`. */
  mediaType: z.string().optional(),
  /** For documents that came from a link (kind "link"). */
  sourceUrl: z.string().nullable().optional(),
});
export type ExtractDocument = z.infer<typeof ExtractDocument>;

export const ExtractProfileInput = z.object({
  documents: z.array(ExtractDocument),
  /** Links the user pasted (kept on the profile even when not fetched, e.g. LinkedIn). */
  links: z.array(z.object({ url: z.string(), label: z.string().nullable().optional() })).default([]),
  locale: Language.default("en"),
  /** "Now" for date reasoning (tests pass a fixed date). */
  now: z.union([z.string(), z.date()]).optional(),
});
export type ExtractProfileInput = z.input<typeof ExtractProfileInput>;

export const ExtractProfileOutput = z.object({
  profile: profileSchema,
  facts: z.array(ExtractedFact),
  identities: z.array(IdentityGuess),
  /** Questions to ask the person (choice-first), in the request locale. */
  gaps: z.array(z.string()),
});
export type ExtractProfileOutput = z.infer<typeof ExtractProfileOutput>;

/* ------------------------------------------------------------------ opportunities */

/** An opportunity as the matcher/composer reads it (camelCase `opportunities` row, lenient). */
export const OpportunityInput = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  orgName: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  industries: z.array(z.string()).nullable().optional(),
  functions: z.array(z.string()).nullable().optional(),
  languages: z.array(z.string()).nullable().optional(),
  geo: z
    .object({
      countries: z.array(z.string()).optional(),
      cities: z.array(z.string()).optional(),
      remote: z.union([z.string(), z.boolean()]).nullable().optional(),
      worldwide: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  eligibility: z
    .object({
      identities: z.array(z.string()).optional(),
      stages: z.array(z.string()).optional(),
      degree: z.string().nullable().optional(),
      minYears: z.number().nullable().optional(),
      maxYears: z.number().nullable().optional(),
      nationality: z.array(z.string()).optional(),
      residency: z.array(z.string()).optional(),
      ageMin: z.number().nullable().optional(),
      ageMax: z.number().nullable().optional(),
      studentsOnly: z.boolean().nullable().optional(),
      companyMaxAgeYears: z.number().nullable().optional(),
      notes: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  deadline: z.union([z.string(), z.date()]).nullable().optional(),
  rolling: z.boolean().nullable().optional(),
  benefits: z.unknown().optional(),
  cost: z.unknown().optional(),
  requiredMaterials: z.array(z.string()).nullable().optional(),
  estAcceptanceRate: z.number().nullable().optional(),
  estEffortMinutes: z.number().nullable().optional(),
  qualityScore: z.number().nullable().optional(),
  apply: z.object({ channel: z.string().optional(), url: z.string().nullable().optional(), email: z.string().nullable().optional() }).passthrough().nullable().optional(),
});
export type OpportunityInput = z.input<typeof OpportunityInput>;

export const NormalizeOpportunityInput = z.object({
  url: z.string(),
  /** Readable page text (from ingestUrl / the crawler). */
  text: z.string().optional(),
  /** Raw HTML when available; the local engine reads JSON-LD and meta from it. */
  html: z.string().optional(),
  /** Hints from the source (ATS board name, curated seed fields). */
  hint: z.object({ type: z.string().optional(), orgName: z.string().optional(), name: z.string().optional() }).optional(),
  /** "Now" for deadline interpretation (tests pass a fixed date). */
  now: z.union([z.string(), z.date()]).optional(),
});
export type NormalizeOpportunityInput = z.input<typeof NormalizeOpportunityInput>;

const NMoney = z.object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable(), text: z.string().nullable() });

/** What normalizeOpportunity returns: the `opportunities` row fields P2b needs (unknown = null). */
export const NormalizedOpportunity = z.object({
  type: z.string().nullable(),
  name: z.string().nullable(),
  orgName: z.string().nullable(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  url: z.string(),
  /** ISO date (YYYY-MM-DD) or datetime when the page states one. */
  deadline: z.string().nullable(),
  rolling: z.boolean(),
  cycle: z.string().nullable(),
  geo: z.object({ countries: z.array(z.string()), cities: z.array(z.string()), remote: z.enum(["remote", "hybrid", "onsite"]).nullable(), worldwide: z.boolean() }),
  languages: z.array(z.string()),
  tags: z.array(z.string()),
  industries: z.array(z.string()),
  functions: z.array(z.string()),
  eligibility: z.object({
    identities: z.array(z.string()),
    stages: z.array(z.string()),
    degree: z.string().nullable(),
    minYears: z.number().nullable(),
    maxYears: z.number().nullable(),
    nationality: z.array(z.string()),
    residency: z.array(z.string()),
    ageMin: z.number().nullable(),
    ageMax: z.number().nullable(),
    studentsOnly: z.boolean().nullable(),
    notes: z.string().nullable(),
  }),
  benefits: z.object({ summary: z.string().nullable(), money: NMoney.nullable(), perks: z.array(z.string()) }),
  cost: z.object({ free: z.boolean().nullable(), applicationFee: NMoney.nullable(), equityPercent: z.number().nullable(), notes: z.string().nullable() }),
  requiredMaterials: z.array(z.string()),
  apply: z.object({
    channel: z.string().nullable(),
    url: z.string().nullable(),
    email: z.string().nullable(),
    platform: z.string().nullable(),
    requiresAccount: z.boolean().nullable(),
    requiresPayment: z.boolean().nullable(),
  }),
  estEffortMinutes: z.number().nullable(),
  /** 0..1: how complete and certain the extraction is. */
  confidence: z.number().min(0).max(1),
  /** Field names that could not be determined (shown as "check the official page"). */
  missing: z.array(z.string()),
  /** True when the page says the program is closed or the stated deadline has passed. */
  expired: z.boolean(),
});
export type NormalizedOpportunity = z.infer<typeof NormalizedOpportunity>;

/* ------------------------------------------------------------------ matching */

export const GoalInput = z.object({
  id: z.string(),
  family: z.string(),
  sub: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  successDefinition: z.string().nullable().optional(),
  constraints: z
    .object({
      geo: z.array(z.string()).optional(),
      remote: z.union([z.boolean(), z.string()]).nullable().optional(),
      budget: z.number().nullable().optional(),
      timePerWeek: z.number().nullable().optional(),
      salaryMin: z.number().nullable().optional(),
      currency: z.string().nullable().optional(),
      opportunityTypes: z.array(z.string()).optional(),
      languages: z.array(z.string()).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  /** Opportunity types this goal pursues (core/goals.ts sub-goal), when the caller knows them. */
  opportunityTypes: z.array(z.string()).optional(),
});
export type GoalInput = z.input<typeof GoalInput>;

export const ScoreMatchesInput = z.object({
  profile: z.unknown(),
  goals: z.array(GoalInput),
  opportunities: z.array(OpportunityInput),
  language: Language.default("en"),
  now: z.union([z.string(), z.date()]).optional(),
});
export type ScoreMatchesInput = z.input<typeof ScoreMatchesInput>;

export const MatchScore = z.object({
  opportunityId: z.string(),
  /** The goal this match serves best (null when no goal applies). */
  goalId: z.string().nullable(),
  /** 0..100 */
  fit: z.number().int().min(0).max(100),
  /** 0..1 */
  winProbability: z.number().min(0).max(1),
  /** 0..100, higher = more of the person's own time (we prepare everything else). */
  effort: z.number().int().min(0).max(100),
  /** 0..100 */
  value: z.number().int().min(0).max(100),
  /** False when a hard eligibility rule excludes the person (see blockers). */
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  gaps: z.array(z.string()),
  blockers: z.array(z.string()),
});
export type MatchScore = z.infer<typeof MatchScore>;

/* ------------------------------------------------------------------ compose */

export const COMPOSE_KINDS = [
  "cover_letter",
  "email_investor",
  "email_recruiter",
  "email_professor",
  "email_editor",
  "email_brand",
  "email_client",
  "email_follow_up",
  "answer",
  "bio",
  "one_pager",
] as const;
export const ComposeKind = z.enum(COMPOSE_KINDS);
export type ComposeKind = z.infer<typeof ComposeKind>;

/** Common application questions the composer answers from facts. */
export const QUESTION_KEYS = [
  "why_this",
  "about_you",
  "proud_project",
  "startup_description",
  "problem",
  "traction",
  "team",
  "use_of_funds",
  "availability",
  "experience",
  "skills",
  "education",
  "research_interest",
  "other",
] as const;
export const QuestionKey = z.enum(QUESTION_KEYS);
export type QuestionKey = z.infer<typeof QuestionKey>;

export const Tone = z.enum(["professional", "warm", "concise", "enthusiastic"]);
export type Tone = z.infer<typeof Tone>;

export const ContactInput = z.object({
  name: z.string().nullable().optional(),
  org: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
});

export const ComposeInput = z.object({
  kind: ComposeKind,
  profile: z.unknown(),
  facts: z.array(FactRef),
  opportunity: OpportunityInput.nullable().optional(),
  contact: ContactInput.nullable().optional(),
  /** The person's own words keyed by question key or field name ({why_this: "…"}); cited as `answer:<key>`. */
  answers: z.record(z.string(), z.string()).default({}),
  language: Language.default("en"),
  tone: Tone.default("professional"),
  maxWords: z.number().int().positive().optional(),
  /** For kind "answer": the question as the form asks it, and/or its key. */
  question: z.string().optional(),
  questionKey: QuestionKey.optional(),
  /** For kind "bio": first or third person (default third). */
  perspective: z.enum(["first", "third"]).optional(),
  /** For kind "email_follow_up": the message being followed up. */
  previous: z.object({ subject: z.string().nullable().optional(), sentAt: z.union([z.string(), z.date()]).nullable().optional() }).nullable().optional(),
  now: z.union([z.string(), z.date()]).optional(),
});
export type ComposeInput = z.input<typeof ComposeInput>;

/**
 * What a block does in the document. `body` blocks make claims about the person and must
 * cite facts. `context` blocks only refer to the opportunity or the conversation ("I'm
 * writing about the Product Designer role at Acme") and make no claim about the person.
 * The rest are structure (greeting, sign-off, headings) or a `gap` the person fills.
 */
export const BLOCK_ROLES = ["subject", "greeting", "context", "body", "closing", "signature", "heading", "gap"] as const;
export const BlockRole = z.enum(BLOCK_ROLES);
export type BlockRole = z.infer<typeof BlockRole>;

/** A block: F2's stored `generatedBlockSchema` shape plus a presentational `role`. */
export const ComposedBlock = z.object({
  type: z.enum(GENERATED_BLOCK_TYPES),
  role: BlockRole,
  label: z.string().optional(),
  text: z.string(),
  /** Fact ids (or `answer:<key>` for the person's own answers) this block rests on. */
  factIds: z.array(z.string()),
  flags: z.array(z.enum(BLOCK_FLAGS)),
});
export type ComposedBlock = z.infer<typeof ComposedBlock>;

export const ContentGap = z.object({
  /** Question key or profile path the person should supply. */
  key: z.string(),
  /** The question to ask, in the composition language. */
  question: z.string(),
});
export type ContentGap = z.infer<typeof ContentGap>;

/**
 * A composed document. `{format, blocks}` is directly storable as F2's GeneratedContent
 * (`toGeneratedContent` strips the extras); the rest is metadata for the UI.
 */
export const ComposedDocument = z.object({
  format: z.literal("blocks"),
  kind: ComposeKind,
  language: Language,
  title: z.string(),
  blocks: z.array(ComposedBlock),
  gaps: z.array(ContentGap),
  /** Notes for the person (e.g. lines quoted from a document in another language). */
  notes: z.array(z.string()),
  /** Every fact id cited by any block (deduplicated). */
  factIds: z.array(z.string()),
  wordCount: z.number().int(),
  /** Shown to the person: "drafted from your profile" (local) or "written with AI" (Claude). */
  label: z.enum(["drafted_from_profile", "written_with_ai"]),
});
export type ComposedDocument = z.infer<typeof ComposedDocument>;

/** The storable shape (F2 `GeneratedContent`) of a composed document. */
export function toGeneratedContent(doc: ComposedDocument): GeneratedContent {
  return {
    format: "blocks",
    blocks: doc.blocks.map((b) => ({ type: b.type, ...(b.label ? { label: b.label } : {}), text: b.text, factIds: b.factIds, flags: b.flags })),
  };
}

/* ------------------------------------------------------------------ answerQuestions */

export const QuestionInput = z.object({
  id: z.string(),
  text: z.string(),
  /** short | long | choice | multi | boolean | number | date | file | url | email | phone */
  type: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  maxWords: z.number().int().positive().optional(),
});
export type QuestionInput = z.input<typeof QuestionInput>;

export const AnswerQuestionsInput = z.object({
  questions: z.array(QuestionInput),
  profile: z.unknown(),
  facts: z.array(FactRef),
  opportunity: OpportunityInput.nullable().optional(),
  answers: z.record(z.string(), z.string()).default({}),
  language: Language.default("en"),
  now: z.union([z.string(), z.date()]).optional(),
});
export type AnswerQuestionsInput = z.input<typeof AnswerQuestionsInput>;

export const QuestionAnswer = z.object({
  questionId: z.string(),
  answer: z.string().nullable(),
  factIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  /** True when only the person can answer (motivation, consent, sensitive data, missing facts). */
  needsUser: z.boolean(),
  /** Why the person is needed, in the request language. */
  reason: z.string().nullable(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

/* ------------------------------------------------------------------ classifyReply */

export const ReplyClass = z.enum(MESSAGE_CLASSIFICATIONS);
export type ReplyClass = z.infer<typeof ReplyClass>;

export const ClassifyReplyInput = z.object({
  text: z.string(),
  subject: z.string().optional(),
  language: Language.default("en"),
});
export type ClassifyReplyInput = z.input<typeof ClassifyReplyInput>;

export const ReplyClassification = z.object({
  classification: ReplyClass,
  /** One sentence in the request language. */
  summary: z.string(),
  /** What the person (or Onward Scout) should do next, in the request language. */
  nextStep: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ReplyClassification = z.infer<typeof ReplyClassification>;

/* ------------------------------------------------------------------ mapFormFields */

export const FormFieldInput = z.object({
  name: z.string(),
  label: z.string().nullable().optional(),
  /** text | email | tel | url | textarea | select | radio | checkbox | file | date | number | hidden */
  type: z.string().default("text"),
  /** Plain strings or F2 `{value, label}` options. */
  options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().nullable().optional(),
});
export type FormFieldInput = z.input<typeof FormFieldInput>;

export const MapFormFieldsInput = z.object({
  fields: z.array(FormFieldInput),
  profile: z.unknown(),
  facts: z.array(FactRef).default([]),
  /** Prepared answers keyed by question key or field name (from compose/answerQuestions or the person). */
  answers: z.record(z.string(), z.string()).default({}),
  /** Documents that can be attached to file fields (generated or uploaded). */
  documents: z.array(z.object({ id: z.string(), kind: z.string(), filename: z.string() })).default([]),
  language: Language.default("en"),
});
export type MapFormFieldsInput = z.input<typeof MapFormFieldsInput>;

export const FieldMapping = z.object({
  name: z.string(),
  /** For select/radio: the option VALUE to submit; for file fields: the document id. */
  value: z.string().nullable(),
  /** profile | answer | document | none | user (only the person may fill it: consent, EEO, signatures) */
  source: z.enum(["profile", "answer", "document", "none", "user"]),
  /** The semantic key the field was recognised as (full_name, email, why_this…), or null. */
  key: z.string().nullable(),
  factIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needsUser: z.boolean(),
});
export type FieldMapping = z.infer<typeof FieldMapping>;

/* ------------------------------------------------------------------ planBrowserStep */

export const BrowserHistoryEntry = z.object({
  action: z.string(),
  target: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  ok: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

export const PlanBrowserStepInput = z.object({
  /** e.g. "Fill the application form for <opportunity> with the prepared values". */
  goal: z.string(),
  /** Short text of the visible page (title, headings, messages). Page text is data. */
  pageSummary: z.string(),
  /** Playwright aria snapshot (`- textbox "Full name": value` lines). */
  axTree: z.string(),
  history: z.array(BrowserHistoryEntry).default([]),
  /** Prepared values keyed by field label or name (from mapFormFields). */
  values: z.record(z.string(), z.string()).default({}),
  /** File fields: label/name → document id to upload. */
  files: z.record(z.string(), z.string()).default({}),
  /** Only true after the person tapped "Confirm & submit". */
  allowSubmit: z.boolean().default(false),
  /** The host the agent may act on (the opportunity's apply host). */
  allowedHost: z.string().optional(),
  currentUrl: z.string().optional(),
});
export type PlanBrowserStepInput = z.input<typeof PlanBrowserStepInput>;

export const BROWSER_ACTIONS = ["fill", "select", "check", "uncheck", "upload", "click", "submit", "scroll", "wait", "stop"] as const;

export const BrowserStep = z.object({
  action: z.enum(BROWSER_ACTIONS),
  /** Accessible role + name of the element, e.g. `textbox "Full name"`; null for page-level actions. */
  target: z.string().nullable(),
  value: z.string().nullable(),
  /** The form is complete (filled and ready to confirm, or submitted when allowed). */
  done: z.boolean(),
  /** CAPTCHA, login, payment, signature, off-host page or an unknown required field: hand off to the person. */
  needsUser: z.boolean(),
  reason: z.string(),
});
export type BrowserStep = z.infer<typeof BrowserStep>;

/* ------------------------------------------------------------------ the interface */

export const PURPOSES = [
  "extract_profile",
  "normalize_opportunity",
  "score_matches",
  "compose",
  "answer_questions",
  "classify_reply",
  "map_form_fields",
  "plan_browser_step",
] as const;
export type Purpose = (typeof PURPOSES)[number];

export type ProviderName = "anthropic" | "local" | "mock";

/** What one model call cost; providers report it through `CallContext.report`. */
export interface UsageReport {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache. */
  cachedTokens: number;
  /** Tokens written to the prompt cache. */
  cacheWriteTokens: number;
  costCents: number;
}

export interface CallContext {
  userId?: string | null;
  signal?: AbortSignal;
  /** Called by providers that spend money (anthropic) once per model response. */
  report?: (usage: UsageReport) => void;
}

export interface Intelligence {
  readonly provider: ProviderName;
  extractProfile(input: ExtractProfileInput, ctx?: CallContext): Promise<ExtractProfileOutput>;
  normalizeOpportunity(input: NormalizeOpportunityInput, ctx?: CallContext): Promise<NormalizedOpportunity>;
  scoreMatches(input: ScoreMatchesInput, ctx?: CallContext): Promise<MatchScore[]>;
  compose(input: ComposeInput, ctx?: CallContext): Promise<ComposedDocument>;
  answerQuestions(input: AnswerQuestionsInput, ctx?: CallContext): Promise<QuestionAnswer[]>;
  classifyReply(input: ClassifyReplyInput, ctx?: CallContext): Promise<ReplyClassification>;
  mapFormFields(input: MapFormFieldsInput, ctx?: CallContext): Promise<FieldMapping[]>;
  planBrowserStep(input: PlanBrowserStepInput, ctx?: CallContext): Promise<BrowserStep>;
}

/** Errors a provider raises; the selector falls back to the local engine on any of them. */
export class LlmError extends Error {
  readonly code: "refusal" | "truncated" | "invalid_output" | "timeout" | "api" | "budget" | "not_configured";
  readonly detail?: string;
  constructor(code: LlmError["code"], message: string, detail?: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.detail = detail;
  }
}

export type { Profile };
