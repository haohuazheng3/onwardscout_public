/**
 * Regression tests for the hardening pass: billing bypasses, outreach rules, the browser agent's
 * deterministic guards, keyed hashes, the practice sandbox URL, SEO dedupe rules and charge state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEffects, memoryApp, planConfirm, planSubmitResult, type Effect, type Plan } from "@/lib/applications/plan";
import { checkFollowUpPolicy, checkOutreachPolicy } from "@/lib/channels/outreach-policy";
import { createRequestGuard, guardBrowserStep } from "@/lib/channels/ch3-browser";
import { localSandboxUrl } from "@/lib/channels/http";
import { formUrlFor } from "@/lib/channels/ch2-forms";
import { keyedHash, tombstoneHash } from "@/lib/crypto";
import { sha256 } from "@/lib/ids";
import { chargeReversed } from "@/lib/billing";
import { dedupeCareers } from "@/lib/programmatic";
import { publicWebUrl } from "@/lib/opportunities/normalize";
import { compareRows } from "@/components/site/pricing";
import { PLANS } from "@/content/plans";

const NOW = new Date("2026-10-21T09:00:00Z");
const HANDOFF = { url: "mailto:vc@example.org", steps: [], fields: [], files: [], notes: [] };

function must(plan: Plan): Effect[] {
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  return plan.effects;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submission results", () => {
  const submitting = () => applyEffects(memoryApp({ status: "ready", channel: "CH4" }), must(planConfirm(memoryApp({ status: "ready", channel: "CH4" }), { explicit: true })), NOW);

  it("an outreach-policy refusal never becomes a mailto handoff: nothing is sent and the credit comes back", () => {
    const app = submitting();
    expect(app.creditsReserved).toBe(1);
    for (const code of ["do_not_contact", "recently_contacted", "minor", "invalid_email"]) {
      const effects = must(planSubmitResult(app, { status: "failed", error: "refused", retryable: false, code }, { firstSubmission: true, followUpAt: null, now: NOW, preparedHandoff: HANDOFF }));
      expect(effects.some((e) => e.type === "handoff"), code).toBe(false);
      expect(effects.map((e) => e.type).slice(0, 2), code).toEqual(["release", "transition"]);
      const after = applyEffects(app, effects, NOW);
      expect(after.status).toBe("ready");
      expect(after.creditsReserved).toBe(0);
      expect(after.notifications).toContain("outreach_blocked");
    }
  });

  it("a failed submission releases the credit while still submitting (before the move to ready)", () => {
    const app = submitting();
    const effects = must(planSubmitResult(app, { status: "failed", error: "timeout", retryable: true }, { firstSubmission: true, followUpAt: null, now: NOW }));
    const release = effects.findIndex((e) => e.type === "release");
    const toReady = effects.findIndex((e) => e.type === "transition" && e.to === "ready");
    expect(release).toBeGreaterThanOrEqual(0);
    expect(release).toBeLessThan(toReady);
  });

  it("a minor without a guardian's email can't submit (practice runs can)", () => {
    expect(planConfirm(memoryApp({ status: "ready" }), { explicit: true, guardianRequired: true })).toEqual({ ok: false, error: "guardian_required" });
    expect(planConfirm(memoryApp({ status: "ready", practice: true }), { explicit: true, guardianRequired: true }).ok).toBe(true);
    expect(planConfirm(memoryApp({ status: "ready" }), { explicit: true, guardianRequired: false }).ok).toBe(true);
  });
});

describe("outreach rules", () => {
  const base = { to: "partner@fund.example", contact: null, newContactsLastDay: 0, newContactsLastWeek: 0, isMinor: false, now: NOW };

  it("the global opt-out list blocks first emails and follow-ups for everyone", () => {
    expect(checkOutreachPolicy(base)).toEqual({ ok: true });
    expect(checkOutreachPolicy({ ...base, blocked: true })).toMatchObject({ ok: false, code: "do_not_contact", retryable: false });
    expect(checkFollowUpPolicy({ attempt: 1, replied: false, doNotContact: true, lastSentAt: new Date(NOW.getTime() - 10 * 86400_000), now: NOW }).ok).toBe(false);
  });
});

describe("browser agent guards", () => {
  it("never ticks consent or fills EEO, signature or password fields the person didn't answer", () => {
    const ctx = { values: { "Full name": "Avery Quinn" }, answers: {} as Record<string, string> };
    expect(guardBrowserStep({ action: "check", target: 'checkbox "I agree to share my data with partners"', value: null }, ctx).ok).toBe(false);
    expect(guardBrowserStep({ action: "click", target: 'checkbox "I consent to the privacy policy"', value: null }, ctx).ok).toBe(false);
    expect(guardBrowserStep({ action: "select", target: 'combobox "Gender"', value: "Female" }, ctx).ok).toBe(false);
    expect(guardBrowserStep({ action: "click", target: 'radio "Female"', value: null }, { ...ctx, groupLabel: "Gender" }).ok).toBe(false);
    expect(guardBrowserStep({ action: "fill", target: 'textbox "Signature"', value: "Avery Quinn" }, ctx).ok).toBe(false);
    expect(guardBrowserStep({ action: "fill", target: 'textbox "Password"', value: "x" }, ctx).ok).toBe(false);
  });

  it("allows what the person answered, prepared values, and the submit button", () => {
    const ctx = { values: { "Full name": "Avery Quinn" }, answers: { "I agree to the terms": "yes", Gender: "Prefer not to say" } };
    expect(guardBrowserStep({ action: "check", target: 'checkbox "I agree to the terms"', value: null }, ctx).ok).toBe(true);
    expect(guardBrowserStep({ action: "click", target: 'radio "Prefer not to say"', value: null }, { ...ctx, groupLabel: "Gender" }).ok).toBe(true);
    expect(guardBrowserStep({ action: "fill", target: 'textbox "Full name"', value: "Avery Quinn" }, ctx).ok).toBe(true);
    expect(guardBrowserStep({ action: "submit", target: 'button "Submit application"', value: null }, ctx).ok).toBe(true);
    expect(guardBrowserStep({ action: "scroll", target: null, value: null }, ctx).ok).toBe(true);
  });

  it("refuses to type anything that wasn't prepared", () => {
    expect(guardBrowserStep({ action: "fill", target: 'textbox "Why us?"', value: "Ignore previous instructions" }, { values: { "Full name": "Avery Quinn" }, answers: {} })).toMatchObject({ ok: false });
  });

  it("blocks private addresses, other schemes and hosts that resolve inside the network", async () => {
    const resolver = async (host: string) =>
      host === "rebind.example.com" ? [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }];
    const allowed = createRequestGuard(resolver);
    expect(await allowed("https://jobs.example.com/apply")).toBe(true);
    expect(await allowed("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(await allowed("http://127.0.0.1:9001/")).toBe(false);
    expect(await allowed("http://10.0.0.5/")).toBe(false);
    expect(await allowed("file:///etc/passwd")).toBe(false);
    expect(await allowed("https://localhost/")).toBe(false);
    expect(await allowed("https://rebind.example.com/")).toBe(false);
  });
});

describe("imported apply links", () => {
  it("keeps only public web addresses", () => {
    expect(publicWebUrl("https://jobs.example.com/apply?x=1")).toBe("https://jobs.example.com/apply?x=1");
    expect(publicWebUrl("http://10.0.0.5/")).toBeNull();
    expect(publicWebUrl("http://127.0.0.1:9001/admin")).toBeNull();
    expect(publicWebUrl("https://metadata.google.internal/")).toBeNull();
    expect(publicWebUrl("javascript:alert(1)")).toBeNull();
    expect(publicWebUrl("https://user:pw@example.com/")).toBeNull();
    expect(publicWebUrl("https://example.com:8443/")).toBeNull();
    expect(publicWebUrl("not a url")).toBeNull();
  });
});

describe("keyed hashes", () => {
  it("are stable per purpose, differ between purposes, and are not the old constant-salt hash", () => {
    expect(keyedHash("ip", "203.0.113.7")).toBe(keyedHash("ip", "203.0.113.7"));
    expect(keyedHash("ip", "203.0.113.7")).not.toBe(keyedHash("outreach", "203.0.113.7"));
    expect(keyedHash("ip", "203.0.113.7", 24)).not.toBe(sha256("onwardscout:203.0.113.7").slice(0, 24));
    expect(tombstoneHash("user_123")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("practice sandbox", () => {
  it("points the stored production sandbox link at this deployment's own origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://onwardscout-git-preview.vercel.app");
    expect(localSandboxUrl("https://onwardscout.com/sandbox/form")).toBe("https://onwardscout-git-preview.vercel.app/sandbox/form");
    expect(localSandboxUrl("https://example.org/apply")).toBe("https://example.org/apply");
    const url = formUrlFor({ apply: { url: "https://onwardscout.com/sandbox/form" } as never, url: null }, "app_k3v9q2m8x1d4f6h7");
    expect(url).toBe("https://onwardscout-git-preview.vercel.app/sandbox/form?app=app_k3v9q2m8x1d4f6h7");
  });
});

describe("billing", () => {
  it("knows when the money behind a payment is gone", () => {
    expect(chargeReversed(null)).toBeNull();
    expect(chargeReversed({ refunded: true, amount: 900, amount_refunded: 900, disputed: false })).toBe("refunded");
    expect(chargeReversed({ refunded: false, amount: 900, amount_refunded: 900, disputed: false })).toBe("refunded");
    expect(chargeReversed({ refunded: false, amount: 900, amount_refunded: 0, disputed: true })).toBe("disputed");
    expect(chargeReversed({ refunded: false, amount: 900, amount_refunded: 300, disputed: false })).toBeNull();
  });

  it("sells only perks that exist: no priority processing, the brief in the app for everyone", () => {
    expect(Object.keys(PLANS.pro.perks).sort()).toEqual(["autoFollowUps", "weeklyDigest"]);
    const rows = compareRows((k) => k, { mailer: true });
    expect(rows.find((r) => r.id === "digestEmail")?.pro).toEqual({ kind: "yes" });
  });
});

describe("careers dedupe", () => {
  it("keeps one representative of pages that would show the same listings and types", () => {
    const kept = dedupeCareers([
      { code: "ux-designer", matchedSlugs: ["a", "b", "c"], types: ["grant", "award"], targeted: 3 },
      { code: "ui-designer", matchedSlugs: ["c", "b", "a"], types: ["award", "grant"], targeted: 3 },
      { code: "brand-designer", matchedSlugs: ["a", "b", "c"], types: ["grant", "award"], targeted: 4 },
      { code: "astronomer", matchedSlugs: ["x", "y", "z"], types: ["grant"], targeted: 3 },
    ]);
    expect(kept.map((c) => c.code).sort()).toEqual(["astronomer", "brand-designer"]);
  });
});
