import { describe, expect, it, vi } from "vitest";

// The pure builder under test never touches the database or the mail worker.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ appState: {}, errorGroups: {} }));
vi.mock("@/lib/errors", () => ({ HEALTH_SOURCES: ["server", "edge", "worker", "cron"] }));
vi.mock("@/lib/notify", () => ({ notifyOwner: async () => true }));

import { buildErrorDigest, type DigestItem } from "@/lib/error-digest";

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  name: "Error",
  message: "Failed query: select 1",
  route: "/api/cron/jobs",
  source: "cron",
  count: 3,
  firstSeen: new Date("2026-11-04T19:34:00Z"),
  lastSeen: new Date("2026-11-06T08:00:00Z"),
  ...over,
});

describe("daily error digest", () => {
  it("sends nothing when no severe error is open, whatever else is open", () => {
    expect(buildErrorDigest({ day: "2026-11-07", severeOpen: 0, otherOpen: 25, top: [], adminUrl: "https://onwardscout.com/admin/errors" })).toBeNull();
  });

  it("summarises the count, the top groups and links the admin page", () => {
    const d = buildErrorDigest({ day: "2026-11-07", severeOpen: 3, otherOpen: 25, top: [item(), item({ name: "TypeError", route: null, source: "server", count: 1 })], adminUrl: "https://onwardscout.com/admin/errors" });
    expect(d?.subject).toBe("Daily error digest: 3 unresolved server errors (2026-11-07)");
    expect(d?.text).toContain("1. Error: Failed query: select 1");
    expect(d?.text).toContain("cron · /api/cron/jobs · 3× · first 2026-11-04 19:34 UTC · last 2026-11-06 08:00 UTC");
    expect(d?.text).toContain("2. TypeError");
    expect(d?.text).toContain("server · - · 1×");
    expect(d?.text).toContain("…and 1 more.");
    expect(d?.text).toContain("Also open: 25 lower-priority groups");
    expect(d?.text).toContain("Review and resolve: https://onwardscout.com/admin/errors");
    expect(d?.text).toContain("/api/health stays 200");
  });

  it("uses the singular and trims long messages", () => {
    const d = buildErrorDigest({ day: "2026-11-07", severeOpen: 1, otherOpen: 0, top: [item({ message: `x\n${"y".repeat(400)}` })], adminUrl: "u" });
    expect(d?.subject).toBe("Daily error digest: 1 unresolved server error (2026-11-07)");
    expect(d?.text).not.toContain("Also open");
    expect(d?.text).toMatch(/y…\n/);
  });
});
