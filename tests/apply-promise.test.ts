import { describe, expect, it } from "vitest";
import { applyPromise } from "@/components/seo/apply-promise";

/* The listing's "apply for me" promise names only materials Onward Scout really drafts for that kind of programme. */
describe("applyPromise", () => {
  it("is specific per kind of programme", () => {
    for (const type of ["returnship", "accelerator", "job", "hackathon", "conference_cfp", "fellowship", "residency", "grant", "scholarship", "practice", "nonsense"]) {
      const line = applyPromise(type);
      console.log(type.padEnd(16), line);
      expect(line.length).toBeGreaterThan(40);
    }
    expect(applyPromise("returnship")).toContain("career-break note");
    expect(applyPromise("accelerator")).toContain("pitch deck");
  });
});
