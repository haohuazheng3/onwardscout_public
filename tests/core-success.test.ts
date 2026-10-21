import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_DEFAULTS,
  PLACEHOLDER_KEYS,
  SUB_GOAL_IDS,
  SUCCESS_TEMPLATES,
  getSuccessTemplate,
  hasCjk,
  needsAn,
  placeholdersIn,
  render,
  renderSuccessDefinitions,
  renderSuccessTemplate,
  successTemplateSchema,
  successTemplatesFor,
  type SuccessParams,
} from "@/lib/core";

const SAMPLE: SuccessParams = {
  role: "Product Manager",
  field: "AI",
  salary: 150000,
  amount: 3000000,
  rate: 20000,
  currency: "USD",
  venue: "NeurIPS",
  event: "Web Summit",
  program: "Y Combinator",
  degree: "master's",
  school: "MIT",
  country: "Canada",
  city: "Shanghai",
  platform: "Upwork",
  cert: "the CFA Level I exam",
  test: "IELTS",
  level: "Staff Engineer",
  topic: "climate tech",
  outcome: "a working prototype",
  org: "Google",
  funder: "the NSF",
  count: 4,
};

describe("success-definition templates (plan §6)", () => {
  it("offers at least three valid templates for every sub-goal", () => {
    for (const id of SUB_GOAL_IDS) expect(successTemplatesFor(id).length, id).toBeGreaterThanOrEqual(3);
    expect(new Set(SUCCESS_TEMPLATES.map((t) => t.id)).size).toBe(SUCCESS_TEMPLATES.length);
    for (const t of SUCCESS_TEMPLATES) successTemplateSchema.parse(t);
    expect(getSuccessTemplate("G3.2-a")?.subGoal).toBe("G3.2");
    expect(getSuccessTemplate("nope")).toBeNull();
  });

  it("states an outcome with a deadline in both languages, with the same placeholders", () => {
    for (const t of SUCCESS_TEMPLATES) {
      const en = placeholdersIn(t.text.en).sort();
      const zh = placeholdersIn(t.text.zh).sort();
      expect(zh, t.id).toEqual(en);
      expect(en, t.id).toContain("months");
      for (const p of en) expect(PLACEHOLDER_KEYS as readonly string[], `${t.id} {${p}}`).toContain(p);
      if (en.includes("count")) expect(t.count, `${t.id} needs a count default`).toBeGreaterThan(0);
      expect(hasCjk(t.text.zh), t.id).toBe(true);
    }
    for (const [key, value] of Object.entries(PLACEHOLDER_DEFAULTS)) {
      if (value.en === "") expect(value.zh, key).toBe("");
      else expect(hasCjk(value.zh), key).toBe(true);
    }
  });

  it("renders every template cleanly with defaults and with real values", () => {
    for (const t of SUCCESS_TEMPLATES) {
      for (const locale of ["en", "zh"] as const) {
        for (const params of [{}, SAMPLE]) {
          const { text } = renderSuccessTemplate(t, params, locale);
          expect(text, `${t.id} ${locale}`).not.toMatch(/[{}]/);
          expect(text, `${t.id} ${locale}`).not.toMatch(/ {2}|\s[,，。]|\u0001/);
          expect(text, `${t.id} ${locale}`).not.toMatch(/\ba [aeio]/i);
          expect(text.length).toBeGreaterThan(8);
        }
      }
    }
  });

  it("renders the plan's examples", () => {
    const [seedZh] = renderSuccessDefinitions("G3.2", { amount: 3000000, currency: "CNY" }, "zh");
    expect(seedZh.text).toBe("12 个月内完成种子轮，金额不低于¥3,000,000");
    expect(seedZh.missing).toEqual([]);
    const [seedEn] = renderSuccessDefinitions("G3.2", { amount: 3000000, currency: "USD" }, "en");
    expect(seedEn.text).toBe("Close a seed round of at least $3,000,000 within 12 months");
    const paper = renderSuccessDefinitions("G4.1", { venue: "NeurIPS 或 ICLR", months: 12 }, "zh")[0];
    expect(paper.text).toBe("12 个月内在NeurIPS 或 ICLR发表一作论文");
    const design = renderSuccessDefinitions("G6.2", { rate: "2 万元" }, "zh")[0];
    expect(design.text).toBe("3 个月内接到每月2 万元以上的稳定项目");
  });

  it("fills qualifiers, reports what is missing and fixes the English article", () => {
    const pm = renderSuccessDefinitions("G1.1", { role: "Product Manager" }, "en");
    expect(pm[0].text).toBe("Get a full-time Product Manager offer within 6 months");
    expect(pm[1].text).toBe("Get a full-time Product Manager offer paying at least your target within 6 months");
    expect(pm[1].missing).toEqual(["salary"]);
    expect(renderSuccessDefinitions("G1.1", { role: "产品经理" }, "zh")[0].text).toBe("6 个月内拿到产品经理全职 offer");
    expect(renderSuccessDefinitions("G1.1", {}, "zh")[0].text).toBe("6 个月内拿到全职 offer");
    expect(renderSuccessDefinitions("G1.1", {}, "en")[2].text).toBe("Have 2 offers to compare within 4 months");

    expect(renderSuccessDefinitions("G1.2", {}, "en")[0].text).toBe("Land an internship within 3 months");
    expect(renderSuccessDefinitions("G1.2", { role: "Engineering" }, "en")[0].text).toBe("Land an Engineering internship within 3 months");
    expect(renderSuccessDefinitions("G1.2", { role: "UX" }, "en")[0].text).toBe("Land a UX internship within 3 months");
    expect(renderSuccessDefinitions("G5.1", { degree: "MBA" }, "en")[0].text).toBe("Get admitted to an MBA program in your field within 12 months");
    expect(renderSuccessDefinitions("G5.1", { degree: "master's", field: "Computer Science" }, "en")[0].text).toBe(
      "Get admitted to a master's program in Computer Science within 12 months",
    );
  });

  it("honours a months override and formats numbers per locale", () => {
    expect(renderSuccessDefinitions("G1.1", { months: 3 }, "zh")[0].text).toBe("3 个月内拿到全职 offer");
    expect(renderSuccessDefinitions("G1.1", { months: 3 }, "en")[0].horizonMonths).toBe(3);
    expect(renderSuccessDefinitions("G2.1", { amount: 20000 }, "en")[1].text).toBe("Get a raise of at least 20,000 within 6 months");
    expect(renderSuccessDefinitions("G2.1", { amount: 20000, currency: "XXZ" }, "en")[1].text).toContain("20,000");
  });

  it("exposes render() as the contract alias", () => {
    expect(render).toBe(renderSuccessDefinitions);
    expect(render("G12.1", { outcome: "a published app" }, "en")[0].text).toBe("Achieve a published app within 6 months");
  });

  it("chooses a/an like a person would", () => {
    expect(needsAn("internship")).toBe(true);
    expect(needsAn("offer")).toBe(true);
    expect(needsAn("university")).toBe(false);
    expect(needsAn("one-pager")).toBe(false);
    expect(needsAn("hour")).toBe(true);
    expect(needsAn("MBA")).toBe(true);
    expect(needsAn("UX")).toBe(false);
    expect(needsAn("SaaS")).toBe(false);
    expect(needsAn("")).toBe(false);
  });
});
