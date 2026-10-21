import { describe, expect, it } from "vitest";
import {
  FUNCTION_IDS,
  OCCUPATIONS,
  TOP_LEVEL_INDUSTRIES,
  getOccupation,
  hasCjk,
  isIdentityCode,
  isIndustryCode,
  isOccupationCode,
  mapOccupation,
  normalizeText,
  occupationDefSchema,
  occupationLabel,
  topLevelIndustry,
} from "@/lib/core";

const top = (text: string) => mapOccupation(text)[0];

describe("occupation data", () => {
  it("has at least 300 occupations with unique kebab-case codes", () => {
    expect(OCCUPATIONS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(OCCUPATIONS.map((o) => o.code)).size).toBe(OCCUPATIONS.length);
  });

  it("validates every row: bilingual label, real industry, real function, valid identity hint", () => {
    for (const o of OCCUPATIONS) {
      occupationDefSchema.parse(o);
      expect(o.label.en.trim(), o.code).not.toBe("");
      expect(hasCjk(o.label.zh), `${o.code} zh label: ${o.label.zh}`).toBe(true);
      expect(isIndustryCode(o.industry), `${o.code} industry ${o.industry}`).toBe(true);
      expect(FUNCTION_IDS as readonly string[]).toContain(o.function);
      if (o.identity) expect(isIdentityCode(o.identity), o.code).toBe(true);
      const normalized = o.aliases.map(normalizeText);
      expect(new Set(normalized).size, `${o.code} has duplicate aliases`).toBe(normalized.length);
    }
  });

  it("covers every top-level industry and every function", () => {
    const tops = new Set(OCCUPATIONS.map((o) => topLevelIndustry(o.industry)));
    expect(TOP_LEVEL_INDUSTRIES.filter((t) => !tops.has(t.code)).map((t) => t.code)).toEqual([]);
    const fns = new Set(OCCUPATIONS.map((o) => o.function));
    expect(FUNCTION_IDS.filter((f) => !fns.has(f))).toEqual([]);
  });

  it("covers trades, healthcare, education, public sector, creative, research and startups", () => {
    for (const code of [
      "electrician", "welder", "registered-nurse", "physician", "primary-school-teacher", "civil-servant", "police-officer",
      "illustrator", "musician", "postdoctoral-researcher", "professor", "founder", "indie-developer", "small-business-owner",
      "delivery-driver", "chef", "social-worker", "lawyer", "accountant", "architect",
    ]) {
      expect(isOccupationCode(code), code).toBe(true);
    }
    expect(getOccupation("registered-nurse").identity).toBe("P1");
    expect(occupationLabel("product-manager", "zh")).toBe("产品经理");
    expect(() => getOccupation("not-a-job")).toThrow();
  });

  it("maps every occupation's own label back to it with a perfect score", () => {
    for (const o of OCCUPATIONS) {
      for (const label of [o.label.en, o.label.zh]) {
        const results = mapOccupation(label, { limit: 10 });
        const best = results.filter((r) => r.score === results[0]?.score);
        expect(results[0]?.score, `${o.code}: ${label}`).toBe(1);
        expect(best.map((r) => r.code), `${o.code}: ${label}`).toContain(o.code);
      }
    }
  });

  it("has no alias shared by two occupations", () => {
    const owners = new Map<string, Set<string>>();
    for (const o of OCCUPATIONS) {
      for (const phrase of [o.label.en, o.label.zh, ...o.aliases]) {
        const key = normalizeText(phrase);
        owners.set(key, (owners.get(key) ?? new Set()).add(o.code));
      }
    }
    const shared = [...owners].filter(([, set]) => set.size > 1).map(([k, set]) => `${k}: ${[...set].join(",")}`);
    expect(shared).toEqual([]);
  });
});

describe("mapOccupation", () => {
  it("maps English titles, ignoring seniority and levels", () => {
    expect(top("Senior Software Engineer")).toEqual({ code: "software-engineer", score: 1 });
    expect(top("Software Engineer II")?.code).toBe("software-engineer");
    expect(top("Registered Nurse")).toEqual({ code: "registered-nurse", score: 1 });
    expect(top("Staff Nurse")?.code).toBe("registered-nurse");
    expect(top("SWE Intern")?.code).toBe("software-engineer");
    expect(top("Head of Product")?.code).toBe("product-manager");
    expect(top("Attorney")?.code).toBe("lawyer");
    expect(top("Associate Professor")?.code).toBe("associate-professor");
    expect(top("Assistant Professor of Physics")?.code).toBe("assistant-professor");
    expect(top("Postdoctoral Fellow in Neuroscience")?.code).toBe("postdoctoral-researcher");
    expect(top("R&D Engineer")?.code).toBe("research-engineer");
    expect(top("Kindergarten teacher")?.code).toBe("preschool-teacher");
    expect(top("Uber driver")?.code).toBe("bus-driver");
  });

  it("maps Chinese titles, ignoring 高级/资深/实习", () => {
    expect(top("产品经理")).toEqual({ code: "product-manager", score: 1 });
    expect(top("博士后研究员")).toEqual({ code: "postdoctoral-researcher", score: 1 });
    expect(top("资深前端开发")?.code).toBe("frontend-engineer");
    expect(top("算法工程师")?.code).toBe("machine-learning-engineer");
    expect(top("注册会计师")?.code).toBe("accountant");
    expect(top("中学数学老师")?.code).toBe("secondary-school-teacher");
    expect(top("小学语文老师")?.code).toBe("primary-school-teacher");
    expect(top("外卖骑手")?.code).toBe("delivery-driver");
    expect(top("律师")?.code).toBe("lawyer");
    expect(top("大模型应用开发")?.code).toBe("llm-application-engineer");
    expect(top("实习生 数据分析")?.code).toBe("data-analyst");
  });

  it("maps mixed-language and decorated titles", () => {
    expect(top("高级Java开发工程师")?.code).toBe("backend-engineer");
    expect(top("AI产品经理")?.code).toBe("product-manager");
    expect(top("Software Engineer, Backend | Acme")?.code).toBe("software-engineer");
    expect(top("Founder & CEO at Acme")?.code).toBe("founder");
    expect(top("UX Researcher")?.code).toBe("ux-researcher");
  });

  it("returns sorted, bounded, deterministic results and nothing for noise", () => {
    const r = mapOccupation("Product Marketing Manager", { limit: 3 });
    expect(r).toHaveLength(3);
    expect(r[0].code).toBe("product-marketing-manager");
    for (let i = 1; i < r.length; i++) expect(r[i].score).toBeLessThanOrEqual(r[i - 1].score);
    expect(mapOccupation("Product Marketing Manager", { limit: 3 })).toEqual(r);
    expect(mapOccupation("")).toEqual([]);
    expect(mapOccupation("   ")).toEqual([]);
    expect(mapOccupation("qwzx plorb")).toEqual([]);
    expect(mapOccupation("Data Engineer", { minScore: 0.99 })).toEqual([{ code: "data-engineer", score: 1 }]);
  });
});
