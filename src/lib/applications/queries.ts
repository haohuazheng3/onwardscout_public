import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { BOARD_COLUMNS, boardColumn, statusesInColumn, type BoardColumn } from "@/lib/core/state-machine";
import type { ApplicationAnswer } from "@/lib/core/types";
import { db } from "@/lib/db";
import { applicationSteps, applications, documents, events, facts, goals, integrations, jobs, opportunities, type ApplicationRow } from "@/lib/db/schema";
import { latestDocuments } from "@/lib/documents";
import { isGapBlock, readContent } from "@/lib/documents/content";
import { creditCost } from "./plan";
import { latestHandoff, latestPrepared, latestStepOutput } from "./engine";
import type { AnswerView, ApplicationView, BoardCard, DocumentView, FactView, OpportunityBrief, RequirementsLike, StepView } from "./types";

/*
 * Read models: the board (cards), the room (one application with everything it shows) and the
 * counters other features read (needs-you badge, pipeline summary).
 */

const briefCols = {
  id: opportunities.id,
  name: opportunities.name,
  orgName: opportunities.orgName,
  type: opportunities.type,
  url: opportunities.url,
  deadline: opportunities.deadline,
  rolling: opportunities.rolling,
} as const;

function brief(o: { id: string; name: string; orgName: string | null; type: string; url: string | null; deadline: Date | null; rolling: boolean } | null, fallbackId: string): OpportunityBrief {
  if (!o) return { id: fallbackId, name: "Opportunity no longer listed", orgName: null, type: "other", url: null, deadline: null, rolling: false };
  return { id: o.id, name: o.name, orgName: o.orgName, type: o.type, url: o.url, deadline: o.deadline ? o.deadline.toISOString() : null, rolling: o.rolling };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function listBoard(userId: string, opts: { goalId?: string | null } = {}): Promise<BoardCard[]> {
  const rows = await db
    .select({
      id: applications.id,
      status: applications.status,
      channel: applications.channel,
      practice: applications.practice,
      needsYouReason: applications.needsYouReason,
      questions: applications.questions,
      answers: applications.answers,
      goalId: applications.goalId,
      opportunityId: applications.opportunityId,
      updatedAt: applications.updatedAt,
      submittedAt: applications.submittedAt,
      followUpAt: applications.followUpAt,
      opp: briefCols,
    })
    .from(applications)
    .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .where(opts.goalId ? and(eq(applications.userId, userId), eq(applications.goalId, opts.goalId)) : eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    column: boardColumn(r.status),
    channel: r.channel,
    practice: r.practice,
    needsYouReason: r.needsYouReason,
    openQuestions: (r.questions ?? []).filter((q) => q.required !== false && !hasValue(r.answers?.[q.fieldName ?? q.id])).length,
    goalId: r.goalId,
    opportunity: brief(r.opp?.id ? r.opp : null, r.opportunityId),
    updatedAt: r.updatedAt.toISOString(),
    submittedAt: iso(r.submittedAt),
    followUpAt: iso(r.followUpAt),
  }));
}

function hasValue(a: ApplicationAnswer | undefined): boolean {
  if (!a) return false;
  if (a.fileKey) return true;
  const v = a.value;
  if (v === null || v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : String(v).trim().length > 0;
}

/** contracts §6 — the shell's "needs you" badge counts everything waiting for a tap. */
export async function needsYouCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.status, ["needs_info", "needs_you", "ready"])));
  return rows[0]?.n ?? 0;
}

/** contracts §6 */
export async function pipelineSummary(userId: string): Promise<Record<BoardColumn, number>> {
  const rows = await db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.userId, userId)).groupBy(applications.status);
  const out = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, 0])) as Record<BoardColumn, number>;
  for (const r of rows) out[boardColumn(r.status)] += r.n;
  return out;
}

export { statusesInColumn };

/* ------------------------------------------------------------------ the room */

const STEP_SUMMARY_KEYS = ["channel", "fields", "questions", "materials", "requiresAccount", "requiresPayment", "captchaLikely", "asked", "open", "settled", "attached", "gaps", "cost", "status", "reason", "retrying", "completed", "awaitingApproval", "refreshed", "partial"] as const;

function summarize(output: Record<string, unknown> | null): StepView["summary"] {
  const out: StepView["summary"] = {};
  if (!output) return out;
  for (const k of STEP_SUMMARY_KEYS) {
    const v = output[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v as string | number | boolean | null;
  }
  if (Array.isArray(output.documents)) out.documents = output.documents.length;
  return out;
}

function formatsFor(kind: string): DocumentView["formats"] {
  if (kind === "email") return [];
  if (kind === "pitch_notes") return ["pdf", "docx", "pptx"];
  return ["pdf", "docx"];
}

function answerValue(a: ApplicationAnswer): string {
  if (Array.isArray(a.value)) return a.value.join(", ");
  if (a.value === null || a.value === undefined) return "";
  return String(a.value);
}

export async function applicationView(userId: string, id: string): Promise<ApplicationView | null> {
  const rows = await db
    .select({ app: applications, opp: briefCols, oppApply: opportunities.apply, goal: { id: goals.id, label: goals.label } })
    .from(applications)
    .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .leftJoin(goals, and(eq(goals.id, applications.goalId), eq(goals.userId, userId)))
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const app: ApplicationRow = row.app;

  const [steps, docs, prepared, handoffStep, analyze, job, unlockEvent] = await Promise.all([
    db.select().from(applicationSteps).where(eq(applicationSteps.applicationId, app.id)).orderBy(asc(applicationSteps.n)).limit(200),
    latestDocuments(userId, app.id),
    latestPrepared(app.id),
    latestHandoff(app.id),
    latestStepOutput<{ requirements?: RequirementsLike }>(app.id, "analyze"),
    db
      .select({ kind: jobs.kind, status: jobs.status, error: jobs.error })
      .from(jobs)
      .where(and(eq(jobs.userId, userId), inArray(jobs.dedupeKey, [`application.prepare:${app.id}`, `application.submit:${app.id}`, `application.followup:${app.id}`])))
      .limit(3),
    db.select({ id: events.id }).from(events).where(and(eq(events.applicationId, app.id), eq(events.kind, "application.unlock"))).limit(1),
  ]);

  // Documents with their blocks; the source facts they cite.
  const documentsView: DocumentView[] = docs.map((d) => {
    const c = readContent(d.content);
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      language: d.language,
      version: d.version,
      label: c.meta.label,
      blocks: c.blocks.map((b, i) => ({ type: b.type, role: c.meta.roles[i] ?? (isGapBlock(b) ? "gap" : "body"), ...(b.label ? { label: b.label } : {}), text: b.text, factIds: b.factIds, flags: b.flags })),
      gaps: c.meta.gaps,
      notes: c.meta.notes,
      createdAt: d.createdAt.toISOString(),
      formats: formatsFor(d.kind),
    };
  });

  const labels = new Map<string, string>();
  for (const f of analyze?.requirements?.fields ?? []) labels.set(f.name, f.label);
  for (const q of analyze?.requirements?.questions ?? []) labels.set(q.id, q.prompt);
  const longKeys = new Set([...(analyze?.requirements?.fields ?? []).filter((f) => f.type === "textarea").map((f) => f.name), ...(analyze?.requirements?.questions ?? []).map((q) => q.id), "why_this"]);
  const answers: AnswerView[] = Object.entries(app.answers ?? {})
    .filter(([k, a]) => !k.startsWith("material:") && !a.fileKey && answerValue(a))
    .map(([k, a]) => ({ key: k, label: labels.get(k) ?? humanKey(k), value: answerValue(a), source: a.source, factIds: a.factIds, confirmed: a.confirmed, long: longKeys.has(k) || answerValue(a).length > 120 }));

  // Facts cited anywhere on the page, with their source document names.
  const ids = new Set<string>();
  for (const d of documentsView) for (const b of d.blocks) for (const f of b.factIds) if (f.startsWith("fct_")) ids.add(f);
  for (const a of answers) for (const f of a.factIds) if (f.startsWith("fct_")) ids.add(f);
  const factRows = ids.size ? await db.select({ id: facts.id, claim: facts.claim, quote: facts.quote, sourceDocId: facts.sourceDocId, confirmedByUser: facts.confirmedByUser }).from(facts).where(and(eq(facts.userId, userId), inArray(facts.id, [...ids]))) : [];
  const docIds = [...new Set(factRows.map((f) => f.sourceDocId).filter((x): x is string => Boolean(x)))];
  const docNames = docIds.length ? await db.select({ id: documents.id, filename: documents.filename, sourceUrl: documents.sourceUrl, kind: documents.kind }).from(documents).where(and(eq(documents.userId, userId), inArray(documents.id, docIds))) : [];
  const factMap: Record<string, FactView> = {};
  for (const f of factRows) {
    const d = docNames.find((x) => x.id === f.sourceDocId);
    factMap[f.id] = { claim: f.claim, quote: f.quote, source: d ? (d.filename ?? d.sourceUrl ?? d.kind) : null, confirmedByUser: f.confirmedByUser };
  }

  // The outreach email (CH4) — the follow-up draft takes over while one awaits approval.
  const emailDocs = documentsView.filter((d) => d.kind === "email");
  const followUpDoc = emailDocs.find((d) => docs.find((x) => x.id === d.id && readContent(x.content).meta.composer === "email_follow_up"));
  const firstEmail = emailDocs.find((d) => d !== followUpDoc);
  const shownEmail = app.needsYouReason === "followup_approval" && followUpDoc ? followUpDoc : firstEmail;
  let email: ApplicationView["email"] = null;
  if (shownEmail || prepared?.email) {
    const subjIdx = shownEmail?.blocks.findIndex((b) => b.role === "subject") ?? -1;
    email = {
      documentId: shownEmail?.id ?? null,
      to: prepared?.email?.to ?? row.oppApply?.email ?? "",
      subject: shownEmail && subjIdx >= 0 ? shownEmail.blocks[subjIdx].text : (prepared?.email?.subject ?? ""),
      body: shownEmail ? shownEmail.blocks.filter((_, i) => i !== subjIdx).map((b) => (b.type === "bullet" ? `• ${b.text}` : b.text)).join("\n\n") : (prepared?.email?.body ?? ""),
    };
  }

  let gmail: ApplicationView["gmail"] = null;
  if (app.channel === "CH4") {
    const g = await db.select({ status: integrations.status, email: integrations.accountEmail }).from(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, "google"))).limit(1);
    gmail = { connected: g[0]?.status === "active", email: g[0]?.email ?? null };
  }

  const running = job.find((j) => j.status === "queued" || j.status === "running");
  const failedPrepare = job.find((j) => j.kind === "application.prepare" && j.status === "failed");
  // Nothing is working on it although it should be: the queue gave up (or the run ended early).
  const lastTouch = Math.max(app.updatedAt.getTime(), ...steps.map((s) => (s.finishedAt ?? s.startedAt ?? s.createdAt).getTime()));
  const quiet = Date.now() - lastTouch > 3 * 60_000;
  const failedSubmit = job.find((j) => j.kind === "application.submit" && j.status === "failed");
  const stalled =
    !running && ["draft", "preparing", "submitting"].includes(app.status) && (failedPrepare || failedSubmit || quiet)
      ? { error: ((app.status === "submitting" ? failedSubmit?.error : failedPrepare?.error) ?? "").slice(0, 300) }
      : null;
  const lastRunning = [...steps].reverse().find((s) => s.status === "running");
  const working: ApplicationView["working"] =
    !stalled && (running || ["draft", "preparing", "submitting"].includes(app.status))
      ? { kind: running?.kind === "application.submit" || app.status === "submitting" ? "submit" : running?.kind === "application.followup" ? "followup" : "prepare", step: lastRunning?.kind ?? null }
      : null;

  return {
    id: app.id,
    status: app.status,
    column: boardColumn(app.status),
    channel: app.channel,
    practice: app.practice,
    needsYouReason: app.needsYouReason,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    submittedAt: iso(app.submittedAt),
    followUpAt: iso(app.followUpAt),
    followUpsSent: app.followUpsSent,
    opportunity: brief(row.opp?.id ? row.opp : null, app.opportunityId),
    goal: row.goal?.id ? { id: row.goal.id, label: row.goal.label } : null,
    steps: steps.map((s) => ({ n: s.n, kind: s.kind, status: s.status, summary: summarize(s.output as Record<string, unknown> | null), error: s.status === "failed" ? (s.error ?? null) : null, startedAt: iso(s.startedAt), finishedAt: iso(s.finishedAt) })),
    questions: app.questions ?? [],
    answers,
    documents: documentsView.filter((d) => d.kind !== "email"),
    email,
    handoff: handoffStep ?? (app.status === "needs_you" || app.status === "ready" ? (prepared?.handoff ?? null) : null),
    evidence: app.evidence ?? null,
    outcome: app.outcome ?? null,
    facts: factMap,
    creditCost: creditCost(app),
    creditsReserved: app.creditsReserved,
    gmail,
    working,
    stalled,
    unlock: Boolean(unlockEvent[0]),
    language: documentsView[0]?.language ?? "en",
  };
}

function humanKey(k: string): string {
  const s = k.replace(/^(field|q|gap):/, "").replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : k;
}

/** Active goals for the board's filter chips. */
export async function goalFilters(userId: string): Promise<{ id: string; label: string }[]> {
  return db.select({ id: goals.id, label: goals.label }).from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active"))).orderBy(desc(goals.updatedAt)).limit(12);
}

