import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDates, localNormalizeOpportunity } from "@/lib/llm/local/opportunity";
import { NormalizedOpportunity } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("normalizeOpportunity (local)", () => {
  it("reads a job posting through its JSON-LD and page text", () => {
    const o = localNormalizeOpportunity({ url: "https://careers.example.com/jobs/42", html: fx("job-posting.html"), now: "2026-10-21" });
    NormalizedOpportunity.parse(o);
    expect(o).toMatchObject({ type: "job", name: "Senior Product Designer", orgName: "Juniper Clinics", deadline: "2026-11-30", rolling: false, expired: false });
    expect(o.geo).toMatchObject({ countries: ["US"], remote: "hybrid" });
    expect(o.geo.cities).toContain("Austin");
    expect(o.benefits.money).toMatchObject({ min: 140000, max: 170000, currency: "USD" });
    expect(o.eligibility.minYears).toBe(5);
    expect(o.requiredMaterials).toEqual(expect.arrayContaining(["resume", "portfolio", "cover_letter"]));
    expect(o.apply).toMatchObject({ channel: "CH1", platform: "greenhouse", url: "https://boards.greenhouse.io/juniperclinics/jobs/4012345" });
    expect(o.tags).toEqual(expect.arrayContaining(["figma", "design systems"]));
  });

  it("reads a program page from text: terms, eligibility, materials, deadline", () => {
    const o = localNormalizeOpportunity({ url: "https://lanternfly.example.org/apply", text: fx("accelerator.txt"), now: "2026-10-21" });
    NormalizedOpportunity.parse(o);
    expect(o.type).toBe("accelerator");
    expect(o.deadline).toBe("2027-03-15");
    expect(o.geo.worldwide).toBe(true);
    expect(o.eligibility.identities).toContain("F");
    expect(o.eligibility.stages).toEqual(expect.arrayContaining(["pre_seed", "seed"]));
    expect(o.cost).toMatchObject({ free: true, equityPercent: 7 });
    expect(o.benefits.money?.max).toBe(150000);
    expect(o.benefits.perks).toEqual(expect.arrayContaining(["mentorship", "demo day"]));
    expect(o.requiredMaterials).toEqual(expect.arrayContaining(["pitch_deck", "demo_video"]));
    expect(o.cycle).toBeNull();
  });

  it("marks closed or past programs as expired and keeps unknowns null", () => {
    const past = localNormalizeOpportunity({ url: "https://x.example.org", text: "Spring Grant 2026\nApplications close January 10, 2026.", now: "2026-10-21" });
    expect(past.expired).toBe(true);
    const closed = localNormalizeOpportunity({ url: "https://y.example.org", text: "Design Fellowship\nApplications are now closed. Thank you to everyone who applied.", now: "2026-10-21" });
    expect(closed.expired).toBe(true);
    const bare = localNormalizeOpportunity({ url: "https://z.example.org", text: "Something we do", now: "2026-10-21" });
    expect(bare.deadline).toBeNull();
    expect(bare.missing).toEqual(expect.arrayContaining(["deadline", "orgName"]));
  });

  it("finds dates in English and Chinese formats", () => {
    expect(findDates("Due 15 March 2027 or March 16, 2027; 2027-03-17; 2027年3月18日; 03/19/2027").map((d) => d.iso)).toEqual(["2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19"]);
  });

  it("reads a Chinese competition notice", () => {
    const o = localNormalizeOpportunity({ url: "https://cy.example.cn/notice", text: "第五届青年创新创业大赛报名通知\n面向全国在读学生与初创团队\n报名截止时间：2026年12月20日\n请提交商业计划书和路演视频。\n免费报名", now: "2026-10-21" });
    expect(o).toMatchObject({ type: "startup_competition", deadline: "2026-12-20", languages: ["zh"] });
    expect(o.requiredMaterials).toEqual(expect.arrayContaining(["business_plan", "demo_video"]));
    expect(o.cost.free).toBe(true);
  });
});
