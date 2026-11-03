import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { generatedDocuments, type GeneratedDocumentRow } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { actualProvider, feedbackIntent, getIntelligence } from "@/lib/llm";
import { composeDocumentWith, factRefs, loadComposeContext, nextVersion, opportunityInput } from "./compose";
import { personNotes, readContent, toStored, type StoredContent } from "./content";
import { blockRole, revisedContent } from "./revision";

/*
 * "Tell the AI what to change": the person writes a note on a draft (or taps a suggestion), the
 * intelligence layer rewrites the document and a new version is stored next to the old ones —
 * nothing is overwritten, any earlier version can be restored. Every claim stays sourced: the
 * note itself is the person's statement (cited as `answer:note_<n>`), anything else the note
 * needs becomes a spot only they can fill. When the AI engine is unavailable, what a re-draft
 * can do (another language, another tone) is still done; the rest is declined honestly.
 */

export type ReviseResult = { applied: true; row: GeneratedDocumentRow; changes: string[] } | { applied: false; reason: string | null };

async function insertVersion(row: GeneratedDocumentRow, content: StoredContent, fields: { title: string; language: string }): Promise<GeneratedDocumentRow> {
  const version = await nextVersion(row.userId, row.applicationId, row.kind);
  const stored: StoredContent = { ...content, meta: { ...content.meta, revisedFrom: row.id } };
  const sources = [...new Set(stored.blocks.flatMap((b) => b.factIds))];
  const rows = await db
    .insert(generatedDocuments)
    .values({ id: newId("gen"), userId: row.userId, applicationId: row.applicationId, kind: row.kind, title: fields.title.slice(0, 300), language: fields.language, content: toStored(stored), sources, version })
    .returning();
  return rows[0];
}

export async function reviseGeneratedDocument(
  userId: string,
  documentId: string,
  note: string,
  opts: { opportunityId?: string | null; answers?: Record<string, string>; material?: string | null; now?: Date } = {},
): Promise<ReviseResult | null> {
  const rows = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.id, documentId), eq(generatedDocuments.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) return null;
  const content = readContent(row.content);
  const ctx = await loadComposeContext(userId, opts.opportunityId ?? null);
  const ai = getIntelligence({ userId, applicationId: row.applicationId });
  const language = row.language.startsWith("zh") ? "zh" : "en";
  const revised = await ai.reviseDocument({
    kind: row.kind,
    composer: content.meta.composer,
    title: row.title,
    blocks: content.blocks.map((b, i) => ({ type: b.type, role: blockRole(content, b, i), ...(b.label ? { label: b.label } : {}), text: b.text, factIds: b.factIds, flags: b.flags })),
    feedback: note,
    notes: personNotes(content.meta),
    profile: ctx.profile ?? {},
    facts: factRefs(ctx.facts),
    opportunity: ctx.opportunity ? opportunityInput(ctx.opportunity) : null,
    answers: opts.answers ?? {},
    language,
  });
  const now = opts.now ?? new Date();

  if (revised.applied) {
    const next = revisedContent(content, { ...revised, label: actualProvider(ai) === "anthropic" ? "written_with_ai" : revised.label }, note, now);
    const fresh = await insertVersion(row, next, { title: revised.title, language: revised.language });
    return { applied: true, row: fresh, changes: revised.changes };
  }

  // The engine could not rewrite from the note: a fresh draft still covers another language or tone.
  const intent = feedbackIntent(note);
  const otherLanguage = intent.language && intent.language !== language ? intent.language : null;
  if (!otherLanguage && !intent.tone) return { applied: false, reason: revised.reason };
  const zh = (otherLanguage ?? language) === "zh";
  const { row: redrafted } = await composeDocumentWith(
    { userId, applicationId: row.applicationId ?? undefined, kind: row.kind, opportunityId: opts.opportunityId ?? undefined, language: otherLanguage ?? language, tone: intent.tone ?? content.meta.tone ?? undefined },
    { material: opts.material ?? null, answers: opts.answers, context: ctx, ai },
  );
  const changes = [
    ...(otherLanguage ? [zh ? "已改写为中文" : "Rewritten in English"] : []),
    ...(intent.tone ? [zh ? "换了一种语气重新起草" : `Redrafted in a ${intent.tone === "enthusiastic" ? "more confident" : intent.tone} tone`] : []),
  ];
  const drafted = readContent(redrafted.content);
  const stamped: StoredContent = {
    ...drafted,
    meta: { ...drafted.meta, revisions: [...content.meta.revisions, { note, changes, at: now.toISOString(), restore: false }], revisedFrom: row.id },
  };
  const updated = await db.update(generatedDocuments).set({ content: toStored(stamped) }).where(eq(generatedDocuments.id, redrafted.id)).returning();
  return { applied: true, row: updated[0] ?? redrafted, changes };
}

/** Brings an earlier version back as the newest one (the versions in between are kept). */
export async function restoreGeneratedDocument(userId: string, documentId: string, now: Date = new Date()): Promise<GeneratedDocumentRow | null> {
  const rows = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.id, documentId), eq(generatedDocuments.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) return null;
  const content = readContent(row.content);
  const zh = row.language.startsWith("zh");
  const restored: StoredContent = {
    ...content,
    meta: { ...content.meta, revisions: [...content.meta.revisions, { note: zh ? `恢复第 ${row.version} 版` : `Restored version ${row.version}`, changes: [], at: now.toISOString(), restore: true }] },
  };
  return insertVersion(row, restored, { title: row.title, language: row.language });
}

/** Every version of one document slot of an application, newest first (the room's version strip). */
export async function documentVersions(userId: string, applicationId: string, kind: GeneratedDocumentRow["kind"]): Promise<GeneratedDocumentRow[]> {
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.userId, userId), eq(generatedDocuments.applicationId, applicationId), eq(generatedDocuments.kind, kind)));
  return rows.sort((a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime());
}
