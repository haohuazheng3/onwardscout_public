import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  CHANNEL_IDS,
  FUNCTIONS,
  FUNCTION_IDS,
  GOAL_FAMILIES,
  GOAL_FAMILY_DEFS,
  GOAL_MATRIX,
  IDENTITIES,
  IDENTITY_CODES,
  IDENTITY_GROUPS,
  IDENTITY_GROUP_DEFS,
  INDUSTRIES,
  INDUSTRY_TREE,
  MATERIALS,
  MATERIAL_IDS,
  OPPORTUNITY_GROUP_LABELS,
  OPPORTUNITY_GROUPS,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_IDS,
  PLAYBOOKS,
  SECOND_LEVEL_INDUSTRIES,
  SUB_GOALS,
  SUB_GOAL_IDS,
  TOP_LEVEL_INDUSTRIES,
  USER_IDENTITY_GROUPS,
  audienceIncludes,
  buildMilestones,
  channelChain,
  channelDefSchema,
  computeMilestoneTarget,
  defaultGoalsFor,
  defaultSubGoalsFor,
  evaluateSwitchRules,
  expandAudience,
  functionDefSchema,
  getPlaybook,
  goalFamilyDefSchema,
  hasCjk,
  identityDefSchema,
  identityGroupDefSchema,
  industryDefSchema,
  intensityFromTime,
  isIdentityCode,
  isMinor,
  mapFunction,
  mapGoalText,
  mapIndustry,
  matchIdentityCues,
  materialDefSchema,
  nextFollowUpAt,
  opportunityTypeBySlug,
  opportunityTypeDefSchema,
  opportunityTypesOfFamily,
  outreachAllowed,
  playbookSchema,
  resolvePlaybook,
  stagesFor,
  subGoalAppliesTo,
  subGoalDefSchema,
  subGoalPlacement,
  subGoalsOf,
  topLevelIndustry,
  type Bilingual,
  type GoalFamily,
  type PipelineStats,
} from "@/lib/core";

function expectBilingual(label: Bilingual, where: string) {
  expect(label.en.trim(), `${where} en`).not.toBe("");
  expect(label.zh.trim(), `${where} zh`).not.toBe("");
  expect(hasCjk(label.zh), `${where} zh should be Chinese: ${label.zh}`).toBe(true);
}

function lucideExists(name: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), "node_modules/lucide-react/dist/esm/icons", `${name}.mjs`));
}

const EMPTY_STATS: PipelineStats = { sent: 0, submitted: 0, replies: 0, interviews: 0, meetings: 0, offers: 0, rejections: 0 };

/* ================================================================== identities */

describe("identities (plan §2)", () => {
  it("has the 8 groups and every code of the plan, in order", () => {
    expect(IDENTITY_GROUP_DEFS.map((g) => g.id)).toEqual([...IDENTITY_GROUPS]);
    const perGroup = Object.fromEntries(IDENTITY_GROUPS.map((g) => [g, IDENTITIES.filter((d) => d.group === g).length]));
    expect(perGroup).toEqual({ S: 7, E: 8, F: 8, R: 6, C: 9, P: 7, T: 8, I: 7 });
    expect(IDENTITIES.map((d) => d.code)).toEqual([...IDENTITY_CODES]);
    expect(new Set(IDENTITIES.map((d) => d.code)).size).toBe(IDENTITIES.length);
    for (const d of IDENTITIES) expect(d.code.startsWith(d.group)).toBe(true);
  });

  it("validates with zod and is fully bilingual", () => {
    for (const g of IDENTITY_GROUP_DEFS) {
      identityGroupDefSchema.parse(g);
      expectBilingual(g.label, g.id);
      expectBilingual(g.description, `${g.id} description`);
      for (const s of g.stages) expectBilingual(s.label, `${g.id} stage ${s.id}`);
    }
    for (const d of IDENTITIES) {
      identityDefSchema.parse(d);
      expectBilingual(d.label, d.code);
      expect(d.cues.en.length).toBeGreaterThan(0);
      expect(d.cues.zh.every(hasCjk) || d.cues.zh.some(hasCjk)).toBe(true);
    }
  });

  it("gives every code at least two unique stage options", () => {
    for (const code of IDENTITY_CODES) {
      const stages = stagesFor(code);
      expect(stages.length, code).toBeGreaterThanOrEqual(2);
      expect(new Set(stages.map((s) => s.id)).size, code).toBe(stages.length);
      for (const s of stages) expectBilingual(s.label, `${code} ${s.id}`);
    }
    expect(stagesFor("S1").map((s) => s.id)).toEqual(["lower_grades", "grade_11", "grade_12"]);
    expect(stagesFor("F2").map((s) => s.id)).toContain("seed");
  });

  it("treats S1 as a minor without outreach", () => {
    expect(isMinor(["S1"])).toBe(true);
    expect(isMinor(["S2", "C6"])).toBe(false);
    expect(outreachAllowed(["S1", "C4"])).toBe(false);
    expect(outreachAllowed(["E2", "F5"])).toBe(true);
    expect(isIdentityCode("E2")).toBe(true);
    expect(isIdentityCode("E9")).toBe(false);
  });

  it("matches audiences and expands them", () => {
    expect(audienceIncludes(["ALL"], ["T2"])).toBe(true);
    expect(audienceIncludes(["ALL"], ["I1"])).toBe(false);
    expect(audienceIncludes(["E2", "E3"], ["E3"])).toBe(true);
    expect(audienceIncludes(["E2", "E3"], ["E1"])).toBe(false);
    expect(audienceIncludes(["S"], ["S6"])).toBe(true);
    expect(expandAudience(["S5", "P"])).toEqual(["S5", "P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    expect(expandAudience(["ALL"])).toHaveLength(53);
  });

  it("infers identity cues from English and Chinese documents", () => {
    const phd = matchIdentityCues("PhD candidate in Computer Science, dissertation on robot learning. Previously research fellow.");
    expect(phd.map((m) => m.code)).toContain("S4");
    expect(phd[0].hits.length).toBeGreaterThan(0);
    expect(matchIdentityCues("本科在读，大三，计算机专业，预计毕业 2027 年")[0].code).toBe("S2");
    expect(matchIdentityCues("联合创始人兼 CEO，已完成天使轮和种子轮融资").map((m) => m.code)).toContain("F2");
    expect(matchIdentityCues("Angel investor and general partner at a venture capital fund").some((m) => m.code.startsWith("I"))).toBe(false);
    expect(matchIdentityCues("Angel investor and general partner at a venture capital fund", { includeSupplySide: true })[0].code).toBe("I1");
    expect(matchIdentityCues("")).toEqual([]);
  });
});

/* ================================================================== industries & functions */

describe("industries (plan §3)", () => {
  it("has 20 top-level industries and the plan's second-level fields", () => {
    expect(TOP_LEVEL_INDUSTRIES).toHaveLength(20);
    expect(INDUSTRY_TREE.map((t) => t.children.length)).toEqual([10, 6, 6, 6, 6, 7, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5, 6, 6, 6, 4]);
    expect(SECOND_LEVEL_INDUSTRIES).toHaveLength(123);
    expect(INDUSTRIES).toHaveLength(143);
  });

  it("has unique, valid, bilingual codes with existing parents", () => {
    expect(new Set(INDUSTRIES.map((i) => i.code)).size).toBe(INDUSTRIES.length);
    const tops = new Set(TOP_LEVEL_INDUSTRIES.map((t) => t.code));
    for (const i of INDUSTRIES) {
      industryDefSchema.parse(i);
      expectBilingual(i.label, i.code);
      expect(i.keywords.length, i.code).toBeGreaterThan(0);
      if (i.parent) {
        expect(tops.has(i.parent), i.code).toBe(true);
        expect(i.code.startsWith(`${i.parent}.`)).toBe(true);
      }
    }
    expect(topLevelIndustry("finance.banking")).toBe("finance");
    expect(topLevelIndustry("finance")).toBe("finance");
  });

  it("maps free text to industries", () => {
    expect(mapIndustry("We build SaaS for enterprise finance teams").map((m) => m.code)).toContain("software-internet.saas");
    expect(mapIndustry("新能源汽车")[0].code).toBe("advanced-manufacturing.automotive-ev");
    expect(mapIndustry("医疗器械")[0].code).toBe("life-sciences-healthcare.medical-devices");
  });
});

describe("functions (plan §3)", () => {
  it("has the 21 functions, bilingual and valid", () => {
    expect(FUNCTIONS.map((f) => f.id)).toEqual([...FUNCTION_IDS]);
    expect(FUNCTIONS).toHaveLength(21);
    for (const f of FUNCTIONS) {
      functionDefSchema.parse(f);
      expectBilingual(f.label, f.id);
    }
  });

  it("maps text to functions", () => {
    expect(mapFunction("人力资源")[0].code).toBe("people");
    expect(mapFunction("Customer success")[0].code).toBe("customer-success");
  });
});

/* ================================================================== opportunity types, channels, materials */

describe("opportunity types", () => {
  const required = [
    "job", "internship", "remote_job", "part_time", "graduate_program", "public_sector_exam", "returnship", "investor", "accelerator",
    "incubator", "startup_competition", "exhibition", "pitch_event", "grant", "government_program", "fellowship", "scholarship",
    "exchange_program", "conference_cfp", "journal", "phd_position", "postdoc", "visiting_scholar", "residency", "open_call",
    "brand_partnership", "freelance_project", "speaking", "media", "podcast", "award", "community", "volunteer", "ngo_job", "course",
    "certification", "mentorship", "hackathon", "practice",
  ];

  it("covers every required type exactly once, in the declared order", () => {
    expect(OPPORTUNITY_TYPES.length).toBeGreaterThanOrEqual(22);
    expect(OPPORTUNITY_TYPES.map((t) => t.id)).toEqual([...OPPORTUNITY_TYPE_IDS]);
    for (const id of required) expect(OPPORTUNITY_TYPE_IDS as readonly string[]).toContain(id);
  });

  it("validates, has unique slugs, real icons and bilingual labels", () => {
    expect(new Set(OPPORTUNITY_TYPES.map((t) => t.slug)).size).toBe(OPPORTUNITY_TYPES.length);
    for (const t of OPPORTUNITY_TYPES) {
      opportunityTypeDefSchema.parse(t);
      expectBilingual(t.label, t.id);
      expectBilingual(t.plural, `${t.id} plural`);
      expectBilingual(t.description, `${t.id} description`);
      expect(lucideExists(t.icon), `${t.id} icon ${t.icon}`).toBe(true);
      expect(t.materials.length, t.id).toBeGreaterThan(0);
    }
    for (const g of OPPORTUNITY_GROUPS) expectBilingual(OPPORTUNITY_GROUP_LABELS[g], g);
  });

  it("keeps jobs and practice off the public SEO pages and curated programs on them", () => {
    for (const id of ["job", "internship", "remote_job", "part_time", "practice", "referral", "recruiter", "investor"]) {
      expect(OPPORTUNITY_TYPES.find((t) => t.id === id)?.publicSeo, id).toBe(false);
    }
    for (const id of ["accelerator", "incubator", "grant", "fellowship", "scholarship", "conference_cfp", "residency", "hackathon", "award"]) {
      expect(OPPORTUNITY_TYPES.find((t) => t.id === id)?.publicSeo, id).toBe(true);
    }
    expect(opportunityTypeBySlug("accelerators")?.id).toBe("accelerator");
    expect(opportunityTypeBySlug("jobs")).toBeNull();
    expect(opportunityTypeBySlug("jobs", { publicOnly: false })?.id).toBe("job");
    expect(opportunityTypeBySlug("nope")).toBeNull();
  });
});

describe("channels", () => {
  it("has CH1–CH7 with honest, valid metadata", () => {
    expect(CHANNELS.map((c) => c.id)).toEqual([...CHANNEL_IDS]);
    for (const c of CHANNELS) {
      channelDefSchema.parse(c);
      expectBilingual(c.label, c.id);
      expectBilingual(c.description, `${c.id} description`);
      expectBilingual(c.userAction, `${c.id} userAction`);
      expect(c.fallback).not.toContain(c.id);
    }
    expect(CHANNELS.filter((c) => c.outreach).map((c) => c.id)).toEqual(["CH4"]);
    expect(CHANNELS.find((c) => c.id === "CH7")?.status).toBe("planned");
    expect(CHANNELS.find((c) => c.id === "CH3")?.needsBrowser).toBe(true);
  });

  it("builds fallback chains that always end in a handoff", () => {
    expect(channelChain("CH1")).toEqual(["CH1", "CH3", "CH6"]);
    expect(channelChain("CH2")).toEqual(["CH2", "CH3", "CH6"]);
    expect(channelChain("CH4")).toEqual(["CH4", "CH6"]);
    expect(channelChain("CH4", { allowOutreach: false })).toEqual(["CH6"]);
    expect(channelChain("CH7")).toEqual(["CH2", "CH3", "CH6"]);
    expect(channelChain("CH5")).toEqual(["CH5", "CH6"]);
  });
});

describe("materials", () => {
  it("defines every material once, bilingual, with a document kind for platform drafts", () => {
    expect(MATERIALS.map((m) => m.id)).toEqual([...MATERIAL_IDS]);
    for (const m of MATERIALS) {
      materialDefSchema.parse(m);
      expectBilingual(m.label, m.id);
      if (m.producedBy === "platform") expect(m.generatedKind, m.id).not.toBeNull();
      if (m.producedBy === "user") expect(m.generatedKind, m.id).toBeNull();
    }
  });
});

/* ================================================================== goals */

describe("goals (plan §4)", () => {
  it("has 12 families and every sub-goal of the plan", () => {
    expect(GOAL_FAMILY_DEFS.map((f) => f.id)).toEqual([...GOAL_FAMILIES]);
    expect(SUB_GOALS.map((s) => s.id)).toEqual([...SUB_GOAL_IDS]);
    expect(GOAL_FAMILIES.map((f) => subGoalsOf(f).length)).toEqual([10, 9, 13, 9, 5, 7, 5, 4, 3, 3, 3, 1]);
    expect(SUB_GOALS).toHaveLength(72);
  });

  it("validates and references only existing types, channels, materials and identities", () => {
    for (const f of GOAL_FAMILY_DEFS) {
      goalFamilyDefSchema.parse(f);
      expectBilingual(f.label, f.id);
      expectBilingual(f.description, `${f.id} description`);
      expect(lucideExists(f.icon), `${f.id} icon`).toBe(true);
    }
    for (const s of SUB_GOALS) {
      subGoalDefSchema.parse(s);
      expectBilingual(s.label, s.id);
      expectBilingual(s.description, `${s.id} description`);
      expect(s.id.startsWith(`${s.family}.`)).toBe(true);
      for (const t of s.opportunityTypes) expect(OPPORTUNITY_TYPE_IDS as readonly string[]).toContain(t);
      if (s.id !== "G12.1") expect(s.opportunityTypes.length, s.id).toBeGreaterThan(0);
      for (const c of [s.defaultChannel, ...s.fallbackChannels]) expect(CHANNEL_IDS as readonly string[]).toContain(c);
      expect(s.fallbackChannels).not.toContain(s.defaultChannel);
      for (const m of s.materials) expect(MATERIAL_IDS as readonly string[]).toContain(m);
      expect(s.identities.length).toBeGreaterThan(0);
      for (const g of s.identities) expect(USER_IDENTITY_GROUPS as readonly string[]).toContain(g);
    }
  });

  it("uses every opportunity type (except practice) in at least one sub-goal", () => {
    const used = new Set(SUB_GOALS.flatMap((s) => s.opportunityTypes));
    expect(OPPORTUNITY_TYPE_IDS.filter((t) => t !== "practice" && !used.has(t))).toEqual([]);
    expect(used.has("practice")).toBe(false);
  });

  it("records the plan's automation levels conservatively", () => {
    const byId = Object.fromEntries(SUB_GOALS.map((s) => [s.id, s]));
    expect(byId["G1.1"].automation).toBe("high");
    expect(byId["G1.3"].automation).toBe("medium");
    expect(byId["G1.8"].automation).toBe("low");
    expect(byId["G2.1"].automation).toBe("docs");
    expect(byId["G3.3"].automation).toBe("low"); // plan: 低到中 → never overclaim
    expect(byId["G1.6"].audience).toEqual(["E2", "E3", "E4", "E5"]);
    expect(byId["G1.1"].identities).toEqual(["S", "E", "P", "T"]);
  });

  it("never offers an outreach-only sub-goal to a minor", () => {
    expect(subGoalAppliesTo("G7.3", ["S2"])).toBe(true);
    expect(subGoalAppliesTo("G7.3", ["S1"])).toBe(false);
    expect(subGoalAppliesTo("G1.2", ["S1"])).toBe(true);
    expect(subGoalAppliesTo("G1.6", ["E1"])).toBe(false);
    expect(subGoalAppliesTo("G1.6", ["E3"])).toBe(true);
  });

  it("maps a one-sentence goal to sub-goals", () => {
    expect(mapGoalText("I want to raise a seed round")[0].code).toBe("G3.2");
    expect(mapGoalText("想申请美国博士").map((m) => m.code)).toContain("G4.4");
    expect(mapGoalText("考公务员")[0].code).toBe("G1.8");
  });
});

/* ================================================================== matrix */

describe("identity × goal matrix (plan §5)", () => {
  const expected: Record<string, string> = {
    // G1..G12: P = primary, m = more, . = hidden
    S: "PmmmPmmPmPmm",
    E: "PPm.mmPmmPmm",
    F: "mmPm.mPmPPmm",
    R: "mmmPm.PPmPmm",
    C: "mmm..PPPmPmm",
    P: "PPmmm.PmmPmm",
    T: "PPm.mmmPPPmm",
    I: "............",
  };

  it("covers every group and family with the plan's values", () => {
    for (const g of IDENTITY_GROUPS) {
      const row = GOAL_FAMILIES.map((f) => {
        const v = GOAL_MATRIX[g][f];
        return v === "primary" ? "P" : v === "more" ? "m" : ".";
      }).join("");
      expect(row, g).toBe(expected[g]);
    }
  });

  it("computes default goals for a person with several identities", () => {
    expect(defaultGoalsFor(["S2"]).primary).toEqual(["G1", "G5", "G8", "G10"]);
    const both = defaultGoalsFor(["E2", "F5"]);
    expect(both.primary).toEqual(["G1", "G2", "G3", "G7", "G9", "G10"]);
    expect(both.hidden).toEqual([]);
    expect(defaultGoalsFor(["C1"]).hidden).toEqual(["G4", "G5"]);
    expect(defaultGoalsFor([])).toEqual({ primary: [], more: [...GOAL_FAMILIES], hidden: [] });
    expect(defaultGoalsFor(["I1"]).primary).toEqual([]);
  });

  it("pre-selects sub-goals that apply to the person", () => {
    const s1 = defaultSubGoalsFor(["S1"]).map((s) => s.id);
    expect(s1).toContain("G5.1");
    expect(s1).not.toContain("G1.1"); // experienced hire is not for students (only S5)
    const founder = defaultSubGoalsFor(["F2"]).map((s) => s.id);
    expect(founder).toContain("G3.2");
    expect(founder).not.toContain("G3.8"); // loans are for F6
    expect(subGoalPlacement("G4.1", ["S4"])).toBe("more");
    expect(subGoalPlacement("G4.1", ["R1"])).toBe("primary");
    expect(subGoalPlacement("G1.9", ["S2"])).toBeNull();
  });
});

/* ================================================================== playbooks */

describe("playbooks (plan §6)", () => {
  it("has one valid playbook per family whose types match the family's sub-goals", () => {
    expect(PLAYBOOKS.map((p) => p.family)).toEqual([...GOAL_FAMILIES]);
    for (const p of PLAYBOOKS) {
      playbookSchema.parse(p);
      expect(new Set(p.opportunityTypes).size, p.family).toBe(p.opportunityTypes.length);
      expect([...p.opportunityTypes].sort(), p.family).toEqual([...opportunityTypesOfFamily(p.family)].sort());
      expect(p.weeklyQuota.light).toBeLessThan(p.weeklyQuota.steady);
      expect(p.weeklyQuota.steady).toBeLessThan(p.weeklyQuota.intense);
      for (let i = 1; i < p.followUpDays.length; i++) expect(p.followUpDays[i]).toBeGreaterThan(p.followUpDays[i - 1]);
      const dues = p.milestones.map((m) => m.dueAt);
      expect([...dues].sort((a, b) => a - b)).toEqual(dues);
      expect(dues[dues.length - 1]).toBe(1);
      expect(new Set(p.milestones.map((m) => m.key)).size).toBe(p.milestones.length);
      for (const m of p.milestones) {
        expectBilingual(m.title, `${p.family} ${m.key}`);
        expect(m.title.en.includes("{target}")).toBe(m.title.zh.includes("{target}"));
      }
      expectBilingual(p.quotaUnit, `${p.family} quotaUnit`);
      for (const r of p.switchRules) {
        expectBilingual(r.suggest, r.id);
        for (const s of r.suggestSubGoals) expect(SUB_GOAL_IDS as readonly string[]).toContain(s);
      }
    }
    expect(new Set(PLAYBOOKS.flatMap((p) => p.switchRules.map((r) => r.id))).size).toBe(PLAYBOOKS.flatMap((p) => p.switchRules).length);
  });

  it("builds the plan's fundraising milestones", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const ms = buildMilestones("G3", { intensity: "steady", horizonMonths: 12, start });
    expect(ms.map((m) => m.target)).toEqual([1, 50, 10, 1]);
    expect(ms[1].title).toEqual({ en: "Reach 50 matched investors", zh: "触达 50 位匹配的投资人" });
    expect(ms.map((m) => m.position)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < ms.length; i++) expect(ms[i].dueAt.getTime()).toBeGreaterThan(ms[i - 1].dueAt.getTime());
    expect(ms[3].dueAt.toISOString().slice(0, 10)).toBe("2027-11-01");
  });

  it("computes quota-based targets from intensity and horizon", () => {
    const g1 = getPlaybook("G1");
    const apps = g1.milestones.find((m) => m.key === "applications")!;
    expect(computeMilestoneTarget(apps, { family: "G1", intensity: "steady", horizonMonths: 6 })).toBe(130);
    expect(computeMilestoneTarget(apps, { family: "G1", intensity: "light", horizonMonths: 3 })).toBe(33);
    const g4 = getPlaybook("G4").milestones.find((m) => m.key === "submissions")!;
    expect(computeMilestoneTarget(g4, { family: "G4", intensity: "intense", horizonMonths: 24 })).toBe(30); // capped
    expect(computeMilestoneTarget(g4, { family: "G4", intensity: "light", horizonMonths: 1 })).toBe(2); // floor of the min
  });

  it("switches strategy only after enough evidence", () => {
    const low = { ...EMPTY_STATS, sent: 30, replies: 1 };
    expect(evaluateSwitchRules("G3", low).map((r) => r.id)).toEqual(["g3-low-investor-reply"]);
    expect(evaluateSwitchRules("G3", { ...low, sent: 29 })).toEqual([]);
    expect(evaluateSwitchRules("G3", { ...low, replies: 2 })).toEqual([]);
    const rule = evaluateSwitchRules("G3", low)[0];
    expect(rule.suggestTypes).toEqual(["accelerator", "startup_competition"]);
    expect(evaluateSwitchRules("G1", { ...EMPTY_STATS, submitted: 20 }).map((r) => r.id)).toEqual(["g1-low-reply"]);
    expect(evaluateSwitchRules("G1", { ...EMPTY_STATS, submitted: 30, replies: 5 }).map((r) => r.id)).toEqual(["g1-no-interviews"]);
    expect(evaluateSwitchRules("G1", { ...EMPTY_STATS, submitted: 40, replies: 10, interviews: 6 }).map((r) => r.id)).toEqual(["g1-interviews-no-offer"]);
  });

  it("schedules follow-ups and resolves overrides", () => {
    const t0 = new Date("2026-10-01T09:00:00Z");
    const first = nextFollowUpAt("G1", t0, 0)!;
    expect(first.toISOString()).toBe("2026-10-08T09:00:00.000Z");
    expect(nextFollowUpAt("G1", first, 1)!.toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(nextFollowUpAt("G1", first, 2)).toBeNull();
    expect(intensityFromTime(null)).toBe("steady");
    expect(intensityFromTime(0.5)).toBe("light");
    expect(intensityFromTime(5)).toBe("intense");
    const r = resolvePlaybook("G3", { intensity: "intense", opportunityTypes: ["grant", "accelerator", "hackathon"] });
    expect(r.opportunityTypes).toEqual(["accelerator", "grant", "hackathon"]);
    expect(r.weeklyQuota).toBe(30);
    expect(resolvePlaybook("G1", { timePerWeek: 1 }).intensity).toBe("light");
    expect(resolvePlaybook("G12" as GoalFamily).opportunityTypes).toEqual([]);
  });
});
