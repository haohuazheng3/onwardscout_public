/**
 * Application state machine (plan §11.4), pure and exhaustive.
 *
 *   draft → needs_info → preparing → ready → submitting → submitted → waiting
 *      ↘ needs_you (stuck, any phase) ↗                                  ↓
 *                       progress (interview, meeting, shortlist) | rejected | expired → closed
 *
 * Every transition names the actors allowed to trigger it:
 *   user    — the person, from the UI (confirm, answer, "I submitted it", withdraw…);
 *   system  — our own logic (orchestrator, cron, deadlines, standing authorizations);
 *   channel — evidence from a channel (a submission confirmation, a classified reply).
 * `needs_you` exists before and after submission; transitions out of it that only make sense on
 * one side are tagged with a phase, judged from `submitted_at` (pass `{ submitted }`).
 * Only src/lib/applications (P3a) writes `applications.status`, always through `assertTransition`.
 */
import { bi, localize, type Bilingual, type Locale } from "./labels";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./types";

export const ACTORS = ["user", "system", "channel"] as const;
export type Actor = (typeof ACTORS)[number];

export type TransitionPhase = "pre" | "post";

export interface Transition {
  from: ApplicationStatus;
  to: ApplicationStatus;
  actors: Actor[];
  /** Only valid before (`pre`) or after (`post`) the application was submitted. */
  phase?: TransitionPhase;
  /** Why this edge exists (for logs, admin and tests). */
  reason: string;
}

const tr = (from: ApplicationStatus, to: ApplicationStatus, actors: Actor[], reason: string, phase?: TransitionPhase): Transition => ({
  from,
  to,
  actors,
  reason,
  ...(phase ? { phase } : {}),
});

export const TRANSITIONS: readonly Transition[] = [
  // draft: the person tapped "Apply for me"; credits are reserved at creation.
  tr("draft", "needs_info", ["system"], "analysis found gaps the profile cannot answer"),
  tr("draft", "preparing", ["system"], "analysis found everything needed"),
  tr("draft", "needs_you", ["system"], "the organiser requires something only the person can do first (account, eligibility check)"),
  tr("draft", "withdrawn", ["user"], "the person changed their mind"),
  tr("draft", "expired", ["system"], "the deadline passed before work started"),

  tr("needs_info", "preparing", ["user", "system"], "the gap questions were answered (by the person, or by a profile update)"),
  tr("needs_info", "needs_you", ["system"], "an answer requires a handoff (a document only the person holds)"),
  tr("needs_info", "withdrawn", ["user"], "the person changed their mind"),
  tr("needs_info", "expired", ["system"], "the deadline passed while waiting for answers"),

  tr("preparing", "ready", ["system"], "documents and answers are composed and previewable"),
  tr("preparing", "needs_info", ["system"], "composing revealed a new gap"),
  tr("preparing", "needs_you", ["system"], "preparation needs the person (unsourced claim to confirm, file to supply)"),
  tr("preparing", "withdrawn", ["user"], "the person changed their mind"),
  tr("preparing", "expired", ["system"], "the deadline passed during preparation"),

  tr("ready", "submitting", ["user", "system"], "the person confirmed, or a standing authorization for this category applies"),
  tr("ready", "preparing", ["user", "system"], "the person asked for changes, or the profile changed and the documents are regenerated"),
  tr("ready", "needs_info", ["system"], "the organiser changed the form and a new field is required"),
  tr("ready", "withdrawn", ["user"], "the person decided not to submit"),
  tr("ready", "expired", ["system"], "the deadline passed before confirmation"),

  tr("submitting", "submitted", ["channel"], "the channel captured confirmation evidence"),
  tr("submitting", "needs_you", ["channel", "system"], "CAPTCHA, login, payment or repeated failure: handed over (CH6)"),
  tr("submitting", "ready", ["system"], "a transient failure: rolled back to retry, nothing was sent"),

  tr("submitted", "waiting", ["system"], "submission recorded; follow-ups scheduled"),
  tr("submitted", "progress", ["channel", "user"], "a positive reply (interview, meeting, shortlist)"),
  tr("submitted", "rejected", ["channel", "user"], "the organiser declined"),
  tr("submitted", "needs_you", ["channel"], "the organiser asked for more information"),
  tr("submitted", "withdrawn", ["user"], "the person withdrew the application"),
  tr("submitted", "closed", ["user"], "the person closed it without an outcome"),

  tr("waiting", "progress", ["channel", "user"], "a positive reply (interview, meeting, shortlist)"),
  tr("waiting", "rejected", ["channel", "user"], "the organiser declined"),
  tr("waiting", "needs_you", ["channel", "system"], "the organiser asked for more information, or a follow-up needs approval"),
  tr("waiting", "withdrawn", ["user"], "the person withdrew the application"),
  tr("waiting", "closed", ["system", "user"], "no response after the last follow-up"),

  tr("needs_you", "preparing", ["user"], "the person supplied what was missing; documents are regenerated", "pre"),
  tr("needs_you", "needs_info", ["system"], "the remaining gaps can be asked as questions", "pre"),
  tr("needs_you", "ready", ["user"], "the person resolved the blocker and the prepared application stands", "pre"),
  tr("needs_you", "submitting", ["user"], "the person cleared the CAPTCHA or login; retry the submission", "pre"),
  tr("needs_you", "submitted", ["user"], "handoff completed: \"I submitted it\"", "pre"),
  tr("needs_you", "expired", ["system"], "the deadline passed while waiting for the person", "pre"),
  tr("needs_you", "waiting", ["user", "system"], "the organiser's request was answered", "post"),
  tr("needs_you", "progress", ["user", "channel"], "the next step was scheduled (interview, meeting)", "post"),
  tr("needs_you", "rejected", ["user", "channel"], "the organiser declined", "post"),
  tr("needs_you", "closed", ["user"], "the person closed it without an outcome", "post"),
  tr("needs_you", "withdrawn", ["user"], "the person withdrew"),

  tr("progress", "waiting", ["system", "user"], "the step happened; waiting for the next decision"),
  tr("progress", "needs_you", ["channel", "system"], "the next step needs the person (schedule, documents, decision)"),
  tr("progress", "rejected", ["channel", "user"], "the organiser declined after a later round"),
  tr("progress", "closed", ["user", "system"], "outcome recorded (offer accepted or declined, funded, admitted…)"),
  tr("progress", "withdrawn", ["user"], "the person withdrew"),

  tr("rejected", "closed", ["system", "user"], "retrospective recorded"),
  tr("expired", "closed", ["system", "user"], "retrospective recorded"),
  tr("expired", "draft", ["system", "user"], "the deadline was extended or a new cycle opened; credits are reserved again"),
  tr("withdrawn", "closed", ["system"], "archived"),
  tr("withdrawn", "draft", ["user"], "reopened before it was ever submitted; credits are reserved again", "pre"),
];

/** No way out: the retrospective is done. */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = ["closed"];
/** Ended, but still to be closed with a retrospective. */
export const ENDED_STATUSES: readonly ApplicationStatus[] = ["rejected", "expired", "withdrawn", "closed"];
/** The person has something to do. */
export const NEEDS_USER_STATUSES: readonly ApplicationStatus[] = ["needs_info", "needs_you", "ready"];
/** Statuses an application can only have before submission (submitted_at is null). */
export const PRE_SUBMISSION_STATUSES: readonly ApplicationStatus[] = ["draft", "needs_info", "preparing", "ready", "submitting", "expired"];
/** Statuses an application can only have after submission. */
export const POST_SUBMISSION_STATUSES: readonly ApplicationStatus[] = ["submitted", "waiting", "progress", "rejected"];

export function isTerminal(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isEnded(status: ApplicationStatus): boolean {
  return ENDED_STATUSES.includes(status);
}

export function needsUser(status: ApplicationStatus): boolean {
  return NEEDS_USER_STATUSES.includes(status);
}

export interface TransitionContext {
  /** Whether the application has been submitted (`submitted_at` is set). */
  submitted?: boolean;
}

function phaseOk(t: Transition, ctx: TransitionContext): boolean {
  if (!t.phase || ctx.submitted === undefined) return true;
  return t.phase === "post" ? ctx.submitted : !ctx.submitted;
}

export function findTransition(from: ApplicationStatus, to: ApplicationStatus, actor?: Actor, ctx: TransitionContext = {}): Transition | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && (!actor || t.actors.includes(actor)) && phaseOk(t, ctx)) ?? null;
}

/** Whether `actor` may move an application from `from` to `to` (any actor when omitted). */
export function canTransition(from: ApplicationStatus, to: ApplicationStatus, actor?: Actor, ctx: TransitionContext = {}): boolean {
  return findTransition(from, to, actor, ctx) !== null;
}

/** Statuses reachable in one step, optionally for one actor, in canonical status order. */
export function nextStatuses(from: ApplicationStatus, actor?: Actor, ctx: TransitionContext = {}): ApplicationStatus[] {
  const targets = new Set(
    TRANSITIONS.filter((t) => t.from === from && (!actor || t.actors.includes(actor)) && phaseOk(t, ctx)).map((t) => t.to),
  );
  return APPLICATION_STATUSES.filter((s) => targets.has(s));
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ApplicationStatus,
    readonly to: ApplicationStatus,
    readonly actor: Actor,
  ) {
    super(`Application cannot go from "${from}" to "${to}" (actor: ${actor}).`);
    this.name = "InvalidTransitionError";
  }
}

/** Throws `InvalidTransitionError` unless the transition is allowed; returns the edge. */
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus, actor: Actor, ctx: TransitionContext = {}): Transition {
  const t = findTransition(from, to, actor, ctx);
  if (!t) throw new InvalidTransitionError(from, to, actor);
  return t;
}

/**
 * Credit movement caused by a transition (build contract "Credits & billing"): reserve happens at
 * "Apply for me" (creation, outside this table) and again when an ended application is
 * reopened; debit when it becomes submitted; release when it ends without ever being
 * submitted. Practice applications never move credits — callers skip them.
 */
export function creditEffect(from: ApplicationStatus, to: ApplicationStatus, ctx: TransitionContext = {}): "reserve" | "debit" | "release" | null {
  const submitted = ctx.submitted ?? false;
  if (to === "submitted" && !submitted) return "debit";
  if ((to === "withdrawn" || to === "expired") && !submitted) return "release";
  if (to === "draft" && (from === "expired" || from === "withdrawn")) return "reserve";
  return null;
}

/* ------------------------------------------------------------------ board */

export const BOARD_COLUMNS = ["todo", "preparing", "needs_you", "ready", "submitted", "waiting", "progress", "closed"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const STATUS_COLUMN: Readonly<Record<ApplicationStatus, BoardColumn>> = {
  draft: "todo",
  needs_info: "needs_you",
  preparing: "preparing",
  ready: "ready",
  submitting: "submitted",
  submitted: "submitted",
  waiting: "waiting",
  needs_you: "needs_you",
  progress: "progress",
  rejected: "closed",
  expired: "closed",
  withdrawn: "closed",
  closed: "closed",
};

export function boardColumn(status: ApplicationStatus): BoardColumn {
  return STATUS_COLUMN[status];
}

export function statusesInColumn(column: BoardColumn): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter((s) => STATUS_COLUMN[s] === column);
}

export const BOARD_COLUMN_LABELS: Readonly<Record<BoardColumn, Bilingual>> = {
  todo: bi("To do", "待处理"),
  preparing: bi("Preparing", "准备中"),
  needs_you: bi("Needs you", "需要你"),
  ready: bi("Ready to confirm", "待确认"),
  submitted: bi("Submitted", "已提交"),
  waiting: bi("Waiting", "等待回复"),
  progress: bi("In progress", "有进展"),
  closed: bi("Closed", "已结束"),
};

export const STATUS_LABELS: Readonly<Record<ApplicationStatus, Bilingual>> = {
  draft: bi("Draft", "草稿"),
  needs_info: bi("Needs info", "待补信息"),
  preparing: bi("Preparing", "生成材料中"),
  ready: bi("Ready to confirm", "待确认"),
  submitting: bi("Submitting", "提交中"),
  submitted: bi("Submitted", "已提交"),
  waiting: bi("Waiting for a reply", "等待回复"),
  needs_you: bi("Needs you", "需要你"),
  progress: bi("Progress", "有进展"),
  rejected: bi("Not selected", "未通过"),
  expired: bi("Expired", "已过期"),
  withdrawn: bi("Withdrawn", "已撤回"),
  closed: bi("Closed", "已结束"),
};

export function statusLabel(status: ApplicationStatus, locale: Locale | string): string {
  return localize(STATUS_LABELS[status], locale);
}

export function boardColumnLabel(column: BoardColumn, locale: Locale | string): string {
  return localize(BOARD_COLUMN_LABELS[column], locale);
}
