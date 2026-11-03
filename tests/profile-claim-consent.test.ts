import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A draft found in the browser becomes the signed-in person's without asking only when their
 * account has no profile yet (2026-11-02: a test draft was merged into the owner's real profile
 * when the owner signed in on the same browser).
 */

const state = vi.hoisted(() => ({
  profiles: {} as Record<string, { status: string; completeness: number; roles: unknown[]; identity: { name?: string | null } } | null>,
  files: [] as Array<{ filename: string | null }>,
}));

vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.files }) }) }) } }));
vi.mock("@/lib/profile/store", () => ({ getProfile: async (id: string) => state.profiles[id] ?? null }));

import { draftNeedsConsent, profileIsBlank } from "@/lib/profile/claim-consent";

const filled = { status: "draft", completeness: 60, roles: [{ code: "F5" }], identity: { name: "Alex Morgan" } };
const draft = { status: "draft", completeness: 70, roles: [{ code: "S2" }], identity: { name: "Priya Raman" } };
const blank = { status: "empty", completeness: 0, roles: [], identity: {} };

beforeEach(() => {
  state.profiles = {};
  state.files = [{ filename: "Priya_Raman_Resume.pdf" }];
});

describe("claiming a draft found in the browser", () => {
  it("a new account takes the draft without asking", async () => {
    state.profiles = { user_new: blank, anon_x: draft };
    expect(await draftNeedsConsent("anon_x", "user_new")).toBeNull();
    state.profiles = { anon_x: draft };
    expect(await draftNeedsConsent("anon_x", "user_none")).toBeNull();
  });

  it("an account with a profile is asked first, and told what the draft holds", async () => {
    state.profiles = { user_owner: filled, anon_x: draft };
    expect(await draftNeedsConsent("anon_x", "user_owner")).toEqual({ name: "Priya Raman", files: ["Priya_Raman_Resume.pdf"] });
  });

  it("an empty draft is nothing to ask about", async () => {
    state.profiles = { user_owner: filled, anon_x: blank };
    state.files = [];
    expect(await draftNeedsConsent("anon_x", "user_owner")).toBeNull();
  });

  it("knows a blank profile row", () => {
    expect(profileIsBlank(null)).toBe(true);
    expect(profileIsBlank(blank)).toBe(true);
    expect(profileIsBlank(filled)).toBe(false);
  });
});
