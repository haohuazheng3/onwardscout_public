import { afterEach, describe, expect, it } from "vitest";
import { loadHandler, registerModule } from "@/lib/jobs/handlers";
import { JOB_KINDS, clearRegistry, registerJob, registeredJob, registeredKinds } from "@/lib/jobs/registry";
import { BACKOFF_MAX_MS, PermanentJobError, backoffMs, canTransition, decide, isTerminal } from "@/lib/jobs/state";

const mid = () => 0.5; // no jitter

describe("job state machine", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "queued")).toBe(true); // retry / continue
    expect(canTransition("queued", "done")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(true); // operator retry
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
  });

  it("backs off exponentially with jitter, capped at an hour", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, mid))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(20, mid)).toBe(BACKOFF_MAX_MS);
    const lo = backoffMs(1, () => 0);
    const hi = backoffMs(1, () => 0.999);
    expect(lo).toBe(24_000);
    expect(hi).toBeGreaterThan(35_000);
  });

  it("done: returning nothing or {status: done}", () => {
    expect(decide({ result: undefined }, { attempts: 1, maxAttempts: 5 })).toEqual({ status: "done", result: null });
    expect(decide({ result: { status: "done", result: { matches: 12 } } }, { attempts: 1, maxAttempts: 5 })).toEqual({ status: "done", result: { matches: 12 } });
  });

  it("continue: back to the queue now, attempt refunded, state merged", () => {
    expect(decide({ result: { status: "continue", state: { cursor: 40 } } }, { attempts: 3, maxAttempts: 5 })).toEqual({ status: "queued", delayMs: 0, error: null, refundAttempt: true, state: { cursor: 40 } });
  });

  it("thrown errors retry with backoff, then fail when attempts are used up", () => {
    const err = new Error("Gmail 503");
    expect(decide({ error: err }, { attempts: 2, maxAttempts: 5 }, mid)).toEqual({ status: "queued", delayMs: 60_000, error: "Error: Gmail 503", refundAttempt: false, state: null });
    const last = decide({ error: err }, { attempts: 5, maxAttempts: 5 }, mid);
    expect(last.status).toBe("failed");
    expect(last.status === "failed" && last.error).toMatch(/gave up after 5 attempts/);
  });

  it("permanent errors and {status: fail} stop immediately", () => {
    expect(decide({ error: new PermanentJobError("Document deleted") }, { attempts: 1, maxAttempts: 5 })).toEqual({ status: "failed", error: "PermanentJobError: Document deleted" });
    expect(decide({ result: { status: "fail", error: "No such opportunity" } }, { attempts: 1, maxAttempts: 5 })).toEqual({ status: "failed", error: "No such opportunity" });
  });

  it("{status: retry} honours a requested delay", () => {
    expect(decide({ result: { status: "retry", error: "rate limited", delayMs: 90_000 } }, { attempts: 1, maxAttempts: 5 })).toMatchObject({ status: "queued", delayMs: 90_000, error: "rate limited" });
  });
});

describe("registry and handler loading", () => {
  afterEach(() => clearRegistry());

  it("lists the kinds other features use", () => {
    expect(JOB_KINDS).toEqual(["profile.parse", "profile.extract", "matches.refresh", "application.prepare", "application.submit", "application.followup", "sources.run", "digest.send", "notify.email"]);
  });

  it("registers handlers directly and from a module's jobHandlers export", async () => {
    registerJob("custom.one", async () => undefined, { leaseMs: 60_000 });
    registerModule({ jobHandlers: { "custom.two": async () => ({ status: "done" }), "custom.three": { handler: async () => undefined, maxAttempts: 2 } } });
    expect(registeredKinds()).toEqual(["custom.one", "custom.three", "custom.two"]);
    expect(registeredJob("custom.one")?.leaseMs).toBe(60_000);
    expect(registeredJob("custom.three")?.maxAttempts).toBe(2);
    expect(await loadHandler("custom.two")).not.toBeNull();
  });

  it("a kind without a registered handler or loader resolves to null (the runner retries it slowly)", async () => {
    expect(await loadHandler("nobody.handles.this")).toBeNull();
  });
});
