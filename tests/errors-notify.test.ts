import { beforeEach, describe, expect, it, vi } from "vitest";

/* captureError's owner email: once when a severe group first appears, never again for that group. */
const state = vi.hoisted(() => ({ count: 0, notifiedAt: null as Date | null, sent: [] as string[] }));

vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => p }));
vi.mock("@/lib/db/schema", () => ({ errorGroups: {} }));
vi.mock("@/lib/notify", () => ({
  notifyOwner: async (m: { subject: string }) => {
    state.sent.push(m.subject);
    return true;
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            state.count++;
            return [{ id: "err_test", count: state.count, notifiedAt: state.notifiedAt, severity: "error" }];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          // The atomic claim: only the first caller finds notified_at empty.
          returning: async () => {
            if (state.notifiedAt) return [];
            state.notifiedAt = new Date();
            return [{ id: "err_test" }];
          },
        }),
      }),
    }),
  },
}));

import { captureError } from "@/lib/errors";

beforeEach(() => {
  state.count = 0;
  state.notifiedAt = null;
  state.sent.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("owner email from the error inbox", () => {
  it("emails once for a new severe group and never again, even days later", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-06T00:00:00Z") });
    try {
      await captureError(new Error("boom"), { route: "/api/x", source: "server" });
      for (let h = 1; h <= 72; h += 7) {
        vi.setSystemTime(Date.parse("2026-11-06T00:00:00Z") + h * 3600_000);
        await captureError(new Error("boom"), { route: "/api/x", source: "server" });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(state.sent).toEqual(["Error: Error on /api/x"]);
  });

  it("never emails for browser reports", async () => {
    await captureError(new Error("boom"), { route: "/x", source: "client" });
    expect(state.sent).toHaveLength(0);
  });

  it("sends once when two first occurrences race", async () => {
    await Promise.all([captureError(new Error("boom"), { route: "/api/y" }), captureError(new Error("boom"), { route: "/api/y" })]);
    expect(state.sent).toHaveLength(1);
  });
});
