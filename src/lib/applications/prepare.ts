import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { canAutoSubmit } from "@/lib/authorizations";
import type { ApplicationAnswer, ApplicationAnswers, ApplicationQuestion, JsonObject } from "@/lib/core/types";
import { buildHandoff, channelFor, type Requirements } from "@/lib/channels";
import { db } from "@/lib/db";
import { applications, documents, generatedDocuments, type ApplicationRow, type GeneratedDocumentRow, type OpportunityRow } from "@/lib/db/schema";
import { answerStrings, composeDocumentWith, factRefs, latestDocuments, loadComposeContext, opportunityInput, resolveLanguage, type ComposeContext } from "@/lib/documents";
import { dropOptionalGaps } from "@/lib/documents/build";
import { downloadName, isGapBlock, plainText, readContent, toStored } from "@/lib/documents/content";
import { getIntelligence, readProfile } from "@/lib/llm";
import type { JobContext } from "@/lib/jobs/registry";
import type { JobResult } from "@/lib/jobs/state";
import { addStep, appError, ApplicationError, enqueuePrepare, execute, finishStep, latestStepOutput, loadApplication, patchApplication, transition } from "./engine";
import { computeGaps, openRequired, questionsFromDocumentGaps, type ComposePlan } from "./gaps";
import { planConfirm, planPrepareStep } from "./plan";
import type { FieldRequirement, PreparedPackage, RequirementsLike } from "./types";

/*
 * Job `application.prepare` (plan §7.1 step 5): channel → analyze → requirements → gaps
 * (choice-first questions; the application waits in `needs_info` until the person answers) →
 * compose documents, answers and the outreach email from facts → the prepared package → `ready`.
 * Re-runnable: every stage reads the current state, documents already drafted for this
 * application are kept unless they still contain gaps, and the job yields before its deadline.
 */

const LONG_FIELD = (f: FieldRequirement) => f.type === "textarea" || (f.maxLength ?? 0) > 200 || Boolean(f.question);

/** The person's most recent confirmed short answers on other applications, by semantic key. */
async function previousAnswers(userId: string, exceptId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ answers: applications.answers })
    .from(applications)
    .where(and(eq(applications.userId, userId), ne(applications.id, exceptId)))
    .orderBy(applications.updatedAt)
    .limit(40);
  const { fieldKey } = await import("@/lib/llm/local/forms");
  const out: Record<string, string> = {};
  for (const r of rows) {
    for (const [name, a] of Object.entries(r.answers ?? {})) {
      if (!a?.confirmed || a.source !== "user" || typeof a.value !== "string" || a.value.length > 200) continue;
      const k = fieldKey({ name, label: name, placeholder: null });
      if (k && !k.user) out[k.key] = a.value; // later rows overwrite: newest wins
    }
  }
  return out;
}

async function documentsOnFile(userId: string) {
  return db
    .select({ id: documents.id, kind: documents.kind, filename: documents.filename, objectKey: documents.objectKey })
    .from(documents)
    .where(and(eq(documents.userId, userId), ne(documents.status, "failed")));
}

function toRequirementsLike(req: Requirements): RequirementsLike {
  return {
    channel: req.channel,
    fields: req.fields,
    materials: req.materials,
    questions: req.questions,
    requiresAccount: req.requiresAccount,
    requiresPayment: req.requiresPayment,
    captchaLikely: req.captchaLikely,
    submitUrl: req.submitUrl,
    notes: req.notes,
  };
}

/** Which form field a composed document fills (résumé upload, cover letter upload…). */
function fieldForDocument(doc: GeneratedDocumentRow, req: RequirementsLike, material: string | null): string {
  const files = req.fields.filter((f) => f.type === "file");
  const want = doc.kind === "resume_variant" ? /r[ée]sum[ée]|\bcv\b|简历/i : doc.kind === "cover_letter" ? /cover|motivation letter|求职信/i : doc.kind === "pitch_notes" ? /deck|pitch|路演/i : null;
  const match = want ? files.find((f) => want.test(`${f.name} ${f.label}`)) : null;
  return match?.name ?? material ?? doc.kind;
}

function flatAnswers(answers: ApplicationAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answerStrings(answers))) if (!k.startsWith("material:")) out[k] = v;
  return out;
}

/** Builds (or rebuilds after an edit) the prepared package from the current answers and documents. */
export async function buildPrepared(app: ApplicationRow, opp: OpportunityRow, req: RequirementsLike, docs: GeneratedDocumentRow[], plans: { kind: string; material: string | null }[], personName: string | null): Promise<PreparedPackage> {
  const answers = app.answers ?? {};
  const files: PreparedPackage["files"] = [];
  for (const d of docs) {
    if (d.kind === "email") continue;
    const material = plans.find((p) => p.kind === d.kind)?.material ?? null;
    files.push({ field: fieldForDocument(d, req, material), generatedDocumentId: d.id, filename: downloadName({ kind: d.kind, title: d.title, language: d.language, personName, ext: "pdf" }) });
  }
  const onFile = await documentsOnFile(app.userId);
  for (const [key, a] of Object.entries(answers)) {
    const docId = typeof a.value === "string" && a.value.startsWith("doc_") ? a.value : null;
    if (!docId && !a.fileKey) continue;
    const d = docId ? onFile.find((x) => x.id === docId) : onFile.find((x) => x.objectKey === a.fileKey);
    if (!d) continue;
    files.push({ field: key.replace(/^material:/, ""), documentId: d.id, filename: d.filename ?? `${d.kind}.pdf` });
  }
  const flat = flatAnswers(answers);
  const emailDoc = docs.find((d) => d.kind === "email" && readContent(d.content).meta.composer !== "email_follow_up");
  let email: PreparedPackage["email"];
  if (emailDoc) {
    const content = readContent(emailDoc.content);
    const subjectIdx = content.meta.roles.indexOf("subject");
    const subject = subjectIdx >= 0 ? content.blocks[subjectIdx].text : emailDoc.title;
    const body = plainText({ blocks: content.blocks.filter((_, i) => i !== subjectIdx) });
    email = { to: opp.apply.email ?? "", subject, body };
  }
  const handoff = buildHandoff(opp, req as Requirements, flat, files);
  return { answers: flat, files, ...(email ? { email } : {}), handoff };
}

/** Stores a new `preview` step with the prepared package (the submit job reads the newest). */
export async function savePrepared(appId: string, prepared: PreparedPackage, extra: JsonObject = {}): Promise<void> {
  const s = await addStep(appId, "preview", {}, "running");
  await finishStep(s.id, "done", { prepared: prepared as unknown as JsonObject, ...extra });
}

export async function storedRequirements(appId: string): Promise<{ requirements: RequirementsLike; compose: ComposePlan[] } | null> {
  const analyze = await latestStepOutput<{ requirements?: RequirementsLike }>(appId, "analyze");
  const gaps = await latestStepOutput<{ compose?: ComposePlan[] }>(appId, "gaps");
  if (!analyze?.requirements) return null;
  return { requirements: analyze.requirements, compose: gaps?.compose ?? [] };
}

/** Rebuilds the prepared package after the person edited an answer, a document or the email. */
export async function refreshPrepared(app: ApplicationRow): Promise<void> {
  if (!["ready", "needs_you"].includes(app.status) || app.submittedAt) return;
  const stored = await storedRequirements(app.id);
  if (!stored) return;
  const ctx = await loadComposeContext(app.userId, app.opportunityId);
  if (!ctx.opportunity) return;
  const docs = await latestDocuments(app.userId, app.id);
  const prepared = await buildPrepared(app, ctx.opportunity, stored.requirements, docs, stored.compose, ctx.profile?.identity?.name ?? null);
  await savePrepared(app.id, prepared, { refreshed: true });
}

async function composeAll(app: ApplicationRow, ctx: ComposeContext, plans: ComposePlan[], req: RequirementsLike, lang: "en" | "zh", job: JobContext | null, recompose: boolean) {
  const ai = getIntelligence({ userId: app.userId });
  const existing = await latestDocuments(app.userId, app.id);
  const answersStr = answerStrings(app.answers);
  const labels = new Map<string, string>([...req.fields.map((f) => [f.name, f.label] as [string, string]), ...req.questions.map((q) => [q.id, q.prompt] as [string, string])]);
  const docs: GeneratedDocumentRow[] = [];
  const gaps: { key: string; question: string }[] = [];
  for (const p of plans) {
    const had = existing.find((d) => d.kind === p.kind && readContent(d.content).meta.composer !== "email_follow_up");
    if (had && !recompose && !readContent(had.content).blocks.some(isGapBlock)) {
      docs.push(had);
      continue;
    }
    if (job && job.timeLeftMs() < 20_000) return { docs, gaps, yielded: true };
    const answerRows =
      p.kind === "answers"
        ? Object.entries(app.answers ?? {})
            .filter(([k, a]) => !k.startsWith("material:") && !a.fileKey && a.value !== null)
            .map(([k, a]) => ({ key: k, label: labels.get(k) ?? k, value: Array.isArray(a.value) ? a.value.join(", ") : String(a.value), factIds: a.factIds }))
        : undefined;
    const { row, gaps: g } = await composeDocumentWith(
      { userId: app.userId, applicationId: app.id, kind: p.kind, opportunityId: app.opportunityId, language: lang },
      { material: p.material, context: ctx, ai, answers: answersStr, answerRows },
    );
    // A submitted document never shows a placeholder: drop unanswered optional gaps.
    const content = readContent(row.content);
    const trimmed = dropOptionalGaps(content);
    let finalRow = row;
    if (trimmed !== content) {
      const upd = await db.update(generatedDocuments).set({ content: toStored(trimmed) }).where(eq(generatedDocuments.id, row.id)).returning();
      finalRow = upd[0] ?? row;
    }
    docs.push(finalRow);
    gaps.push(...g.filter((x) => trimmed.meta.gaps.some((y) => y.key === x.key)));
  }
  return { docs, gaps, yielded: false };
}

/**
 * Leaving the job while the application waits for answers. If the person answered the last
 * question while this run was still finishing (their answer could not enqueue a second run
 * while this one held the dedupe key), go round again instead of leaving it stuck.
 */
async function settleWaiting(applicationId: string, result: Record<string, string | number>): Promise<JobResult> {
  const now = await loadApplication(applicationId);
  if (now && now.status === "preparing") return { status: "continue", delayMs: 0 };
  return { status: "done", result };
}

export async function prepareJob(job: JobContext): Promise<JobResult> {
  const applicationId = String(job.payload.applicationId ?? "");
  const recompose = job.payload.recompose === true;
  let app = await loadApplication(applicationId);
  if (!app) return { status: "done", result: { skipped: "missing" } };
  if (!["draft", "needs_info", "preparing"].includes(app.status)) return { status: "done", result: { skipped: app.status } };
  if (app.status === "needs_info" && openRequired(app.questions, app.answers).length) return { status: "done", result: { waiting: "answers" } };

  try {
    const ctx = await loadComposeContext(app.userId, app.opportunityId);
    const opp = ctx.opportunity;
    if (!opp) {
      if (app.status === "draft") await execute(app, [{ type: "transition", to: "needs_you", actor: "system", needsYouReason: "opportunity_missing" }, { type: "notify", key: "needs_you" }]);
      return { status: "done", result: { skipped: "opportunity_missing" } };
    }
    if (!app.practice && opp.deadline && !opp.rolling && opp.deadline.getTime() < Date.now()) {
      await execute(app, [{ type: "transition", to: "expired", actor: "system" }, { type: "release" }, { type: "event", kind: "application.expired", data: { deadline: opp.deadline.toISOString() } }]);
      return { status: "done", result: { expired: true } };
    }

    // 1. analyze (once per application: the requirements are kept on the step; `reanalyze` refreshes them)
    const channel = channelFor(opp);
    let req: RequirementsLike;
    const known = job.payload.reanalyze === true ? null : await storedRequirements(app.id);
    if (known) req = known.requirements;
    else {
      const s1 = await addStep(app.id, "analyze", { channel: channel.id });
      try {
        req = toRequirementsLike(await channel.analyze(opp));
      } catch (err) {
        await finishStep(s1.id, "failed", {}, err instanceof Error ? err.message : String(err));
        throw err;
      }
      await finishStep(s1.id, "done", {
        channel: req.channel,
        fields: req.fields.length,
        questions: req.questions.length,
        materials: req.materials.length,
        requiresAccount: req.requiresAccount,
        requiresPayment: req.requiresPayment,
        captchaLikely: req.captchaLikely,
        requirements: req as unknown as JsonObject,
      });
    }
    if (req.channel !== app.channel) app = await patchApplication(app, { channel: req.channel });

    // 2. gaps
    const s2 = await addStep(app.id, "gaps");
    const ai = getIntelligence({ userId: app.userId });
    const profile = readProfile(ctx.profile ?? {});
    const facts = factRefs(ctx.facts);
    const files = await documentsOnFile(app.userId);
    const lang = resolveLanguage(null, opp, ctx.userLocale);
    const answersStr = answerStrings(app.answers);
    const mappings = req.fields.length
      ? await ai.mapFormFields({
          fields: req.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, options: f.options, required: f.required, placeholder: null })),
          profile,
          facts,
          answers: answersStr,
          documents: files.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename ?? d.kind })),
          language: lang,
        })
      : [];
    const mapped = new Map(mappings.map((m) => [m.name, m]));
    const longFields = req.fields.filter((f) => LONG_FIELD(f) && !answersStr[f.name] && !(mapped.get(f.name)?.value && !mapped.get(f.name)?.needsUser));
    const toDraft = [
      ...req.questions.filter((q) => !answersStr[q.id]).map((q) => ({ id: q.id, text: q.prompt, type: "long", required: true, maxWords: q.maxWords })),
      ...longFields.map((f) => ({ id: f.name, text: f.label, type: "long", required: f.required, maxWords: f.maxLength ? Math.max(20, Math.floor(f.maxLength / 7)) : undefined })),
    ];
    const drafts = toDraft.length ? await ai.answerQuestions({ questions: toDraft, profile, facts, opportunity: opportunityInput(opp), answers: answersStr, language: lang }) : [];
    const { getUserRow } = await import("@/lib/user");
    const userRow = await getUserRow(app.userId);
    const gaps = computeGaps({
      language: lang,
      opportunity: { id: opp.id, type: opp.type, name: opp.name, orgName: opp.orgName, requiredMaterials: opp.requiredMaterials, industries: opp.industries, functions: opp.functions, tags: opp.tags, geo: opp.geo },
      requirements: req,
      mappings,
      drafts,
      answers: app.answers ?? {},
      previous: await previousAnswers(app.userId, app.id),
      documentsOnFile: files,
      profile,
      accountEmail: userRow?.email ?? null,
      outreach: req.channel === "CH4",
      aiDrafts: ai.provider === "anthropic",
    });
    const merged: ApplicationAnswers = { ...gaps.autoAnswers, ...(app.answers ?? {}) };
    for (const a of gaps.attach) {
      const d = files.find((x) => x.id === a.documentId);
      if (!merged[a.field]) merged[a.field] = { value: a.documentId, source: "profile", factIds: [], confirmed: true, fileKey: d?.objectKey ?? null } satisfies ApplicationAnswer;
    }
    app = await patchApplication(app, { answers: merged, questions: gaps.questions });
    const open = openRequired(gaps.questions, merged).length;
    await finishStep(s2.id, "done", { asked: gaps.questions.length, open, settled: Object.keys(gaps.autoAnswers).length, attached: gaps.attach.length, compose: gaps.compose as unknown as JsonObject[] } as JsonObject);

    const afterGaps = planPrepareStep(app, "gaps", open);
    if (!afterGaps.ok) throw appError(afterGaps.error);
    app = (await execute(app, afterGaps.effects)).app;
    if (app.status !== "preparing") return settleWaiting(app.id, { status: app.status, open });

    // 3. compose
    const s3 = await addStep(app.id, "compose", { documents: gaps.compose.map((c) => c.kind) });
    const composed = await composeAll(app, ctx, gaps.compose, req, lang, job, recompose);
    if (composed.yielded) {
      await finishStep(s3.id, "skipped", { partial: composed.docs.length });
      return { status: "continue", delayMs: 0 };
    }
    await finishStep(s3.id, "done", { documents: composed.docs.map((d) => ({ id: d.id, kind: d.kind, version: d.version })) as unknown as JsonObject[], gaps: composed.gaps.length });

    const docQuestions = questionsFromDocumentGaps(composed.gaps, app.answers ?? {}, lang).filter((q) => !(app!.questions ?? []).some((x) => x.id === q.id));
    if (docQuestions.length) {
      app = await patchApplication(app, { questions: [...(app.questions ?? []), ...docQuestions] as ApplicationQuestion[] });
      const back = planPrepareStep(app, "composed", docQuestions.length);
      if (!back.ok) throw appError(back.error);
      app = (await execute(app, back.effects)).app;
      return settleWaiting(app.id, { status: app.status, documentGaps: docQuestions.length });
    }

    // 4. preview: the prepared package (answers, files, email, handoff)
    const prepared = await buildPrepared(app, opp, req, composed.docs, gaps.compose, profile.identity.name);
    await savePrepared(app.id, prepared);
    const toReady = planPrepareStep(app, "composed", 0);
    if (!toReady.ok) throw appError(toReady.error);
    app = (await execute(app, toReady.effects)).app;

    // 5. a standing authorization for this category submits without a tap (never for practice).
    if (!app.practice && (await canAutoSubmit(app.userId, opp.type))) {
      const plan = planConfirm(app, { explicit: false, authorized: true });
      if (plan.ok) {
        try {
          app = (await execute(app, plan.effects)).app;
        } catch (err) {
          if (!(err instanceof ApplicationError && err.code === "insufficient_credits")) throw err;
          // Not enough credits: it waits in `ready` for the person (already notified).
        }
      }
    }
    return { status: "done", result: { status: app.status } };
  } catch (err) {
    if (err instanceof ApplicationError && err.code === "conflict") return { status: "done", result: { skipped: "moved" } };
    throw err;
  }
}

/** Re-prepares after answers changed: needs_info → preparing (the person's answers) and runs the job. */
export async function resumePreparation(app: ApplicationRow): Promise<ApplicationRow> {
  if (app.status === "needs_info" && !openRequired(app.questions, app.answers).length) {
    let next: ApplicationRow;
    try {
      next = await transition(app, "preparing", "user");
    } catch (err) {
      // The running job moved it first (it saw the answers): that is the same outcome.
      if (!(err instanceof ApplicationError && err.code === "conflict")) throw err;
      next = (await loadApplication(app.id)) ?? app;
    }
    await enqueuePrepare(next);
    return next;
  }
  return app;
}

