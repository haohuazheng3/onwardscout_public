import "server-only";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { materialLabel } from "@/lib/core/materials";
import type { ApplicationAnswers, GeneratedDocumentKind, MaterialId } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications, generatedDocuments, type FactRow, type GeneratedDocumentRow, type OpportunityRow, type ProfileRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { getIntelligence, type FactRef, type Intelligence, type OpportunityInput, type Tone } from "@/lib/llm";
import { getOpportunity } from "@/lib/opportunities";
import { getFacts, getProfile } from "@/lib/profile";
import { getUserLocale } from "@/lib/user";
import { buildDocument, composeLanguage, documentLanguage, type BuildAnswerRow, type DocLanguage } from "./build";
import { toStored, type DocumentGap } from "./content";

/*
 * composeDocument (contracts §5): loads the person's profile, facts and the opportunity, builds
 * the document with the pure core (build.ts) and stores a new version in generated_documents.
 * Language: the caller's choice when it is en/zh, else the opportunity's language, else the
 * person's locale (plan principle 8: "the language follows the target organisation").
 */

export interface ComposeContext {
  profile: ProfileRow | null;
  facts: FactRow[];
  opportunity: OpportunityRow | null;
  userLocale: "en" | "zh";
}

export function factRefs(rows: FactRow[]): FactRef[] {
  return rows.map((f) => ({
    id: f.id,
    path: f.path,
    claim: f.claim,
    value: f.value ?? undefined,
    quote: f.quote,
    sourceDocId: f.sourceDocId,
    confidence: f.confidence,
    confirmedByUser: f.confirmedByUser,
  }));
}

/** The camelCase opportunity as the intelligence layer reads it. */
export function opportunityInput(o: OpportunityRow): OpportunityInput {
  return {
    id: o.id,
    type: o.type,
    name: o.name,
    orgName: o.orgName,
    url: o.url,
    summary: o.summary,
    description: o.description,
    tags: o.tags,
    industries: o.industries,
    functions: o.functions,
    languages: o.languages,
    geo: o.geo as OpportunityInput["geo"],
    eligibility: (o.eligibility ?? null) as OpportunityInput["eligibility"],
    deadline: o.deadline,
    rolling: o.rolling,
    benefits: o.benefits ?? undefined,
    cost: o.cost ?? undefined,
    requiredMaterials: o.requiredMaterials,
    estAcceptanceRate: o.estAcceptanceRate,
    estEffortMinutes: o.estEffortMinutes,
    qualityScore: o.qualityScore,
    apply: { channel: o.apply.channel, url: o.apply.url, email: o.apply.email },
  };
}

/** String values of the application's answers, keyed as the composer expects (`why_this`, field names…). */
export function answerStrings(answers: ApplicationAnswers | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, a] of Object.entries(answers ?? {})) {
    const v = a.value;
    if (v === null || v === undefined) continue;
    const s = Array.isArray(v) ? v.join(", ") : String(v);
    if (s.trim()) out[k] = s.trim();
  }
  return out;
}

export async function loadComposeContext(userId: string, opportunityId?: string | null): Promise<ComposeContext> {
  const [profile, facts, opportunity, userLocale] = await Promise.all([
    getProfile(userId),
    getFacts(userId),
    opportunityId ? getOpportunity(opportunityId) : Promise.resolve(null),
    getUserLocale(userId),
  ]);
  return { profile, facts, opportunity, userLocale: userLocale === "zh" ? "zh" : "en" };
}

export interface ComposeDocumentInput {
  userId: string;
  applicationId?: string;
  kind: GeneratedDocumentKind;
  opportunityId?: string;
  language: "en" | "zh" | string;
  tone?: string;
  maxWords?: number;
}

export interface ComposeOptions {
  /** The material this document satisfies (personal_statement, talk_proposal, publication_list…). */
  material?: MaterialId | string | null;
  /** Overrides the application's stored answers. */
  answers?: Record<string, string>;
  contact?: { name?: string | null; org?: string | null; role?: string | null; kind?: string | null } | null;
  previous?: { subject?: string | null; sentAt?: string | Date | null } | null;
  answerRows?: BuildAnswerRow[];
  /** Preloaded context (the prepare job loads it once for several documents). */
  context?: ComposeContext;
  ai?: Intelligence;
}

const TONES = new Set<Tone>(["professional", "warm", "concise", "enthusiastic"]);

export function resolveLanguage(requested: string | null | undefined, opp: OpportunityRow | null, userLocale: "en" | "zh"): DocLanguage {
  const r = (requested ?? "").toLowerCase();
  if (r === "en" || r === "zh" || r.startsWith("en-") || r.startsWith("zh-")) return composeLanguage(r);
  return documentLanguage(opp, userLocale);
}

async function nextVersion(userId: string, applicationId: string | null, kind: GeneratedDocumentKind): Promise<number> {
  const rows = await db
    .select({ v: max(generatedDocuments.version) })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.userId, userId),
        eq(generatedDocuments.kind, kind),
        applicationId ? eq(generatedDocuments.applicationId, applicationId) : isNull(generatedDocuments.applicationId),
      ),
    );
  return (rows[0]?.v ?? 0) + 1;
}

export interface ComposedRow {
  row: GeneratedDocumentRow;
  gaps: DocumentGap[];
}

/** Composes and stores one document; returns the row and what only the person can still supply. */
export async function composeDocumentWith(input: ComposeDocumentInput, opts: ComposeOptions = {}): Promise<ComposedRow> {
  const ctx = opts.context ?? (await loadComposeContext(input.userId, input.opportunityId));
  const opp = input.opportunityId ? ctx.opportunity : null;
  let stored: Record<string, string> = {};
  if (input.applicationId) {
    const app = await db
      .select({ id: applications.id, answers: applications.answers })
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.userId)))
      .limit(1);
    if (!app[0]) throw new Error("composeDocument: application not found for this user");
    stored = answerStrings(app[0].answers);
  }
  const language = resolveLanguage(input.language, opp, ctx.userLocale);
  const tone = TONES.has(input.tone as Tone) ? (input.tone as Tone) : undefined;
  const ai = opts.ai ?? getIntelligence({ userId: input.userId });
  const checklist =
    opts.material === "document_checklist" || opts.material === "evidence_list"
      ? (opp?.requiredMaterials ?? []).map((m) => {
          try {
            return materialLabel(m, language);
          } catch {
            return m;
          }
        })
      : undefined;
  const built = await buildDocument({
    ai,
    kind: input.kind,
    material: opts.material ?? null,
    profile: ctx.profile ?? {},
    facts: factRefs(ctx.facts),
    opportunity: opp ? opportunityInput(opp) : null,
    answers: { ...stored, ...(opts.answers ?? {}) },
    language,
    tone,
    maxWords: input.maxWords,
    contact: opts.contact ?? null,
    previous: opts.previous ?? null,
    answerRows: opts.answerRows,
    checklist,
  });
  const version = await nextVersion(input.userId, input.applicationId ?? null, input.kind);
  const rows = await db
    .insert(generatedDocuments)
    .values({
      id: newId("gen"),
      userId: input.userId,
      applicationId: input.applicationId ?? null,
      kind: input.kind,
      title: built.title.slice(0, 300),
      language,
      content: toStored(built.content),
      sources: built.sources,
      version,
    })
    .returning();
  return { row: rows[0], gaps: built.gaps };
}

/** contracts §5 */
export async function composeDocument(input: ComposeDocumentInput): Promise<GeneratedDocumentRow> {
  return (await composeDocumentWith(input)).row;
}

/** The newest version of each kind for an application (what the room shows). */
export async function latestDocuments(userId: string, applicationId: string): Promise<GeneratedDocumentRow[]> {
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.userId, userId), eq(generatedDocuments.applicationId, applicationId)))
    .orderBy(generatedDocuments.kind, desc(generatedDocuments.version), desc(generatedDocuments.createdAt));
  const seen = new Set<string>();
  return rows.filter((r) => {
    // `email` follow-ups share the kind with the first email; keep each composer's newest.
    const meta = (r.content as { meta?: { composer?: string | null } }).meta;
    const key = `${r.kind}:${meta?.composer === "email_follow_up" ? "follow_up" : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Marks rendered files stale after an edit (the next download renders again). */
export async function markUnrendered(id: string): Promise<void> {
  await db.update(generatedDocuments).set({ objectKey: null, mime: null }).where(eq(generatedDocuments.id, id));
}

