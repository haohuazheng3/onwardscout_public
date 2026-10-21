import { CREDIT_COST } from "@/content/plans";
import { canTransition, creditEffect, type Actor } from "@/lib/core/state-machine";
import type { ApplicationEvidence, ApplicationOutcome, ApplicationStatus, ChannelId, MilestoneMetric, OutcomeResult } from "@/lib/core/types";
import type { HandoffPackage, SubmitResultLike } from "./types";

/*
 * Transition planning, pure. Every user action and every channel result becomes an ordered list
 * of effects (state transitions, credit moves, evidence, notifications, milestones, follow-up
 * schedule). engine.ts executes them against the database in order; the tests execute them
 * against an in-memory application with a fake channel. Transitions are always checked against
 * core/state-machine.ts here, before anything is written.
 *
 * Credits (contracts §2, CREDIT_RULES): reserved when the person confirms a submission
 * (practice = free), settled when it is submitted (incl. a confirmed handoff), released when it
 * fails or the application ends unsubmitted. A handoff keeps the credit reserved until the
 * person taps "I submitted it".
 */

export interface AppState {
  status: ApplicationStatus;
  practice: boolean;
  submittedAt: Date | string | null;
  channel?: ChannelId;
  needsYouReason?: string | null;
  followUpsSent?: number;
  followUpAt?: Date | string | null;
  outcome?: ApplicationOutcome | null;
}

export type NotifyKey =
  | "questions"
  | "ready"
  | "submitted"
  | "needs_you"
  | "submit_failed"
  | "followup_ready"
  | "followup_sent"
  | "check_status"
  | "closed_no_response";

export type Effect =
  | { type: "transition"; to: ApplicationStatus; actor: Actor; needsYouReason?: string | null }
  | { type: "reserve"; amount: number }
  | { type: "settle" }
  | { type: "release" }
  | { type: "enqueue"; kind: "application.submit" | "application.prepare" | "application.followup"; payload?: Record<string, string | boolean | number> }
  | { type: "evidence"; evidence: ApplicationEvidence }
  | { type: "handoff"; handoff: HandoffPackage }
  | { type: "notify"; key: NotifyKey }
  | { type: "event"; kind: string; data?: Record<string, string | number | boolean | null> }
  | { type: "unlock" }
  | { type: "milestone"; metric: MilestoneMetric }
  | { type: "followup"; at: Date | null; sent?: number }
  | { type: "outcome"; outcome: ApplicationOutcome };

export type PlanError = "not_ready" | "needs_confirmation" | "invalid_transition" | "not_submitted" | "busy" | "already_submitted" | "no_followup";

export type Plan = { ok: true; effects: Effect[] } | { ok: false; error: PlanError };

const ok = (effects: Effect[]): Plan => ({ ok: true, effects });
const fail = (error: PlanError): Plan => ({ ok: false, error });

function submittedOf(app: AppState): boolean {
  return Boolean(app.submittedAt);
}

/** Credits a submission costs: practice is free. */
export function creditCost(app: Pick<AppState, "practice">): number {
  return app.practice ? CREDIT_COST.practice : CREDIT_COST.submitApplication;
}

/* ------------------------------------------------------------------ confirm */

/**
 * The person's "Confirm & submit" (or a standing authorization for this opportunity type).
 * Nothing moves without one of the two.
 */
export function planConfirm(app: AppState, opts: { explicit: boolean; authorized?: boolean }): Plan {
  if (app.status === "submitting") return fail("busy");
  if (submittedOf(app)) return fail("already_submitted");
  if (app.status !== "ready") return fail("not_ready");
  if (!opts.explicit && !opts.authorized) return fail("needs_confirmation");
  const actor: Actor = opts.explicit ? "user" : "system";
  if (!canTransition(app.status, "submitting", actor, { submitted: false })) return fail("invalid_transition");
  const cost = creditCost(app);
  return ok([
    ...(cost > 0 ? [{ type: "reserve", amount: cost } as Effect] : []),
    { type: "transition", to: "submitting", actor },
    { type: "event", kind: "application.confirmed", data: { by: opts.explicit ? "user" : "authorization", cost } },
    { type: "enqueue", kind: "application.submit" },
  ]);
}

/* ------------------------------------------------------------------ channel result */

export interface SubmitContextInfo {
  /** The person has no other submitted (non-practice) application: fire `unlock`. */
  firstSubmission: boolean;
  /** When the first follow-up is due (playbook), or null. */
  followUpAt: Date | null;
  now: Date;
  /** The prepared handoff (used when a non-retryable failure turns into a handoff). */
  preparedHandoff?: HandoffPackage | null;
}

export function planSubmitResult(app: AppState, result: SubmitResultLike, info: SubmitContextInfo): Plan {
  if (app.status !== "submitting") return fail("invalid_transition");
  const paid = !app.practice;
  switch (result.status) {
    case "submitted": {
      const ev: ApplicationEvidence = {
        screenshotKey: result.evidence.screenshotKey ?? null,
        confirmationText: result.evidence.confirmationText ?? null,
        url: result.evidence.url ?? null,
        messageId: result.evidence.messageId ?? null,
        reference: result.evidence.ref ?? null,
        channel: app.channel ?? null,
        capturedAt: info.now.toISOString(),
        userConfirmed: false,
      };
      return ok([
        { type: "evidence", evidence: ev },
        { type: "transition", to: "submitted", actor: "channel" },
        ...(paid ? [{ type: "settle" } as Effect] : []),
        { type: "event", kind: "application.submitted", data: { channel: app.channel ?? null, ref: ev.reference } },
        ...(paid ? [{ type: "milestone", metric: "applications" } as Effect] : []),
        ...(paid && info.firstSubmission ? [{ type: "unlock" } as Effect] : []),
        { type: "followup", at: paid ? info.followUpAt : null, sent: 0 },
        { type: "notify", key: "submitted" },
      ]);
    }
    case "needs_you":
      return ok([
        { type: "handoff", handoff: result.handoff },
        { type: "transition", to: "needs_you", actor: "channel", needsYouReason: result.reason },
        { type: "event", kind: "application.needs_you", data: { reason: result.reason } },
        { type: "notify", key: "needs_you" },
      ]);
    case "failed":
      if (!result.retryable && info.preparedHandoff) {
        // Automation cannot finish this one: hand it over with everything prepared; the credit stays reserved.
        return ok([
          { type: "handoff", handoff: info.preparedHandoff },
          { type: "transition", to: "needs_you", actor: "system", needsYouReason: "blocked" },
          { type: "event", kind: "application.submit_failed", data: { error: result.error.slice(0, 300), retryable: false, handedOver: true } },
          { type: "notify", key: "needs_you" },
        ]);
      }
      return ok([
        { type: "transition", to: "ready", actor: "system" },
        ...(paid ? [{ type: "release" } as Effect] : []),
        { type: "event", kind: "application.submit_failed", data: { error: result.error.slice(0, 300), retryable: result.retryable } },
        { type: "notify", key: "submit_failed" },
      ]);
  }
}

/* ------------------------------------------------------------------ handoff done */

export function planHandoffDone(app: AppState, input: { url?: string | null; reference?: string | null; screenshotKey?: string | null; note?: string | null }, info: Omit<SubmitContextInfo, "preparedHandoff">): Plan {
  if (submittedOf(app)) return fail("already_submitted");
  if (app.status !== "needs_you") return fail("not_ready");
  if (!canTransition("needs_you", "submitted", "user", { submitted: false })) return fail("invalid_transition");
  const paid = !app.practice;
  const evidence: ApplicationEvidence = {
    screenshotKey: input.screenshotKey ?? null,
    confirmationText: input.note?.trim() || null,
    url: input.url?.trim() || null,
    messageId: null,
    reference: input.reference?.trim() || null,
    channel: app.channel ?? null,
    capturedAt: info.now.toISOString(),
    userConfirmed: true,
  };
  return ok([
    { type: "evidence", evidence },
    { type: "transition", to: "submitted", actor: "user" },
    ...(paid ? [{ type: "settle" } as Effect] : []),
    { type: "event", kind: "application.handoff_completed", data: { channel: app.channel ?? null } },
    ...(paid ? [{ type: "milestone", metric: "applications" } as Effect] : []),
    ...(paid && info.firstSubmission ? [{ type: "unlock" } as Effect] : []),
    { type: "followup", at: paid ? info.followUpAt : null, sent: 0 },
  ]);
}

/* ------------------------------------------------------------------ outcomes */

export const OUTCOME_CHOICES = ["interview", "meeting", "offer", "accepted", "funded", "admitted", "selected", "awarded", "published", "rejected", "no_response", "declined"] as const;
export type OutcomeChoice = (typeof OUTCOME_CHOICES)[number];

const POSITIVE_STEP = new Set<OutcomeResult>(["interview", "meeting"]);
const POSITIVE_FINAL = new Set<OutcomeResult>(["offer", "accepted", "funded", "admitted", "selected", "awarded", "published"]);
const REPLY_RESULTS = new Set<OutcomeResult>(["interview", "meeting", "offer", "accepted", "funded", "admitted", "selected", "awarded", "published", "rejected"]);

/** The goal milestone metric an outcome advances. */
export function outcomeMetric(result: OutcomeResult): MilestoneMetric | null {
  if (result === "interview") return "interviews";
  if (result === "meeting") return "meetings";
  if (POSITIVE_FINAL.has(result)) return "offers";
  return null;
}

/** The status an outcome moves the application to (null = stays where it is). */
export function outcomeStatus(status: ApplicationStatus, result: OutcomeResult): ApplicationStatus | null {
  if (POSITIVE_STEP.has(result) || POSITIVE_FINAL.has(result)) return status === "progress" ? null : "progress";
  if (result === "rejected") return "rejected";
  if (result === "no_response" || result === "declined" || result === "withdrawn") return "closed";
  return null;
}

export function planOutcome(app: AppState, result: OutcomeChoice, input: { note?: string | null; now: Date }): Plan {
  if (!submittedOf(app)) return fail("not_submitted");
  const to = outcomeStatus(app.status, result);
  if (to && !canTransition(app.status, to, "user", { submitted: true })) return fail("invalid_transition");
  if (!to && app.status !== "progress") return fail("invalid_transition");
  const firstReply = REPLY_RESULTS.has(result) && !(app.outcome && REPLY_RESULTS.has(app.outcome.result));
  const metric = outcomeMetric(result);
  const lessons = app.outcome?.lessons ?? [];
  return ok([
    { type: "outcome", outcome: { result, note: input.note?.trim() || null, amount: null, decidedAt: input.now.toISOString(), lessons } },
    ...(to ? [{ type: "transition", to, actor: "user" } as Effect] : []),
    ...(firstReply && !app.practice ? [{ type: "milestone", metric: "replies" } as Effect] : []),
    ...(metric && !app.practice ? [{ type: "milestone", metric } as Effect] : []),
    { type: "event", kind: "application.outcome", data: { result } },
    // Conversations and decisions stop the automatic follow-ups.
    { type: "followup", at: null },
  ]);
}

/* ------------------------------------------------------------------ withdraw */

export function planWithdraw(app: AppState): Plan {
  if (app.status === "submitting") return fail("busy");
  const submitted = submittedOf(app);
  if (!canTransition(app.status, "withdrawn", "user", { submitted })) return fail("invalid_transition");
  const credit = creditEffect(app.status, "withdrawn", { submitted });
  return ok([
    { type: "transition", to: "withdrawn", actor: "user" },
    ...(credit === "release" && !app.practice ? [{ type: "release" } as Effect] : []),
    { type: "event", kind: "application.withdrawn", data: { submitted } },
    { type: "followup", at: null },
  ]);
}

/* ------------------------------------------------------------------ follow-ups */

export interface FollowUpInfo {
  now: Date;
  /** Cumulative days after submission for each follow-up (playbook), e.g. [7, 14]. */
  followUpDays: number[];
  /** The channel can send a follow-up itself (CH4 email). */
  channelFollowUp: boolean;
  /** Standing authorization `auto_followup`. */
  authorized: boolean;
  /** The person approved this follow-up (from the room). */
  approved?: boolean;
  /** Days to wait after the last follow-up before closing as "no response". */
  closeAfterDays?: number;
}

export type FollowUpPlan =
  | { action: "none" }
  | { action: "close"; effects: Effect[] }
  | { action: "send"; before: Effect[]; afterSent: Effect[] }
  | { action: "ask"; effects: Effect[] }
  | { action: "nudge"; effects: Effect[] };

function dueDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the n-th (1-based) follow-up after `n-1` is due, from the submission or previous touch. */
export function followUpGapDays(days: number[], sent: number): number | null {
  if (sent < 0 || sent >= days.length) return null;
  return sent === 0 ? days[0] : days[sent] - days[sent - 1];
}

export function planFollowUp(app: AppState, info: FollowUpInfo): FollowUpPlan {
  const live = app.status === "submitted" || app.status === "waiting" || (app.status === "needs_you" && app.needsYouReason === "followup_approval");
  if (!live || app.practice) return { action: "none" };
  const due = dueDate(app.followUpAt);
  const approvedNow = app.status === "needs_you" && info.approved;
  if (!approvedNow && (!due || due.getTime() > info.now.getTime())) return { action: "none" };
  const sent = app.followUpsSent ?? 0;
  const day = 24 * 3600 * 1000;
  const toWaiting: Effect[] = app.status === "submitted" ? [{ type: "transition", to: "waiting", actor: "system" }] : [];

  if (sent >= info.followUpDays.length && !approvedNow) {
    return {
      action: "close",
      effects: [
        ...toWaiting,
        { type: "outcome", outcome: { result: "no_response", note: null, amount: null, decidedAt: info.now.toISOString(), lessons: app.outcome?.lessons ?? [] } },
        { type: "transition", to: "closed", actor: "system" },
        { type: "event", kind: "application.closed_no_response", data: { followUps: sent } },
        { type: "followup", at: null },
        { type: "notify", key: "closed_no_response" },
      ],
    };
  }

  const nextGap = followUpGapDays(info.followUpDays, sent + 1);
  const nextAt = nextGap !== null ? new Date(info.now.getTime() + nextGap * day) : new Date(info.now.getTime() + (info.closeAfterDays ?? 14) * day);

  if (info.channelFollowUp) {
    if (approvedNow) {
      return {
        action: "send",
        before: [],
        afterSent: [
          { type: "transition", to: "waiting", actor: "system" },
          { type: "followup", at: nextAt, sent: sent + 1 },
          { type: "event", kind: "application.followup_sent", data: { n: sent + 1, approved: true } },
          { type: "notify", key: "followup_sent" },
        ],
      };
    }
    if (info.authorized) {
      return {
        action: "send",
        before: toWaiting,
        afterSent: [
          { type: "followup", at: nextAt, sent: sent + 1 },
          { type: "event", kind: "application.followup_sent", data: { n: sent + 1, approved: false } },
          { type: "notify", key: "followup_sent" },
        ],
      };
    }
    // No standing authorization: nothing is sent without the person's tap.
    return {
      action: "ask",
      effects: [
        ...toWaiting,
        { type: "transition", to: "needs_you", actor: "system", needsYouReason: "followup_approval" },
        { type: "event", kind: "application.followup_ready", data: { n: sent + 1 } },
        { type: "notify", key: "followup_ready" },
      ],
    };
  }

  return {
    action: "nudge",
    effects: [
      ...toWaiting,
      { type: "followup", at: nextAt, sent: sent + 1 },
      { type: "event", kind: "application.check_status", data: { n: sent + 1 } },
      { type: "notify", key: "check_status" },
    ],
  };
}

/* ------------------------------------------------------------------ in-memory execution (tests, previews) */

export interface MemoryApp extends AppState {
  creditsReserved: number;
  creditsSpent: number;
  evidence: ApplicationEvidence | null;
  handoff: HandoffPackage | null;
  milestones: Partial<Record<MilestoneMetric, number>>;
  notifications: NotifyKey[];
  events: string[];
  enqueued: string[];
  unlocked: boolean;
}

/** Applies effects to an in-memory application, asserting every transition against the state machine. */
export function applyEffects(app: MemoryApp, effects: Effect[], now = new Date()): MemoryApp {
  const next: MemoryApp = { ...app, milestones: { ...app.milestones }, notifications: [...app.notifications], events: [...app.events], enqueued: [...app.enqueued] };
  for (const e of effects) {
    switch (e.type) {
      case "transition":
        if (!canTransition(next.status, e.to, e.actor, { submitted: Boolean(next.submittedAt) })) throw new Error(`invalid transition ${next.status} → ${e.to} by ${e.actor}`);
        if (e.to === "submitted" && !next.submittedAt) next.submittedAt = now.toISOString();
        next.status = e.to;
        next.needsYouReason = e.to === "needs_you" ? (e.needsYouReason ?? null) : null;
        break;
      case "reserve":
        next.creditsReserved = e.amount;
        break;
      case "settle":
        next.creditsSpent += next.creditsReserved;
        next.creditsReserved = 0;
        break;
      case "release":
        next.creditsReserved = 0;
        break;
      case "enqueue":
        next.enqueued.push(e.kind);
        break;
      case "evidence":
        next.evidence = e.evidence;
        break;
      case "handoff":
        next.handoff = e.handoff;
        break;
      case "notify":
        next.notifications.push(e.key);
        break;
      case "event":
        next.events.push(e.kind);
        break;
      case "unlock":
        next.unlocked = true;
        break;
      case "milestone":
        next.milestones[e.metric] = (next.milestones[e.metric] ?? 0) + 1;
        break;
      case "followup":
        next.followUpAt = e.at ? e.at.toISOString() : null;
        if (e.sent !== undefined) next.followUpsSent = e.sent;
        break;
      case "outcome":
        next.outcome = e.outcome;
        break;
    }
  }
  return next;
}

export function memoryApp(init: Partial<MemoryApp> & Pick<AppState, "status">): MemoryApp {
  return {
    practice: false,
    submittedAt: null,
    channel: "CH2",
    needsYouReason: null,
    followUpsSent: 0,
    followUpAt: null,
    outcome: null,
    creditsReserved: 0,
    creditsSpent: 0,
    evidence: null,
    handoff: null,
    milestones: {},
    notifications: [],
    events: [],
    enqueued: [],
    unlocked: false,
    ...init,
  };
}

/* ------------------------------------------------------------------ preparation path */

/**
 * Where preparation goes next. `gaps`: after the analysis (open = required questions still
 * unanswered). `composed`: after the documents were drafted (open = gaps the documents revealed).
 */
export function planPrepareStep(app: Pick<AppState, "status">, stage: "gaps" | "composed", open: number): Plan {
  const s = app.status;
  let to: ApplicationStatus | null = null;
  if (stage === "gaps") {
    if (s === "draft") to = open > 0 ? "needs_info" : "preparing";
    else if (s === "needs_info") to = open > 0 ? null : "preparing";
    else if (s === "preparing") to = open > 0 ? "needs_info" : null;
    else return fail("invalid_transition");
  } else {
    if (s !== "preparing") return fail("invalid_transition");
    to = open > 0 ? "needs_info" : "ready";
  }
  if (!to) return ok([]);
  const actor: Actor = "system";
  if (!canTransition(s, to, actor, { submitted: false })) return fail("invalid_transition");
  return ok([
    { type: "transition", to, actor },
    ...(to === "needs_info" ? [{ type: "notify", key: "questions" } as Effect] : []),
    ...(to === "ready" ? [{ type: "notify", key: "ready" } as Effect] : []),
  ]);
}

/* ------------------------------------------------------------------ replies (CH4 drop-box, "they replied") */

export type ReplyClass = "interested" | "meeting" | "rejected" | "needs_info" | "auto_reply" | "other";

/** A classified reply from the organiser moves the application (channel evidence). */
export function planReply(app: AppState, classification: ReplyClass, input: { summary?: string | null; now: Date }): Plan {
  if (!submittedOf(app)) return ok([{ type: "event", kind: "application.reply", data: { classification, matched: false } }]);
  const human = classification !== "auto_reply";
  const effects: Effect[] = [{ type: "event", kind: "application.reply", data: { classification } }];
  const firstReply = human && classification !== "other" && !(app.outcome && REPLY_RESULTS.has(app.outcome.result));
  const note = input.summary?.trim() || null;
  let to: ApplicationStatus | null = null;
  let result: OutcomeResult | null = null;
  let reason: string | null = null;
  if (classification === "interested" || classification === "meeting") {
    to = app.status === "progress" ? null : "progress";
    result = classification === "meeting" ? "meeting" : "other";
  } else if (classification === "rejected") {
    to = app.status === "rejected" ? null : "rejected";
    result = "rejected";
  } else if (classification === "needs_info") {
    to = app.status === "needs_you" ? null : "needs_you";
    reason = "organiser_request";
  }
  if (to && !canTransition(app.status, to, "channel", { submitted: true })) to = null;
  if (result) effects.push({ type: "outcome", outcome: { result, note, amount: null, decidedAt: input.now.toISOString(), lessons: app.outcome?.lessons ?? [] } });
  if (to) effects.push({ type: "transition", to, actor: "channel", needsYouReason: reason });
  if (firstReply && !app.practice) effects.push({ type: "milestone", metric: "replies" });
  if (classification === "meeting" && !app.practice) effects.push({ type: "milestone", metric: "meetings" });
  if (human) effects.push({ type: "followup", at: null });
  // No notify effect: replies arrive through the drop-box (src/lib/integrations/replies.ts), which
  // notifies once with the reply's own summary ("<who> needs more information: …"). The generic
  // "needs_you" copy describes a submission handoff and would be wrong here.
  return ok(effects);
}
