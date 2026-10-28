import { describe, expect, it } from "vitest";
import { REPLANS, replansLeft } from "@/lib/profile/replans";

/* The first plan is free; a visitor re-plans once, an account adds two more (the sign-up hook). */

describe("re-plans", () => {
  it("gives a visitor one re-plan after the first plan, then none", () => {
    expect(replansLeft(0, false)).toBe(REPLANS.visitor);
    expect(replansLeft(1, false)).toBe(1);
    expect(replansLeft(2, false)).toBe(0);
    expect(replansLeft(5, false)).toBe(0);
  });

  it("adds two for an account, counting what the visitor already used", () => {
    expect(replansLeft(1, true)).toBe(3);
    // Used the free re-plan before signing up: the two from the account remain.
    expect(replansLeft(2, true)).toBe(2);
    expect(replansLeft(4, true)).toBe(0);
  });
});
