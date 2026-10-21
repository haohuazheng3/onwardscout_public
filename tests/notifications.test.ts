import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import settingsMessages from "../messages/en/settings.json";

/*
 * Notifications (P6): the pure helpers (sanitising, link safety, email gating, the email text,
 * unsubscribe tokens) and the never-throw contract of notify()/recordEvent(), with the database,
 * the queue and the error inbox replaced by in-memory fakes. No network, no database.
 */

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<{ kind: string; payload: unknown; opts: Record<string, unknown> }>,
  captured: [] as unknown[],
  failInsert: false,
}));

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/errors", () => ({ captureError: async (err: unknown) => void state.captured.push(err) }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (state.failInsert) throw new Error("database unavailable");
        state.inserted.push(row);
      },
    }),
  },
}));
vi.mock("@/lib/jobs/queue", () => ({
  enqueue: async (kind: string, payload: unknown, opts: Record<string, unknown>) => {
    state.enqueued.push({ kind, payload, opts });
    return { id: "job_test0000000000", created: true, status: "queued" };
  },
}));
vi.mock("@/lib/jobs/runner", () => ({ runJobNow: async () => null }));

import {
  absoluteAppUrl,
  BODY_MAX,
  createNotification,
  emailAllowed,
  isNotificationKind,
  NOTIFICATION_KINDS,
  notificationEmail,
  notify,
  recordEvent,
  safeHref,
  sanitizeNotification,
  TITLE_MAX,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/notifications";

beforeEach(() => {
  state.inserted.length = 0;
  state.enqueued.length = 0;
  state.captured.length = 0;
  state.failInsert = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("notification kinds", () => {
  it("are exactly the contract's kinds", () => {
    expect([...NOTIFICATION_KINDS].sort()).toEqual(["billing", "digest", "needs_you", "new_matches", "progress", "reply", "submitted", "system"]);
    expect(isNotificationKind("digest")).toBe(true);
    expect(isNotificationKind("spam")).toBe(false);
  });
});

describe("safeHref", () => {
  it("keeps same-site paths", () => {
    expect(safeHref("/app/applications/app_123")).toBe("/app/applications/app_123");
    expect(safeHref(" /app#notifications ")).toBe("/app#notifications");
  });
  it("refuses other origins and schemes", () => {
    expect(safeHref("https://evil.example/app")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/app\nSet-Cookie: x")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});

describe("sanitizeNotification", () => {
  it("collapses whitespace and caps sizes", () => {
    const out = sanitizeNotification({ title: `  Your   application\tmoved  ${"x".repeat(400)}`, body: `line one\r\n\r\n\r\n\r\nline two ${"y".repeat(5000)}` });
    expect(out.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(out.title.startsWith("Your application moved")).toBe(true);
    expect(out.title.endsWith("…")).toBe(true);
    expect(out.body?.length).toBeLessThanOrEqual(BODY_MAX);
    expect(out.body).toContain("line one\n\nline two");
  });
  it("never stores an empty title and drops empty bodies", () => {
    expect(sanitizeNotification({ title: "   ", body: "   " })).toEqual({ title: "Onward Scout", body: null, href: null });
  });
});

describe("emailAllowed", () => {
  const prefs = { emailUpdates: true, emailDigest: true };
  const pro = { autoFollowUps: true, weeklyDigest: true, priority: true };
  const free = { autoFollowUps: false, weeklyDigest: false, priority: false };
  it("sends updates by the updates preference", () => {
    expect(emailAllowed("needs_you", prefs, free)).toBe(true);
    expect(emailAllowed("needs_you", { ...prefs, emailUpdates: false }, pro)).toBe(false);
  });
  it("sends the weekly brief by email only with the preference AND a plan that includes it", () => {
    expect(emailAllowed("digest", prefs, pro)).toBe(true);
    expect(emailAllowed("digest", prefs, free)).toBe(false);
    expect(emailAllowed("digest", { ...prefs, emailDigest: false }, pro)).toBe(false);
  });
});

describe("absoluteAppUrl", () => {
  it("localizes paths and keeps query and hash", () => {
    expect(absoluteAppUrl("/app", "en", "https://onwardscout.com")).toBe("https://onwardscout.com/app");
    expect(absoluteAppUrl("/app", "zh", "https://onwardscout.com")).toBe("https://onwardscout.com/zh/app");
    expect(absoluteAppUrl("/app/settings?x=1#notifications", "zh", "https://onwardscout.com")).toBe("https://onwardscout.com/zh/app/settings?x=1#notifications");
  });
});

describe("notificationEmail", () => {
  const t = createTranslator({ locale: "en", messages: { settings: settingsMessages }, namespace: "settings.email" }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;

  it("builds a plain-text email with the link, the reason and the preferences link", () => {
    const mail = notificationEmail({ title: "Stripe internship needs you", body: "One question is waiting.", href: "/app/applications/app_1" }, "en", t, "https://onwardscout.com");
    expect(mail.subject).toBe("Stripe internship needs you");
    expect(mail.text).toContain("One question is waiting.");
    expect(mail.text).toContain("https://onwardscout.com/app/applications/app_1");
    expect(mail.text).toContain("https://onwardscout.com/app/settings#notifications");
    expect(mail.text).toContain("Onward Scout account");
  });
  it("falls back to the board when there is no link", () => {
    const mail = notificationEmail({ title: "Hello", body: null, href: null }, "zh", t, "https://onwardscout.com");
    expect(mail.text).toContain("https://onwardscout.com/zh/app");
  });
});

describe("unsubscribe tokens", () => {
  const secret = ["unit", "test", "secret"].join("-");
  it("verify for the same user and scope only", () => {
    const token = unsubscribeToken("user_abc", "digest", secret);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(verifyUnsubscribeToken("user_abc", "digest", token!, secret)).toBe(true);
    expect(verifyUnsubscribeToken("user_abc", "updates", token!, secret)).toBe(false);
    expect(verifyUnsubscribeToken("user_xyz", "digest", token!, secret)).toBe(false);
    expect(verifyUnsubscribeToken("user_abc", "digest", `${token!.slice(0, -1)}A`, secret)).toBe(token!.endsWith("A"));
  });
  it("are unavailable without a secret", () => {
    expect(unsubscribeToken("user_abc", "digest", null)).toBeNull();
    expect(verifyUnsubscribeToken("user_abc", "digest", "anything-at-all-123456", null)).toBe(false);
  });
});

describe("notify / createNotification", () => {
  it("stores one sanitised in-app row", async () => {
    await notify({ userId: "user_1", kind: "submitted", title: " Submitted:  Acme ", body: "Reference SBX-1", href: "https://evil.example" });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({ userId: "user_1", kind: "submitted", title: "Submitted: Acme", body: "Reference SBX-1", href: null });
    expect(String(state.inserted[0].id)).toMatch(/^ntf_/);
    expect(state.enqueued).toHaveLength(0);
  });

  it("queues an email job only when asked and product email is configured", async () => {
    await createNotification({ userId: "user_1", kind: "needs_you", title: "A", email: true });
    expect(state.enqueued).toHaveLength(0); // mailer not configured

    vi.stubEnv("RESEND_API_KEY", "k".repeat(16));
    vi.stubEnv("MAIL_FROM", "Onward Scout <hello@onwardscout.com>");
    const id = await createNotification({ userId: "user_1", kind: "needs_you", title: "B", email: true });
    expect(id).toMatch(/^ntf_/);
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]).toMatchObject({ kind: "notify.email", payload: { notificationId: id }, opts: { userId: "user_1", dedupeKey: `notify.email:${id}` } });
  });

  it("never throws: a database failure is captured and swallowed for the caller", async () => {
    state.failInsert = true;
    await expect(notify({ userId: "user_1", kind: "system", title: "x" })).resolves.toBeUndefined();
    await expect(createNotification({ userId: "user_1", kind: "system", title: "x" })).resolves.toBeNull();
    await expect(recordEvent({ userId: "user_1", kind: "application.submitted" })).resolves.toBeUndefined();
    expect(state.captured.length).toBe(3);
  });

  it("recordEvent writes the event row", async () => {
    await recordEvent({ userId: "user_2", kind: "application.submitted", applicationId: "app_1", data: { channel: "CH2" } });
    expect(state.inserted[0]).toMatchObject({ userId: "user_2", kind: "application.submitted", applicationId: "app_1", opportunityId: null, data: { channel: "CH2" } });
    expect(String(state.inserted[0].id)).toMatch(/^evt_/);
  });
});
