import { describe, expect, it } from "vitest";
import {
  ACTORS,
  APPLICATION_STATUSES,
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  InvalidTransitionError,
  POST_SUBMISSION_STATUSES,
  PRE_SUBMISSION_STATUSES,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  TRANSITIONS,
  assertTransition,
  boardColumn,
  boardColumnLabel,
  canTransition,
  creditEffect,
  hasCjk,
  isEnded,
  isTerminal,
  needsUser,
  nextStatuses,
  statusLabel,
  statusesInColumn,
  type ApplicationStatus,
} from "@/lib/core";

/** The complete, intended transition table: `from>to:actors[:phase]`. Any change must be deliberate. */
const EXPECTED = [
  "draft>needs_info:system",
  "draft>preparing:system",
  "draft>needs_you:system",
  "draft>withdrawn:user",
  "draft>expired:system",
  "needs_info>preparing:user,system",
  "needs_info>needs_you:system",
  "needs_info>withdrawn:user",
  "needs_info>expired:system",
  "preparing>ready:system",
  "preparing>needs_info:system",
  "preparing>needs_you:system",
  "preparing>withdrawn:user",
  "preparing>expired:system",
  "ready>submitting:user,system",
  "ready>preparing:user,system",
  "ready>needs_info:system",
  "ready>withdrawn:user",
  "ready>expired:system",
  "submitting>submitted:channel",
  "submitting>needs_you:channel,system",
  "submitting>ready:system",
  "submitted>waiting:system",
  "submitted>progress:channel,user",
  "submitted>rejected:channel,user",
  "submitted>needs_you:channel",
  "submitted>withdrawn:user",
  "submitted>closed:user",
  "waiting>progress:channel,user",
  "waiting>rejected:channel,user",
  "waiting>needs_you:channel,system",
  "waiting>withdrawn:user",
  "waiting>closed:system,user",
  "needs_you>preparing:user:pre",
  "needs_you>needs_info:system:pre",
  "needs_you>ready:user:pre",
  "needs_you>submitting:user:pre",
  "needs_you>submitted:user:pre",
  "needs_you>expired:system:pre",
  "needs_you>waiting:user,system:post",
  "needs_you>progress:user,channel:post",
  "needs_you>rejected:user,channel:post",
  "needs_you>closed:user:post",
  "needs_you>withdrawn:user",
  "progress>waiting:system,user",
  "progress>needs_you:channel,system",
  "progress>rejected:channel,user",
  "progress>closed:user,system",
  "progress>withdrawn:user",
  "rejected>closed:system,user",
  "expired>closed:system,user",
  "expired>draft:system,user",
  "withdrawn>closed:system",
  "withdrawn>draft:user:pre",
];

describe("application state machine", () => {
  it("matches the intended transition table exactly", () => {
    const actual = TRANSITIONS.map((t) => `${t.from}>${t.to}:${t.actors.join(",")}${t.phase ? `:${t.phase}` : ""}`);
    expect(actual).toEqual(EXPECTED);
  });

  it("has well-formed edges: known statuses and actors, no duplicates, no self-loops, a reason", () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      expect(APPLICATION_STATUSES).toContain(t.from);
      expect(APPLICATION_STATUSES).toContain(t.to);
      expect(t.from).not.toBe(t.to);
      expect(t.actors.length).toBeGreaterThan(0);
      for (const a of t.actors) expect(ACTORS).toContain(a);
      expect(new Set(t.actors).size).toBe(t.actors.length);
      expect(t.reason.length).toBeGreaterThan(5);
      const key = `${t.from}>${t.to}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("agrees with canTransition for every (from, to, actor) triple", () => {
    for (const from of APPLICATION_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        const edge = TRANSITIONS.find((t) => t.from === from && t.to === to);
        expect(canTransition(from, to), `${from}>${to}`).toBe(Boolean(edge));
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor), `${from}>${to} by ${actor}`).toBe(Boolean(edge?.actors.includes(actor)));
        }
      }
    }
  });

  it("has no dead ends except the terminal status", () => {
    expect(TERMINAL_STATUSES).toEqual(["closed"]);
    for (const s of APPLICATION_STATUSES) {
      const out = nextStatuses(s);
      if (isTerminal(s)) expect(out, s).toEqual([]);
      else expect(out.length, s).toBeGreaterThan(0);
    }
  });

  it("reaches every status from draft and can close from every status", () => {
    const reach = new Set<ApplicationStatus>(["draft"]);
    const queue: ApplicationStatus[] = ["draft"];
    while (queue.length) {
      const s = queue.shift()!;
      for (const n of nextStatuses(s)) {
        if (reach.has(n)) continue;
        reach.add(n);
        queue.push(n);
      }
    }
    expect([...reach].sort()).toEqual([...APPLICATION_STATUSES].sort());

    for (const s of APPLICATION_STATUSES) {
      const seen = new Set<ApplicationStatus>([s]);
      const q: ApplicationStatus[] = [s];
      while (q.length) {
        const cur = q.shift()!;
        for (const n of nextStatuses(cur)) {
          if (seen.has(n)) continue;
          seen.add(n);
          q.push(n);
        }
      }
      expect(seen.has("closed"), s).toBe(true);
    }
  });

  it("only lets the right actor act", () => {
    expect(canTransition("submitting", "submitted", "channel")).toBe(true);
    expect(canTransition("submitting", "submitted", "user")).toBe(false); // a submission is proven, not claimed
    expect(canTransition("ready", "submitting", "user")).toBe(true);
    expect(canTransition("ready", "submitting", "system")).toBe(true); // standing authorization
    expect(canTransition("draft", "withdrawn", "system")).toBe(false); // only the person withdraws
    expect(canTransition("waiting", "withdrawn", "channel")).toBe(false);
    expect(canTransition("draft", "submitted")).toBe(false); // never skip confirmation
    expect(nextStatuses("submitting", "user")).toEqual([]);
    expect(nextStatuses("ready", "user")).toEqual(["preparing", "submitting", "withdrawn"]);
  });

  it("separates the needs_you exits before and after submission", () => {
    expect(canTransition("needs_you", "submitted", "user", { submitted: false })).toBe(true);
    expect(canTransition("needs_you", "submitted", "user", { submitted: true })).toBe(false);
    expect(canTransition("needs_you", "waiting", "user", { submitted: true })).toBe(true);
    expect(canTransition("needs_you", "waiting", "user", { submitted: false })).toBe(false);
    expect(canTransition("needs_you", "withdrawn", "user", { submitted: true })).toBe(true);
    expect(canTransition("needs_you", "withdrawn", "user", { submitted: false })).toBe(true);
    expect(nextStatuses("needs_you", undefined, { submitted: false })).toEqual(["needs_info", "preparing", "ready", "submitting", "submitted", "expired", "withdrawn"]);
    expect(nextStatuses("needs_you", undefined, { submitted: true })).toEqual(["waiting", "progress", "rejected", "withdrawn", "closed"]);
    expect(canTransition("withdrawn", "draft", "user", { submitted: true })).toBe(false);
  });

  it("keeps pre- and post-submission statuses apart except through the submission gateways", () => {
    for (const t of TRANSITIONS) {
      if (PRE_SUBMISSION_STATUSES.includes(t.from) && POST_SUBMISSION_STATUSES.includes(t.to)) {
        expect(`${t.from}>${t.to}`).toBe("submitting>submitted");
      }
      if (POST_SUBMISSION_STATUSES.includes(t.from)) expect(PRE_SUBMISSION_STATUSES).not.toContain(t.to);
    }
  });

  it("asserts transitions with a readable error", () => {
    expect(assertTransition("preparing", "ready", "system").reason).toMatch(/composed/);
    expect(() => assertTransition("draft", "submitted", "user")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("draft", "submitted", "user")).toThrow('Application cannot go from "draft" to "submitted" (actor: user).');
  });

  it("moves credits only where the billing rules say", () => {
    expect(creditEffect("submitting", "submitted")).toBe("debit");
    expect(creditEffect("needs_you", "submitted", { submitted: false })).toBe("debit");
    expect(creditEffect("draft", "withdrawn")).toBe("release");
    expect(creditEffect("ready", "expired")).toBe("release");
    expect(creditEffect("needs_you", "withdrawn", { submitted: false })).toBe("release");
    expect(creditEffect("waiting", "withdrawn", { submitted: true })).toBeNull();
    expect(creditEffect("expired", "draft")).toBe("reserve");
    expect(creditEffect("withdrawn", "draft")).toBe("reserve");
    expect(creditEffect("submitting", "ready")).toBeNull();
    expect(creditEffect("waiting", "closed", { submitted: true })).toBeNull();
    expect(creditEffect("rejected", "closed", { submitted: true })).toBeNull();
  });

  it("classifies statuses", () => {
    expect(isEnded("rejected")).toBe(true);
    expect(isEnded("waiting")).toBe(false);
    expect(needsUser("needs_info")).toBe(true);
    expect(needsUser("ready")).toBe(true);
    expect(needsUser("waiting")).toBe(false);
  });
});

describe("application board", () => {
  it("maps every status to one of the eight columns, and every column has a status", () => {
    expect(BOARD_COLUMNS).toEqual(["todo", "preparing", "needs_you", "ready", "submitted", "waiting", "progress", "closed"]);
    for (const s of APPLICATION_STATUSES) expect(BOARD_COLUMNS).toContain(boardColumn(s));
    for (const c of BOARD_COLUMNS) expect(statusesInColumn(c).length, c).toBeGreaterThan(0);
    expect(statusesInColumn("needs_you")).toEqual(["needs_info", "needs_you"]);
    expect(statusesInColumn("closed")).toEqual(["rejected", "expired", "withdrawn", "closed"]);
    expect(boardColumn("submitting")).toBe("submitted");
    expect(boardColumn("draft")).toBe("todo");
  });

  it("labels every status and column in both languages", () => {
    for (const s of APPLICATION_STATUSES) {
      expect(STATUS_LABELS[s].en).not.toBe("");
      expect(hasCjk(STATUS_LABELS[s].zh)).toBe(true);
    }
    for (const c of BOARD_COLUMNS) {
      expect(BOARD_COLUMN_LABELS[c].en).not.toBe("");
      expect(hasCjk(BOARD_COLUMN_LABELS[c].zh)).toBe(true);
    }
    expect(statusLabel("needs_you", "zh")).toBe("需要你");
    expect(boardColumnLabel("ready", "en")).toBe("Ready to confirm");
    expect(statusLabel("rejected", "fr")).toBe("Not selected");
  });
});
