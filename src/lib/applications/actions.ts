import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ApplicationAnswer, ApplicationAnswers } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applications, generatedDocuments, type ApplicationRow } from "@/lib/db/schema";
import { regenerateDocument, saveDocumentEdits, type BlockEdit } from "@/lib/documents";
import { readContent } from "@/lib/documents/content";
import { classifyQuestion, getIntelligence, readProfile } from "@/lib/llm";
import { getOpportunity } from "@/lib/opportunities";
import { getFacts, getProfile } from "@/lib/profile";
import { getUserLocale } from "@/lib/user";
import { answerStrings, factRefs, opportunityInput } from "@/lib/documents";
import { appError, enqueuePrepare, enqueueSubmit, execute, patchApplication, requireApplication, transition, type ExecuteResult } from "./engine";
import { AnswerError, isMotivationQuestion, normalizeAnswer, openRequired, type AnswerInput } from "./gaps";
import { planOutcome, planReply, planWithdraw, type OutcomeChoice, type ReplyClass } from "./plan";
import { refreshPrepared, resumePreparation } from "./prepare";
import { answerKeyOf } from "./types";

/*
 * What the person does in the application room: answer a gap question, edit an answer, a
 * document or the email, ask for a rewrite, record an outcome, withdraw. Each action is checked
 * against the owner and the state machine; the prepared package is rebuilt after an edit so the
 * submission always carries exactly what the person sees.
 */

async function lang(userId: string, app: ApplicationRow): Promise<"en" | "zh"> {
  const docs = await db.select({ language: generatedDocuments.language }).from(generatedDocuments).where(and(eq(generatedDocuments.applicationId, app.id), eq(generatedDocuments.userId, userId))).limit(1);
  const l = docs[0]?.language ?? (await getUserLocale(userId));
  return l.startsWith("zh") ? "zh" : "en";
}

export async function answerQuestion(userId: string, applicationId: string, questionId: string, input: AnswerInput & { custom?: string | null }): Promise<ApplicationRow> {
  const app = await requireApplication(applicationId, userId);
  const q = (app.questions ?? []).find((x) => x.id === questionId);
  if (!q) return app; // already answered (double tap, another tab)
  let answer: ApplicationAnswer;
  try {
    answer = normalizeAnswer(q, input, await lang(userId, app));
  } catch (err) {
    if (err instanceof AnswerError) throw appError("invalid_answer", 400, { reason: err.code });
    throw err;
  }
  const key = answerKeyOf(q);
  const patch: ApplicationAnswers = { [key]: answer };
  // A form's own "why" question is the person's motivation: the cover letter reuses it.
  if (isMotivationQuestion(q) && key !== "why_this" && !app.answers?.why_this) patch.why_this = { ...answer };
  // Merged in SQL, so two quick taps on different questions never overwrite each other.
  const rows = await db
    .update(applications)
    .set({
      answers: sql`${applications.answers} || ${JSON.stringify(patch)}::jsonb`,
      questions: sql`(select coalesce(jsonb_agg(q), '[]'::jsonb) from jsonb_array_elements(${applications.questions}) q where q->>'id' <> ${q.id})`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(applications.id, app.id), eq(applications.userId, userId)))
    .returning();
  const next = rows[0] ?? app;
  if (next.status === "needs_info" && !openRequired(next.questions ?? [], next.answers ?? {}).length) return resumePreparation(next);
  return next;
}

/** Edits to settled answers (the answers pane). Text only; the person's words become confirmed. */
export async function editAnswers(userId: string, applicationId: string, edits: Record<string, string>): Promise<ApplicationRow> {
  const app = await requireApplication(applicationId, userId);
  if (app.submittedAt || app.status === "submitting") throw appError("already_submitted");
  const patch: ApplicationAnswers = {};
  for (const [k, v] of Object.entries(edits)) {
    const text = v.trim();
    if (!text) continue;
    const prev = app.answers?.[k];
    patch[k] = { value: text, source: prev && String(prev.value) === text ? prev.source : "user", factIds: prev && String(prev.value) === text ? prev.factIds : [], confirmed: true, fileKey: prev?.fileKey ?? null };
  }
  const rows = await db
    .update(applications)
    .set({ answers: sql`${applications.answers} || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`now()` })
    .where(and(eq(applications.id, app.id), eq(applications.userId, userId)))
    .returning();
  const next = rows[0] ?? app;
  await refreshPrepared(next);
  return next;
}

export async function editDocument(userId: string, applicationId: string, documentId: string, edits: BlockEdit[], title?: string): Promise<void> {
  const app = await requireApplication(applicationId, userId);
  if (app.submittedAt) throw appError("already_submitted");
  const row = await saveDocumentEdits(userId, documentId, edits, title);
  if (!row || row.applicationId !== app.id) throw appError("not_found", 404);
  // Filling a gap in place closes the matching question too.
  const content = readContent(row.content);
  const openGapKeys = new Set(content.meta.gaps.map((g) => g.key));
  const questions = (app.questions ?? []).filter((q) => !(q.id.startsWith("gap:") && !openGapKeys.has(q.id.slice(4))));
  let next = questions.length !== (app.questions ?? []).length ? await patchApplication(app, { questions }) : app;
  if (next.status === "needs_info" && !openRequired(next.questions, next.answers).length) next = await resumePreparation(next);
  await refreshPrepared(next);
}

/** Email pane edits (CH4): the email document is rewritten with the person's subject/body. */
export async function editEmail(userId: string, applicationId: string, documentId: string, email: { subject?: string; body?: string }): Promise<void> {
  const rows = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.id, documentId), eq(generatedDocuments.userId, userId))).limit(1);
  const row = rows[0];
  if (!row || row.applicationId !== applicationId || row.kind !== "email") throw appError("not_found", 404);
  const content = readContent(row.content);
  const edits: BlockEdit[] = [];
  const subjectIdx = content.meta.roles.indexOf("subject");
  if (email.subject !== undefined && subjectIdx >= 0) edits.push({ index: subjectIdx, text: email.subject });
  if (email.body !== undefined) {
    // The body is edited as one text: the first body block takes it, the others are removed.
    const bodyIdx = content.blocks.map((_, i) => i).filter((i) => i !== subjectIdx);
    bodyIdx.forEach((i, n) => edits.push({ index: i, text: n === 0 ? email.body! : "" }));
  }
  await editDocument(userId, applicationId, documentId, edits, email.subject);
}

export async function regenerate(userId: string, applicationId: string, input: { documentId?: string; questionId?: string; tone?: string }): Promise<{ documentId?: string; draft?: string }> {
  const app = await requireApplication(applicationId, userId);
  if (!input.documentId && !input.questionId && app.status === "submitting") {
    // A submission whose job gave up: run it again (the credit is still reserved for it).
    await enqueueSubmit(app);
    return {};
  }
  if (app.submittedAt || app.status === "submitting") throw appError("already_submitted");
  if (input.documentId) {
    const fresh = await regenerateDocument(userId, input.documentId, { tone: input.tone });
    if (!fresh) throw appError("not_found", 404);
    await refreshPrepared(app);
    return { documentId: fresh.id };
  }
  if (input.questionId) {
    const q = (app.questions ?? []).find((x) => x.id === input.questionId);
    if (!q || q.kind !== "text") throw appError("not_found", 404);
    const [profile, facts, opp, language] = await Promise.all([getProfile(userId), getFacts(userId), getOpportunity(app.opportunityId), lang(userId, app)]);
    const ai = getIntelligence({ userId });
    const questionKey = classifyQuestion(q.prompt);
    let draft: string | null = null;
    // "Rewrite" must read differently: walk the tones until the draft changes.
    for (const tone of ["warm", "concise", "enthusiastic", "professional"] as const) {
      const doc = await ai.compose({
        kind: "answer",
        profile: readProfile(profile ?? {}),
        facts: factRefs(facts),
        opportunity: opp ? opportunityInput(opp) : null,
        answers: answerStrings(app.answers),
        language,
        tone,
        question: q.prompt,
        questionKey,
      });
      const text = doc.blocks
        .filter((b) => b.role === "body")
        .map((b) => b.text)
        .join(language === "zh" ? "" : "\n\n")
        .trim();
      if (text && text !== (q.draft ?? "").trim()) {
        draft = text;
        break;
      }
      draft ??= text || null;
    }
    if (draft && draft !== q.draft) {
      const questions = (app.questions ?? []).map((x) => (x.id === q.id ? { ...x, draft } : x));
      await patchApplication(app, { questions });
    }
    return { draft: draft ?? q.draft ?? "" };
  }
  // Nothing named: re-prepare everything from the current answers (also the retry after a stalled run).
  if (app.status === "ready") {
    const next = await transition(app, "preparing", "user");
    await enqueuePrepare(next, { recompose: true });
  } else if (app.status === "draft" || app.status === "preparing") {
    await enqueuePrepare(app, { reanalyze: true });
  }
  return {};
}

export async function recordOutcome(userId: string, applicationId: string, result: OutcomeChoice, note?: string | null): Promise<ExecuteResult> {
  const app = await requireApplication(applicationId, userId);
  const plan = planOutcome(app, result, { note, now: new Date() });
  if (!plan.ok) throw appError(plan.error);
  return execute(app, plan.effects);
}

export async function withdrawApplication(userId: string, applicationId: string): Promise<ExecuteResult> {
  const app = await requireApplication(applicationId, userId);
  const plan = planWithdraw(app);
  if (!plan.ok) throw appError(plan.error);
  return execute(app, plan.effects);
}

/**
 * A classified reply (P3b: forwarded to the drop-box, or "they replied" pasted in). Moves the
 * application through the state machine as channel evidence and stops the follow-ups.
 */
export async function recordReply(input: { userId: string; applicationId: string; messageId: string; classification: ReplyClass; summary: string; nextStep: string }): Promise<{ status: string }> {
  const app = await requireApplication(input.applicationId, input.userId);
  const plan = planReply(app, input.classification, { summary: input.summary, now: new Date() });
  if (!plan.ok) return { status: app.status };
  const res = await execute(app, plan.effects.map((e) => (e.type === "event" ? { ...e, data: { ...(e.data ?? {}), messageId: input.messageId } } : e)));
  return { status: res.app.status };
}
