import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, documents } from "@/lib/db/schema";
import { getOpportunity } from "@/lib/opportunities";
import { USER_REF_PREFIX } from "@/lib/opportunities/queries";
import { getProfile } from "@/lib/profile";
import { appError } from "./engine";
import { applicationView } from "./queries";
import { startApplication } from "./index";
import type { AccessView, DocumentView, OpportunityBrief } from "./types";

/*
 * Apply from a listing (/app/apply/<opportunity id>): the visitor drops their résumé and gets
 * this programme's materials drafted at once — signed out, as an anonymous draft that becomes
 * theirs when they sign in to save it (claimAnonymousDraft moves the application with its
 * documents). It is an ordinary application from the start: the same preparation job, the same
 * honesty rules; nothing is ever submitted before the person signs in and taps confirm.
 */

export interface ApplyPreview {
  applicationId: string;
  status: string;
  /** Still drafting (the page keeps polling). */
  working: boolean;
  opportunity: OpportunityBrief;
  documents: Pick<DocumentView, "id" | "kind" | "title" | "composer" | "blocks" | "gaps" | "label">[];
  /** Questions only the person can answer (asked after they save). */
  questions: { id: string; prompt: string }[];
  /** Preview or paid, and whether Claude is writing it right now. */
  access: AccessView;
}

/**
 * The opportunity a visitor may start an application for: active, not our practice one, and on the
 * shared catalog (a listing page, or a pick on the dashboard — job postings have no public page but
 * are just as open); never an opportunity someone imported for themselves.
 */
export async function applyTarget(opportunityId: string) {
  const opp = await getOpportunity(opportunityId);
  if (!opp || opp.type === "practice" || opp.status !== "active" || (opp.sourceRef ?? "").startsWith(USER_REF_PREFIX)) return null;
  return opp;
}

export function isClosedRound(opp: { deadline: Date | null; rolling: boolean }, now = Date.now()): boolean {
  return Boolean(opp.deadline && !opp.rolling && opp.deadline.getTime() < now);
}

/** The owner's application for this opportunity (practice runs excluded). */
export async function applicationFor(ownerId: string, opportunityId: string): Promise<{ id: string; status: string } | null> {
  const rows = await db
    .select({ id: applications.id, status: applications.status })
    .from(applications)
    .where(and(eq(applications.userId, ownerId), eq(applications.opportunityId, opportunityId), eq(applications.practice, false)))
    .limit(1);
  return rows[0] ?? null;
}

/** Something to draft from: a source that was read, or a profile with content. */
export async function hasMaterial(ownerId: string): Promise<boolean> {
  const [docs, profile] = await Promise.all([
    db.select({ n: count() }).from(documents).where(and(eq(documents.userId, ownerId), ne(documents.status, "failed"))),
    getProfile(ownerId),
  ]);
  return (docs[0]?.n ?? 0) > 0 || Boolean(profile && profile.completeness > 0);
}

/** Starts (or finds) the owner's application for a listing and its preparation. */
export async function startFromListing(ownerId: string, opportunityId: string): Promise<{ applicationId: string; created: boolean }> {
  const opp = await applyTarget(opportunityId);
  if (!opp) throw appError("not_found", 404);
  const existing = await applicationFor(ownerId, opportunityId);
  if (existing) return { applicationId: existing.id, created: false };
  if (isClosedRound(opp)) throw appError("not_ready", 409);
  if (!(await hasMaterial(ownerId))) throw appError("not_ready", 409);
  return startApplication({ userId: ownerId, opportunityId });
}

/** What the apply page shows while the materials are drafted, and once they are. */
export async function applyPreview(ownerId: string, applicationId: string): Promise<ApplyPreview | null> {
  const view = await applicationView(ownerId, applicationId);
  if (!view) return null;
  const drafting = ["draft", "preparing"].includes(view.status) || Boolean(view.working && view.working.kind === "prepare");
  return {
    applicationId: view.id,
    status: view.status,
    working: drafting,
    opportunity: view.opportunity,
    documents: view.documents
      .filter((d) => d.kind !== "email" && d.kind !== "answers")
      .map((d) => ({ id: d.id, kind: d.kind, title: d.title, composer: d.composer, blocks: d.blocks, gaps: d.gaps, label: d.label })),
    // Answered questions leave the list (answerQuestion), so what is left is still open.
    questions: view.questions.filter((q) => q.required !== false && q.kind !== "file").map((q) => ({ id: q.id, prompt: q.prompt })),
    access: view.access,
  };
}
