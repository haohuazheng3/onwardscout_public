import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateTool, type BriefTool, type GeneratorTool } from "@/content/tools/types";
import { FILTERS, renderTemplate, splitLines, tidy } from "@/components/tools/templating";
import { briefMissing } from "@/components/tools/Brief";
import { initialValues, templateValues } from "@/components/tools/shared";

// The tool views import the consent banner (next-intl navigation) and next/link; only pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* Regressions for the template engine: words that start with a period, years in list lines,
 * ellipses, acronyms under uncap and the article filter, résumé verbs, and cleared numbers in briefs. */

describe("tidy keeps a period that starts a word", () => {
  it("does not glue .NET or .5 onto the word before", () => {
    expect(renderTemplate("Tools: {{s}}.", { s: "A/B testing, C#, .NET, SQL Server" }).text).toBe("Tools: A/B testing, C#, .NET, SQL Server.");
    expect(tidy("C# · .NET · Azure AD")).toBe("C# · .NET · Azure AD");
    expect(tidy("Braze, .NET and Go")).toBe("Braze, .NET and Go");
    expect(tidy("raised my GPA by .5 points")).toBe("raised my GPA by .5 points");
  });
  it("still removes the space before ordinary punctuation", () => {
    expect(tidy("Request: . Next")).toBe("Request:. Next");
    expect(tidy("I led it .")).toBe("I led it.");
    expect(tidy("one , two ; three !")).toBe("one, two; three!");
  });
});

describe("tidy keeps an ellipsis", () => {
  it("leaves three periods alone and folds four or more into three", () => {
    expect(tidy("2024 And Then..., Delaware Contemporary")).toBe("2024 And Then..., Delaware Contemporary");
    expect(tidy('Smith, J. "Walls That Remember..." BmoreArt')).toBe('Smith, J. "Walls That Remember..." BmoreArt');
    expect(renderTemplate("My work starts from one question: {{q}}", { q: "What does a place remember... after its people leave?" }).text).toBe(
      "My work starts from one question: What does a place remember... after its people leave?",
    );
    expect(renderTemplate("Show: {{t}}.", { t: "And Then..." }).text).toBe("Show: And Then...");
    expect(tidy("wait.... what")).toBe("wait... what");
  });
  it("still collapses doubled marks", () => {
    expect(tidy("work in the U.S..")).toBe("work in the U.S.");
    expect(tidy("tools, etc..")).toBe("tools, etc.");
    expect(tidy("Acme Co..")).toBe("Acme Co.");
    expect(tidy("a,, b!! c??")).toBe("a, b! c?");
  });
});

describe("splitLines list markers", () => {
  it("keeps a year followed by a period", () => {
    expect(splitLines("2019. MFA, Maryland Institute College of Art\n2015. BA, Oberlin College")).toEqual(["2019. MFA, Maryland Institute College of Art", "2015. BA, Oberlin College"]);
    expect(FILTERS.bullets("2019. MFA, Maryland Institute College of Art")).toBe("- 2019. MFA, Maryland Institute College of Art");
    expect(splitLines("100. Centennial show\n3.5 GPA")).toEqual(["100. Centennial show", "3.5 GPA"]);
  });
  it("removes numbering and the bullets people paste from Word or Docs", () => {
    expect(splitLines("1. one\n2) two\n10. ten\n12. twelve")).toEqual(["one", "two", "ten", "twelve"]);
    expect(splitLines("– 2020 Open Studios\n— dash\n•four\n◦ five\n· six\n- seven\n* eight")).toEqual(["2020 Open Studios", "dash", "four", "five", "six", "seven", "eight"]);
    expect(splitLines("-5% churn")).toEqual(["-5% churn"]);
  });
});

describe("uncap", () => {
  it("keeps acronyms that look like common first words", () => {
    for (const s of ["IT leaders in healthcare", "OR nurse at Mercy", "A/B testing", "AT&T", "A-level results", "A+ student", "A&R scout", "US-based teams"]) expect(FILTERS.uncap(s)).toBe(s);
    expect(renderTemplate("3+ years in {{s|uncap}}.", { s: "IT infrastructure for hospitals" }).text).toBe("3+ years in IT infrastructure for hospitals.");
  });
  it("still lowers ordinary first words and keeps names", () => {
    expect(FILTERS.uncap("A senior engineer")).toBe("a senior engineer");
    expect(FILTERS.uncap("At my last job")).toBe("at my last job");
    expect(FILTERS.uncap("I'm a designer")).toBe("I'm a designer");
    expect(FILTERS.uncap("SEO lead")).toBe("SEO lead");
    expect(FILTERS.uncap("McKinsey alumni")).toBe("McKinsey alumni");
    expect(FILTERS.uncap("Python projects")).toBe("Python projects");
  });
  it("lowers résumé verbs pasted with a capital, but not names that end in -ed", () => {
    expect(FILTERS.uncap("Co-founded Fieldline in 2021")).toBe("co-founded Fieldline in 2021");
    expect(FILTERS.uncap("Cofounded Fieldline")).toBe("cofounded Fieldline");
    for (const w of ["Joined", "Spearheaded", "Coached", "Hired", "Advised", "Sold", "Held", "Kept", "Sent", "Got", "Hosted", "Supported", "Became", "Took", "Gave", "Migrated"]) {
      expect(FILTERS.uncap(`${w} the team`)).toBe(`${w.toLowerCase()} the team`);
    }
    for (const s of ["Wired readers", "Ahmed and I", "Mohammed Ali Clinic", "Co-op board", "Coinbase", "Berlin", "Tweed Courthouse"]) expect(FILTERS.uncap(s)).toBe(s);
    expect(renderTemplate("{{n}} {{a|uncap|phrase}}. Earlier, {{n}} {{b|uncap|phrase}}.", { n: "Dana", a: "Co-founded Fieldline in 2021", b: "Spearheaded the EHR integration" }).text).toBe(
      "Dana co-founded Fieldline in 2021. Earlier, Dana spearheaded the EHR integration.",
    );
  });
});

describe("a picks the article for acronyms with / & -", () => {
  it("reads them letter by letter", () => {
    const cases: [string, string][] = [
      ["UI/UX designer", "a UI/UX designer"],
      ["FP&A role", "an FP&A role"],
      ["M&A", "an M&A"],
      ["R&D engineer", "an R&D engineer"],
      ["US-based fintech", "a US-based fintech"],
      ["UK-based charity", "a UK-based charity"],
      ["HR-focused role", "an HR-focused role"],
      ["UX-focused team", "a UX-focused team"],
      ["F-1 student", "an F-1 student"],
      ["H-1B holder", "an H-1B holder"],
    ];
    for (const [s, want] of cases) expect(FILTERS.a(s)).toBe(want);
  });
  it("keeps the cases that were already right", () => {
    const cases: [string, string][] = [
      ["MBA", "an MBA"],
      ["8-week course", "an 8-week course"],
      ["SaaS company", "a SaaS company"],
      ["A/B test", "an A/B test"],
      ["T-shirt brand", "a T-shirt brand"],
      ["LED", "an LED"],
      ["USB", "a USB"],
      ["AI-driven product", "an AI-driven product"],
      ["PhD", "a PhD"],
      ["operations manager", "an operations manager"],
      ["product designer", "a product designer"],
    ];
    for (const [s, want] of cases) expect(FILTERS.a(s)).toBe(want);
  });
});

const dir = path.join(process.cwd(), "content", "tools");
const load = (id: string) => validateTool(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")), id);

describe("briefMissing", () => {
  const tool = validateTool(
    {
      id: "test-brief",
      kind: "brief",
      title: "Test brief",
      lede: "A brief for the tests.",
      inputs: [
        { id: "project", type: "text", label: "Project", required: true },
        { id: "budget", type: "number", label: "Amount requested", default: 25000 },
        { id: "start", type: "date", label: "Start date" },
        { id: "extra", type: "number", label: "Unused number" },
        { id: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
      ],
      sections: [
        { heading: "Budget", template: "Request: {{budget|usd}}." },
        { heading: "Timeline", template: "Starts {{start}}.", when: { input: "mode", is: "b" } },
      ],
    },
    "test-brief",
  ) as BriefTool;
  const labels = (values: Record<string, unknown>) => briefMissing(tool, { ...initialValues(tool.inputs), project: "Reading club", ...values } as never).map((i) => i.label);

  it("flags a cleared number that a section uses", () => {
    expect(labels({ budget: null })).toEqual(["Amount requested"]);
    expect(labels({ budget: Number.NaN })).toEqual(["Amount requested"]);
  });
  it("accepts zero and the default, and ignores numbers or dates no shown section uses", () => {
    expect(labels({})).toEqual([]);
    expect(labels({ budget: 0 })).toEqual([]);
    expect(labels({ start: null })).toEqual([]);
    expect(labels({ mode: "b", start: null })).toEqual(["Start date"]);
  });
  it("still lists empty required text first", () => {
    expect(labels({ project: "", budget: null })).toEqual(["Project", "Amount requested"]);
  });
  it.skipIf(!fs.existsSync(dir))("covers the grant proposal builder's amount", () => {
    const grant = load("grant-proposal-builder") as BriefTool;
    const values = initialValues(grant.inputs);
    expect(briefMissing(grant, { ...values, budget: null }).map((i) => i.label)).toContain("Amount requested");
    expect(briefMissing(grant, values).map((i) => i.label)).not.toContain("Amount requested");
  });
});

describe.skipIf(!fs.existsSync(dir))("elevator pitch proof and more", () => {
  const tool = load("elevator-pitch-generator") as GeneratorTool;
  const templates = tool.variants.flatMap((g) => g.templates);
  const render = (values: Record<string, unknown>) =>
    templates.map((t) => renderTemplate(t, templateValues(tool.inputs, { ...initialValues(tool.inputs), name: "Maya", identity: "a data analyst", ask: "analytics roles", more: "", ...values } as never), { seed: 7 }).text);

  it("ends a proof that starts with $, a digit or a small letter before the next sentence", () => {
    expect(templates.some((t) => /\{\{\s*(?:proof|more)\s*\}\}/.test(t))).toBe(false);
    const founder = render({ proof: "$40k MRR from 14 pharmacies, growing 30% a month" });
    expect(founder.some((t) => t.includes("growing 30% a month. "))).toBe(true);
    expect(founder.join("\n")).not.toMatch(/a month [A-Z]/);
    const event = render({ proof: "12% fewer cancellations after I rebuilt our churn dashboard" });
    expect(event.join("\n")).not.toMatch(/dashboard [A-Z]/);
    expect(render({ proof: "cut cancellations 12%", more: "interviewed 30 customers first" }).join("\n")).not.toMatch(/12% [A-Za-z]|first [A-Z]/);
  });
  it("adds no stray marks when the value already ends a sentence or more is empty", () => {
    for (const proof of ["I cut cancellations by 12%.", "Did you know we tripled signups?", "We tripled signups!"]) {
      for (const text of render({ proof })) expect(text).not.toMatch(/[.!?]\.|\s\.|  /);
    }
  });
  it("review fixes: word-like acronyms, domain names, a sentence before a lower-case brand", () => {
    expect(FILTERS.a("HIPAA-compliant clinic")).toBe("a HIPAA-compliant clinic");
    expect(FILTERS.a("SENIOR-LEVEL engineer")).toBe("a SENIOR-LEVEL engineer");
    expect(FILTERS.a("FP&A role")).toBe("an FP&A role");
    expect(FILTERS.uncap("Hired.com recruiter")).toBe("Hired.com recruiter");
    expect(renderTemplate("First: {{proof|cap|sentence}} {{more|cap|sentence}} Right now.", { proof: "I cut churn 12%", more: "iOS installs doubled after that" }).text).toBe("First: I cut churn 12%. iOS installs doubled after that. Right now.");
  });
});
