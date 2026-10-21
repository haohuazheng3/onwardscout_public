import { describe, expect, it } from "vitest";
import { applyEffects, creditCost, followUpGapDays, memoryApp, planConfirm, planFollowUp, planHandoffDone, planOutcome, planPrepareStep, planReply, planSubmitResult, planWithdraw, type Effect, type MemoryApp, type Plan } from "@/lib/applications/plan";
import { cardOrder, daysUntil, needsYouKey, nextAction, statusLine } from "@/lib/applications/present";
import type { HandoffPackage, SubmitResultLike } from "@/lib/applications/types";

const NOW = new Date("2026-10-21T09:00:00Z");
const DAY = 24 * 3600 * 1000;
const HANDOFF: HandoffPackage = { url: "https://example.org/apply", steps: [{ n: 1, text: "Open the form" }], fields: [{ label: "Full name", value: "Avery Quinn" }], files: [{ name: "resume.pdf", generatedDocumentId: "gen_1" }], notes: [] };

/** A scripted channel: returns the queued results in order (the real ones live in src/lib/channels). */
function fakeChannel(results: SubmitResultLike[]) {
  const calls: string[] = [];
  return {
    calls,
    async submit(ctx: { applicationId: string }): Promise<SubmitResultLike> {
      calls.push(ctx.applicationId);
      const r = results.shift();
      if (!r) throw new Error("no scripted result");
      return r;
    },
  };
}

function must(plan: Plan): Effect[] {
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  return plan.effects;
}

/** Runs preparation the way prepare.ts does: gaps → (answers) → compose → ready. */
function prepare(app: MemoryApp, openAfterGaps: number): MemoryApp {
  let a = applyEffects(app, must(planPrepareStep(app, "gaps", openAfterGaps)), NOW);
  if (a.status === "needs_info") {
    // the person answers every question: the answer route moves needs_info → preparing (user)
    a = applyEffects(a, [{ type: "transition", to: "preparing", actor: "user" }], NOW);
    a = applyEffects(a, must(planPrepareStep(a, "gaps", 0)), NOW);
  }
  return applyEffects(a, must(planPrepareStep(a, "composed", 0)), NOW);
}

async function confirmAndSubmit(app: MemoryApp, channel: ReturnType<typeof fakeChannel>, info: { first?: boolean } = {}): Promise<MemoryApp> {
  let a = applyEffects(app, must(planConfirm(app, { explicit: true })), NOW);
  expect(a.status).toBe("submitting");
  const result = await channel.submit({ applicationId: "app_1" });
  a = applyEffects(a, must(planSubmitResult(a, result, { firstSubmission: info.first ?? true, followUpAt: new Date(NOW.getTime() + 7 * DAY), now: NOW, preparedHandoff: HANDOFF })), NOW);
  return a;
}

describe("the happy path (CH2 form)", () => {
  it("draft → needs_info → preparing → ready → submitting → submitted, credit reserved then settled", async () => {
    let app = memoryApp({ status: "draft", channel: "CH2" });
    app = prepare(app, 2);
    expect(app.status).toBe("ready");
    expect(app.notifications).toEqual(["questions", "ready"]);

    const channel = fakeChannel([{ status: "submitted", evidence: { confirmationText: "Thanks, we got it", ref: "SBX-7K2M9Q", url: "https://example.org/thanks" } }]);
    const confirmEffects = must(planConfirm(app, { explicit: true }));
    expect(confirmEffects[0]).toEqual({ type: "reserve", amount: 1 });
    app = await confirmAndSubmit(app, channel);
    expect(channel.calls).toHaveLength(1);
    expect(app.status).toBe("submitted");
    expect(app.creditsSpent).toBe(1);
    expect(app.creditsReserved).toBe(0);
    expect(app.evidence?.reference).toBe("SBX-7K2M9Q");
    expect(app.evidence?.userConfirmed).toBe(false);
    expect(app.unlocked).toBe(true);
    expect(app.milestones.applications).toBe(1);
    expect(app.followUpAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    expect(app.enqueued).toEqual(["application.submit"]);
  });

  it("nothing is submitted without the tap or a standing authorization", () => {
    const ready = memoryApp({ status: "ready" });
    expect(planConfirm(ready, { explicit: false })).toEqual({ ok: false, error: "needs_confirmation" });
    const auto = must(planConfirm(ready, { explicit: false, authorized: true }));
    expect(auto.find((e) => e.type === "transition")).toMatchObject({ to: "submitting", actor: "system" });
    expect(planConfirm(memoryApp({ status: "preparing" }), { explicit: true })).toEqual({ ok: false, error: "not_ready" });
    expect(planConfirm(memoryApp({ status: "submitting" }), { explicit: true })).toEqual({ ok: false, error: "busy" });
    expect(planConfirm(memoryApp({ status: "ready", submittedAt: NOW.toISOString() }), { explicit: true })).toEqual({ ok: false, error: "already_submitted" });
  });

  it("only the first real submission unlocks", async () => {
    const app = prepare(memoryApp({ status: "draft" }), 0);
    const done = await confirmAndSubmit(app, fakeChannel([{ status: "submitted", evidence: {} }]), { first: false });
    expect(done.unlocked).toBe(false);
  });
});

describe("handoff (CH6 / CAPTCHA / login)", () => {
  it("needs_you keeps the credit reserved until “I submitted it”", async () => {
    let app = prepare(memoryApp({ status: "draft", channel: "CH3" }), 0);
    app = await confirmAndSubmit(app, fakeChannel([{ status: "needs_you", reason: "captcha", handoff: HANDOFF }]));
    expect(app.status).toBe("needs_you");
    expect(app.needsYouReason).toBe("captcha");
    expect(app.handoff).toEqual(HANDOFF);
    expect(app.creditsReserved).toBe(1);
    expect(app.creditsSpent).toBe(0);
    expect(app.notifications.at(-1)).toBe("needs_you");

    app = applyEffects(app, must(planHandoffDone(app, { url: "https://example.org/confirmation/123", reference: "A-123" }, { firstSubmission: true, followUpAt: null, now: NOW })), NOW);
    expect(app.status).toBe("submitted");
    expect(app.creditsSpent).toBe(1);
    expect(app.evidence).toMatchObject({ userConfirmed: true, url: "https://example.org/confirmation/123", reference: "A-123" });
    expect(app.events).toContain("application.handoff_completed");
    expect(planHandoffDone(app, {}, { firstSubmission: false, followUpAt: null, now: NOW })).toEqual({ ok: false, error: "already_submitted" });
  });

  it("withdrawing a handoff gives the credit back", async () => {
    let app = prepare(memoryApp({ status: "draft", channel: "CH6" }), 0);
    app = await confirmAndSubmit(app, fakeChannel([{ status: "needs_you", reason: "unsupported", handoff: HANDOFF }]));
    app = applyEffects(app, must(planWithdraw(app)), NOW);
    expect(app.status).toBe("withdrawn");
    expect(app.creditsReserved).toBe(0);
    expect(app.creditsSpent).toBe(0);
  });
});

describe("failures", () => {
  it("a transient failure rolls back to ready and releases the credit; the person can retry", async () => {
    let app = prepare(memoryApp({ status: "draft" }), 0);
    app = await confirmAndSubmit(app, fakeChannel([{ status: "failed", error: "502 from the form", retryable: true }]));
    expect(app.status).toBe("ready");
    expect(app.creditsReserved).toBe(0);
    expect(app.creditsSpent).toBe(0);
    expect(app.notifications.at(-1)).toBe("submit_failed");
    // retry
    app = await confirmAndSubmit(app, fakeChannel([{ status: "submitted", evidence: { ref: "R-1" } }]));
    expect(app.status).toBe("submitted");
    expect(app.creditsSpent).toBe(1);
  });

  it("a permanent failure becomes a handoff with the prepared package", async () => {
    let app = prepare(memoryApp({ status: "draft" }), 0);
    app = await confirmAndSubmit(app, fakeChannel([{ status: "failed", error: "form changed", retryable: false }]));
    expect(app.status).toBe("needs_you");
    expect(app.needsYouReason).toBe("blocked");
    expect(app.handoff).toEqual(HANDOFF);
    expect(app.creditsReserved).toBe(1);
  });
});

describe("practice runs are free", () => {
  it("no reservation, no milestones, no unlock, no follow-ups", async () => {
    let app = prepare(memoryApp({ status: "draft", practice: true }), 1);
    expect(creditCost(app)).toBe(0);
    expect(must(planConfirm(app, { explicit: true })).some((e) => e.type === "reserve")).toBe(false);
    app = await confirmAndSubmit(app, fakeChannel([{ status: "submitted", evidence: { ref: "SBX-AAAAAA" } }]));
    expect(app.status).toBe("submitted");
    expect(app.creditsSpent).toBe(0);
    expect(app.milestones).toEqual({});
    expect(app.unlocked).toBe(false);
    expect(app.followUpAt).toBeNull();
    expect(planFollowUp(app, { now: new Date(NOW.getTime() + 30 * DAY), followUpDays: [7], channelFollowUp: false, authorized: false })).toEqual({ action: "none" });
  });
});

describe("withdraw", () => {
  it("before submission releases, after submission does not, never mid-submission", () => {
    expect(must(planWithdraw(memoryApp({ status: "ready" }))).some((e) => e.type === "release")).toBe(true);
    expect(must(planWithdraw(memoryApp({ status: "waiting", submittedAt: NOW.toISOString() }))).some((e) => e.type === "release")).toBe(false);
    expect(planWithdraw(memoryApp({ status: "submitting" }))).toEqual({ ok: false, error: "busy" });
    expect(planWithdraw(memoryApp({ status: "closed", submittedAt: NOW.toISOString() }))).toEqual({ ok: false, error: "invalid_transition" });
  });
});

describe("outcomes and milestones", () => {
  const submitted = () => memoryApp({ status: "waiting", submittedAt: NOW.toISOString(), followUpAt: new Date(NOW.getTime() + DAY).toISOString() });

  it("interview → progress, counts a reply and an interview once", () => {
    let app = applyEffects(submitted(), must(planOutcome(submitted(), "interview", { now: NOW })), NOW);
    expect(app.status).toBe("progress");
    expect(app.milestones).toEqual({ replies: 1, interviews: 1 });
    expect(app.followUpAt).toBeNull();
    // a second round: stays in progress, no second "reply"
    app = applyEffects(app, must(planOutcome(app, "interview", { now: NOW })), NOW);
    expect(app.status).toBe("progress");
    expect(app.milestones.replies).toBe(1);
    // the offer
    app = applyEffects(app, must(planOutcome(app, "offer", { note: "Start in January", now: NOW })), NOW);
    expect(app.milestones.offers).toBe(1);
    expect(app.outcome).toMatchObject({ result: "offer", note: "Start in January" });
  });

  it("rejected and no response end the application", () => {
    expect(applyEffects(submitted(), must(planOutcome(submitted(), "rejected", { now: NOW })), NOW).status).toBe("rejected");
    expect(applyEffects(submitted(), must(planOutcome(submitted(), "no_response", { now: NOW })), NOW).status).toBe("closed");
  });

  it("needs a submission first", () => {
    expect(planOutcome(memoryApp({ status: "ready" }), "interview", { now: NOW })).toEqual({ ok: false, error: "not_submitted" });
  });
});

describe("follow-ups per playbook", () => {
  const due = (o: Partial<MemoryApp> = {}) => memoryApp({ status: "submitted", channel: "CH4", submittedAt: NOW.toISOString(), followUpAt: NOW.toISOString(), followUpsSent: 0, ...o });
  const later = new Date(NOW.getTime() + 60_000);

  it("email without authorization: drafted, then waits for the person's tap", () => {
    const plan = planFollowUp(due(), { now: later, followUpDays: [7, 14], channelFollowUp: true, authorized: false });
    expect(plan.action).toBe("ask");
    if (plan.action !== "ask") return;
    const app = applyEffects(due(), plan.effects, later);
    expect(app.status).toBe("needs_you");
    expect(app.needsYouReason).toBe("followup_approval");
    const approved = planFollowUp(app, { now: later, followUpDays: [7, 14], channelFollowUp: true, authorized: false, approved: true });
    expect(approved.action).toBe("send");
    if (approved.action !== "send") return;
    const sent = applyEffects(app, approved.afterSent, later);
    expect(sent.status).toBe("waiting");
    expect(sent.followUpsSent).toBe(1);
    expect(new Date(sent.followUpAt!).getTime()).toBe(later.getTime() + 7 * DAY);
  });

  it("email with auto_followup: sent without a tap", () => {
    const plan = planFollowUp(due(), { now: later, followUpDays: [7, 14], channelFollowUp: true, authorized: true });
    expect(plan.action).toBe("send");
    if (plan.action !== "send") return;
    const app = applyEffects(applyEffects(due(), plan.before, later), plan.afterSent, later);
    expect(app.status).toBe("waiting");
    expect(app.followUpsSent).toBe(1);
  });

  it("other channels get a check-status nudge, then close as no response after the last one", () => {
    let app = due({ channel: "CH2" });
    const p1 = planFollowUp(app, { now: later, followUpDays: [7, 14], channelFollowUp: false, authorized: false });
    expect(p1.action).toBe("nudge");
    if (p1.action !== "nudge") return;
    app = applyEffects(app, p1.effects, later);
    expect(app.status).toBe("waiting");
    expect(app.notifications).toEqual(["check_status"]);
    // second nudge, then the quiet period, then closed
    app = { ...app, followUpAt: later.toISOString() };
    const p2 = planFollowUp(app, { now: later, followUpDays: [7, 14], channelFollowUp: false, authorized: false, closeAfterDays: 14 });
    expect(p2.action).toBe("nudge");
    if (p2.action !== "nudge") return;
    app = applyEffects(app, p2.effects, later);
    expect(app.followUpsSent).toBe(2);
    expect(new Date(app.followUpAt!).getTime()).toBe(later.getTime() + 14 * DAY);
    app = { ...app, followUpAt: later.toISOString() };
    const p3 = planFollowUp(app, { now: later, followUpDays: [7, 14], channelFollowUp: false, authorized: false });
    expect(p3.action).toBe("close");
    if (p3.action !== "close") return;
    app = applyEffects(app, p3.effects, later);
    expect(app.status).toBe("closed");
    expect(app.outcome?.result).toBe("no_response");
  });

  it("not before it is due", () => {
    expect(planFollowUp(due({ followUpAt: new Date(NOW.getTime() + DAY).toISOString() }), { now: NOW, followUpDays: [7], channelFollowUp: true, authorized: true })).toEqual({ action: "none" });
  });

  it("gap days are cumulative", () => {
    expect(followUpGapDays([7, 14, 30], 0)).toBe(7);
    expect(followUpGapDays([7, 14, 30], 2)).toBe(16);
    expect(followUpGapDays([7, 14, 30], 3)).toBeNull();
  });
});

describe("replies", () => {
  const waiting = () => memoryApp({ status: "waiting", channel: "CH4", submittedAt: NOW.toISOString(), followUpAt: NOW.toISOString() });

  it("a meeting request moves to progress and stops follow-ups", () => {
    const app = applyEffects(waiting(), must(planReply(waiting(), "meeting", { summary: "Wants a call next week", now: NOW })), NOW);
    expect(app.status).toBe("progress");
    expect(app.milestones).toEqual({ replies: 1, meetings: 1 });
    expect(app.followUpAt).toBeNull();
  });

  it("a request for more information needs the person", () => {
    const plan = must(planReply(waiting(), "needs_info", { now: NOW }));
    const app = applyEffects(waiting(), plan, NOW);
    expect(app.status).toBe("needs_you");
    expect(app.needsYouReason).toBe("organiser_request");
    // The drop-box notifies once with the reply itself; the engine adds no second (handoff) notice.
    expect(plan.filter((e) => e.type === "notify")).toEqual([]);
  });

  it("auto-replies change nothing", () => {
    const app = applyEffects(waiting(), must(planReply(waiting(), "auto_reply", { now: NOW })), NOW);
    expect(app.status).toBe("waiting");
    expect(app.followUpAt).toBe(NOW.toISOString());
  });

  it("a rejection ends it", () => {
    expect(applyEffects(waiting(), must(planReply(waiting(), "rejected", { now: NOW })), NOW).status).toBe("rejected");
  });
});

describe("board presentation", () => {
  it("plain-word status lines and next actions", () => {
    expect(statusLine({ status: "needs_info", openQuestions: 3 })).toEqual({ key: "status.needs_info", vars: { count: 3 } });
    expect(statusLine({ status: "needs_you", needsYouReason: "captcha" }).key).toBe("status.needs_you_captcha");
    expect(statusLine({ status: "needs_you", needsYouReason: "weird" }).key).toBe("status.needs_you_handoff");
    expect(statusLine({ status: "ready", practice: true }).key).toBe("status.ready_practice");
    expect(nextAction({ status: "ready" })).toBe("confirm");
    expect(nextAction({ status: "needs_you", needsYouReason: "no_gmail" })).toBe("send_email");
    expect(nextAction({ status: "needs_you", needsYouReason: "followup_approval", submittedAt: NOW })).toBe("approve_followup");
    expect(nextAction({ status: "waiting" })).toBe("record_outcome");
    expect(nextAction({ status: "closed" })).toBeNull();
    expect(needsYouKey(null)).toBe("handoff");
  });

  it("orders cards by urgency, deadline, recency", () => {
    const card = (status: MemoryApp["status"], deadline: string | null, updatedAt: string) => ({ status, updatedAt, opportunity: { deadline } });
    const list = [card("waiting", null, "2026-10-20"), card("ready", "2026-11-30", "2026-10-19"), card("needs_you", null, "2026-10-01"), card("ready", "2026-11-01", "2026-10-18")];
    expect(list.sort(cardOrder).map((c) => `${c.status}:${c.opportunity.deadline}`)).toEqual(["needs_you:null", "ready:2026-11-01", "ready:2026-11-30", "waiting:null"]);
    expect(daysUntil("2026-10-23T09:00:00Z", NOW)).toBe(2);
    expect(daysUntil(null)).toBeNull();
  });
});
