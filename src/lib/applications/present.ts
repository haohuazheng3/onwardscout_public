import { boardColumn, type BoardColumn } from "@/lib/core/state-machine";
import type { ApplicationStatus } from "@/lib/core/types";

/*
 * How an application reads on the board, in plain words (pure, client-safe). Returns message
 * keys under `applications.status.*` / `applications.next.*` plus their variables; the UI
 * formats dates with the person's locale.
 */

export interface PresentInput {
  status: ApplicationStatus;
  needsYouReason?: string | null;
  openQuestions?: number;
  submittedAt?: string | Date | null;
  followUpAt?: string | Date | null;
  channel?: string;
  practice?: boolean;
}

export interface Line {
  key: string;
  vars?: Record<string, string | number>;
}

export type NextAction = "answer" | "confirm" | "handoff" | "send_email" | "approve_followup" | "record_outcome" | "wait" | null;

export function statusLine(a: PresentInput): Line {
  switch (a.status) {
    case "draft":
      return { key: "status.draft" };
    case "needs_info":
      return { key: "status.needs_info", vars: { count: Math.max(1, a.openQuestions ?? 1) } };
    case "preparing":
      return { key: "status.preparing" };
    case "ready":
      return { key: a.practice ? "status.ready_practice" : "status.ready" };
    case "submitting":
      return { key: "status.submitting" };
    case "submitted":
      return { key: "status.submitted" };
    case "waiting":
      return a.followUpAt ? { key: "status.waiting_followup" } : { key: "status.waiting" };
    case "needs_you":
      return { key: `status.needs_you_${needsYouKey(a.needsYouReason)}` };
    case "progress":
      return { key: "status.progress" };
    case "rejected":
      return { key: "status.rejected" };
    case "expired":
      return { key: "status.expired" };
    case "withdrawn":
      return { key: "status.withdrawn" };
    case "closed":
      return { key: "status.closed" };
  }
}

export function needsYouKey(reason: string | null | undefined): string {
  switch (reason) {
    case "captcha":
    case "login":
    case "payment":
    case "no_gmail":
    case "followup_approval":
    case "organiser_request":
    case "next_step":
    case "opportunity_missing":
      return reason;
    default:
      return "handoff";
  }
}

export function nextAction(a: PresentInput): NextAction {
  switch (a.status) {
    case "needs_info":
      return "answer";
    case "ready":
      return "confirm";
    case "needs_you":
      if (a.needsYouReason === "no_gmail") return "send_email";
      if (a.needsYouReason === "followup_approval") return "approve_followup";
      if (a.submittedAt) return "record_outcome";
      return "handoff";
    case "submitted":
    case "waiting":
    case "progress":
      return "record_outcome";
    case "draft":
    case "preparing":
    case "submitting":
      return "wait";
    default:
      return null;
  }
}

/** Board columns in display order, with the column a status belongs to. */
export function columnOf(status: ApplicationStatus): BoardColumn {
  return boardColumn(status);
}

/** Days until a deadline (negative = passed), or null. */
export function daysUntil(deadline: string | Date | null | undefined, now = new Date()): number | null {
  if (!deadline) return null;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

/** Sort inside a column: what needs the person first, then the nearest deadline, then the newest. */
export function cardOrder<T extends { status: ApplicationStatus; updatedAt: string; opportunity: { deadline: string | null } }>(a: T, b: T): number {
  const urgency = (s: ApplicationStatus) => (s === "needs_you" || s === "needs_info" ? 0 : s === "ready" ? 1 : 2);
  const u = urgency(a.status) - urgency(b.status);
  if (u) return u;
  const da = a.opportunity.deadline ? new Date(a.opportunity.deadline).getTime() : Infinity;
  const db = b.opportunity.deadline ? new Date(b.opportunity.deadline).getTime() : Infinity;
  if (da !== db) return da - db;
  return b.updatedAt.localeCompare(a.updatedAt);
}
