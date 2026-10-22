import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateTool, type CheckerTool } from "@/content/tools/types";
import { limitVerdicts, paragraphCount, runChecker } from "@/components/tools/Checker";

// The tool views import the consent banner (next-intl navigation) and next/link; only pure functions are tested here.
vi.mock("@/components/Consent", () => ({ track: () => {} }));
vi.mock("next/link", () => ({ default: () => null }));

/* Regression tests for the checker engine (length verdicts, paragraph count) and the rules of the
 * three checker tools: cover letter length checker, Common App word counter, supplemental essay decoder. */

const p = "I led the analytics work that cut our weekly report run time from four hours to twenty minutes.";

describe("checker character limit", () => {
  const limits = [{ measure: "characters" as const, label: "Portal box", max: 2000 }];
  it("counts every line break, as the portal's text box does", () => {
    const para = (n: number) => "abcde fghij ".repeat(60).slice(0, n - 1) + ".";
    const letter = [para(500), para(500), para(500), para(495)].join("\n\n");
    expect(letter.length).toBe(2001);
    const v = limitVerdicts(limits, letter)[0];
    expect(v.value).toBe(2001);
    expect(v.state).toBe("over");
    expect(v.text).toBe("1 characters over (up to 2,000 characters).");
    expect(limitVerdicts(limits, "a\nb")[0].value).toBe(3);
  });
});

describe("checker paragraph count", () => {
  it("keeps the blank-line and one-line-per-paragraph cases", () => {
    const q = "I am applying for the analyst role at your company.";
    expect(paragraphCount(`Dear Ms. Patel,\n\n${q}\n\n${q}\n\nBest,\nSam`)).toBe(2);
    expect(paragraphCount(`Dear Ms. Patel,\n${q}\n${q}\n${q}\nBest,\nSam`)).toBe(3);
  });

  it("splits single line breaks after a sentence even when the letter also has a blank line", () => {
    expect(paragraphCount("Dear Ms. Lopez,\n\n" + [p, p, p, p].join("\n") + "\nSincerely,\nJane Doe")).toBe(4);
  });

  it("does not count every hard-wrapped line of text pasted from a PDF", () => {
    const pdf =
      "Dear Ms. Lopez,\nI was excited to see the Data Analyst opening at Northwind Health because\nyour work on hospital readmissions is the problem I have spent two years on.\n" +
      "At Contoso Clinic I cleaned claims data from three systems, wrote the SQL\nbehind our weekly readmission report, and cut its run time from four hours\nto twenty minutes. Follow-up calls to the patients it flagged lowered\nthirty-day readmissions by 9 percent last quarter.\n" +
      "I would welcome the chance to talk about how I could help your team.\nThank you for your time and consideration.\nSincerely,\nJane Doe";
    expect(paragraphCount(pdf)).toBe(4);
  });

  it("keeps list items in one paragraph, with or without periods", () => {
    const intro = "Your posting asks for three things, and I have done each of them at Contoso Clinic:";
    const close = "I would welcome the chance to show you the dashboards and talk about your team.";
    const items = ["Cleaned claims data from three hospital systems.", "Wrote the SQL behind our weekly readmission report.", "Cut the report's run time from four hours to twenty minutes.", "Trained two analysts on the new pipeline."];
    expect(paragraphCount([intro, items.map((i) => `- ${i}`).join("\n"), close].join("\n\n"))).toBe(3);
    expect(paragraphCount([intro, items.map((i) => `• ${i}`).join("\n"), close].join("\n\n"))).toBe(3);
    expect(paragraphCount([intro, items.map((i, n) => `${n + 1}. ${i}`).join("\n"), close].join("\n\n"))).toBe(3);
    expect(paragraphCount([intro, items.map((i) => `- ${i.replace(/\.$/, "")}`).join("\n"), close].join("\n\n"))).toBe(3);
    expect(paragraphCount([intro, ...items.map((i) => `- ${i}`), close].join("\n"))).toBe(2);
  });

  it("handles Windows line breaks, closing quotes and paragraphs without final punctuation", () => {
    expect(paragraphCount(["Dear Ms. Lopez,", p, p, p, "Best,", "Jane"].join("\r\n"))).toBe(3);
    const quoted = "My manager called it \"the report that finally runs on time.\"";
    expect(paragraphCount([quoted, quoted, quoted].join("\n"))).toBe(3);
    const bare = p.replace(/\.$/, "");
    expect(paragraphCount([bare, bare, bare].join("\n\n"))).toBe(3);
  });

  it("does not count letterhead, address or signature blocks", () => {
    const head = "Jane Doe\n123 Main Street, Springfield, IL 62701\njane.doe@example.com | (555) 123-4567\nOctober 22, 2026";
    const to = "Maria Lopez\nAnalytics Manager\nNorthwind Health\n500 Market Street, San Francisco, CA 94105";
    expect(paragraphCount([head, to, "Dear Ms. Lopez,", p, p, p, p, "Sincerely,\nJane Doe"].join("\n\n"))).toBe(4);
    const headAbbrev = "Jane Doe\n123 Main St.\nSpringfield, IL 62701\nOct. 22, 2026";
    const toAbbrev = "Maria Lopez\nNorthwind Health Inc.\n500 Market St., Suite 4\nSan Francisco, CA 94105";
    expect(paragraphCount([headAbbrev, toAbbrev, "Dear Ms. Lopez,", p, p, p, p, "Sincerely,\nJane Doe"].join("\n\n"))).toBe(4);
    const signature = "Jane Doe\nSenior Data Analyst, Contoso Clinic\njane.doe@example.com\n(555) 123-4567\nlinkedin.com/in/janedoe";
    expect(paragraphCount(["Dear Ms. Lopez,", p, p, p, "Sincerely,", signature].join("\n\n"))).toBe(3);
    const singleLines = [head, to, "Dear Ms. Lopez,", p, p, p, p, "Sincerely,", "Jane Doe"].join("\n");
    expect(paragraphCount(singleLines)).toBe(4);
  });
});

/* ---------------------------------------------------------------- tool rules */

const dir = path.join(process.cwd(), "content", "tools");
const hasTools = fs.existsSync(path.join(dir, "cover-letter-length-checker.json"));
const load = (id: string) => validateTool(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")), `${id}.json`) as CheckerTool;
const hits = (tool: CheckerTool, text: string) => runChecker(tool, text).map((f) => [f.rule, f.match]);
const rules = (tool: CheckerTool, text: string) => [...new Set(runChecker(tool, text).map((f) => f.rule))];

describe.skipIf(!hasTools)("cover letter length checker rules", () => {
  const cl = hasTools ? load("cover-letter-length-checker") : (null as never);
  const has = (text: string, rule: string) => rules(cl, text).includes(rule);

  it("flags every form of Dear Sir or Madam, but not a named Sir or Madam", () => {
    for (const t of ["Dear Sir/Madam,\n\nI led the migration.", "Dear Sir / Madam,", "Dear Sir,", "Dear Madam,", "Dear Sirs,", "Dear Madam or Sir,", "Dear Sir and Madam:", "Dear Sir/Madam:", "Dear Sir or Madam\n\nI led the migration.", "Dear Sir or Madam", "dear sir or madam,"]) {
      expect(has(t, "dear-sir"), t).toBe(true);
    }
    for (const t of ["Dear Sir Patrick,", "Dear Madam Chair,", "Dear Ms. Lopez,"]) expect(has(t, "dear-sir"), t).toBe(false);
  });

  it("flags curly-brace, angle-bracket and capitalised placeholders as fatal", () => {
    for (const t of ["I am excited to apply to {Company} for the role.", "for the {Position} role", "a role at {{company}}.", "a role at {{ company_name }}.", "at {Company Name}", "at <Company>", "at <Company Name>", "I am excited to apply to COMPANY NAME.", "Dear [Hiring Manager Name],"]) {
      const f = runChecker(cl, t).find((x) => x.rule === "placeholder");
      expect(f?.severity, t).toBe("fatal");
    }
  });

  it("does not flag code, links, email addresses or quotation marks as placeholders", () => {
    for (const t of ["I rebuilt the <div> layout.", "a vector<int> of scores", "List<String> and Map<K, V> in Java", "std::map<string, int>", "see <https://janedoe.dev>", "the API returns {\"ok\": true}", "Jane Doe <jane@example.com>", "if x < 3 and y > 4", "as she put it, \"we [...] shipped it\"", "\"it's [sic] fine\"", "\"it's [Sic] fine\"", "\"one [. . .] two\"", "\"one […] two\""]) {
      expect(has(t, "placeholder"), t).toBe(false);
    }
  });

  it("flags overused adjectives with or without hyphens, and great fit only as a phrase", () => {
    expect(hits(cl, "a hard working, detail oriented self starter and team-player").filter(([r]) => r === "passionate").map(([, m]) => m)).toEqual(["hard working", "detail oriented", "self starter", "team-player"]);
    expect(has("Peloton great fitness content kept me going.", "great-fit")).toBe(false);
    for (const t of ["I would be a great fit.", "a great candidate", "the perfect candidates"]) expect(has(t, "great-fit"), t).toBe(true);
  });

  it("says in the paragraph note that address blocks are not counted", () => {
    expect(cl.limits?.find((l) => l.measure === "paragraphs")?.note).toMatch(/address block/);
  });
});

describe.skipIf(!hasTools)("Common App word counter rules", () => {
  const ca = hasTools ? load("common-app-word-counter") : (null as never);
  it("does not flag quotation ellipses or [sic] in any case", () => {
    expect(runChecker(ca, "Thoreau wrote that most men \"lead lives of quiet desperation [...] and go to the grave with the song still in them.\" [Sic]")).toEqual([]);
    for (const t of ["[. . .]", "[SIC]", "[sic]", "[…]"]) expect(rules(ca, t), t).toEqual([]);
  });
  it("still flags leftover school placeholders", () => {
    for (const t of ["I can't wait to join [College Name].", "At [School Name] I will"]) expect(rules(ca, t), t).toEqual(["placeholder"]);
  });
});

describe.skipIf(!hasTools)("supplemental essay decoder rules", () => {
  const d = hasTools ? load("supplemental-essay-decoder") : (null as never);

  it("reads UChicago's Why UChicago prompt as a why us essay", () => {
    const t = "How does the University of Chicago, as you know it now, satisfy your desire for a particular kind of learning, community, and future? Please address with some specificity your own wishes and how they relate to UChicago.";
    expect(rules(d, t)).toEqual(["why-us", "community"]);
    expect(rules(d, "How does the college you are applying to fit your goals?")).toEqual(["why-us"]);
  });

  it("does not read the adjective major as a major essay", () => {
    const brown = "Brown students care deeply about their work and the world around them. Students find contentment, satisfaction, and meaning in daily interactions and major discoveries. Whether big or small, mundane or spectacular, tell us about something that brings you joy. (200-250 words)";
    expect(rules(d, brown)).toEqual([]);
    for (const t of ["Tell us about a major challenge.", "Describe a major event in your life.", "Describe a major life event.", "In what major way have you grown?", "Describe a major project you led."]) expect(rules(d, t), t).not.toContain("major");
    for (const t of ["What is your intended major, and why?", "Why this major?", "What major do you want to pursue?", "Which majors interest you?"]) expect(rules(d, t), t).toContain("major");
  });

  it("reads studying, areas of study and academic interests as a major essay", () => {
    expect(rules(d, "Why are you interested in studying computer science? (250 words)")).toEqual(["major"]);
    expect(rules(d, "What attracts you to your preferred areas of study at Columbia College or Columbia Engineering? (150 words or fewer)")).toEqual(["why-us", "major"]);
    expect(rules(d, "Considering the specific undergraduate school you have selected, describe how you intend to explore your academic and intellectual interests at the University of Pennsylvania. (150-200 words)")).toEqual(["major", "intellectual"]);
    expect(rules(d, "Why are you interested in attending Columbia University?")).toEqual(["why-us"]);
    expect(rules(d, "Why are you interested in majoring in economics at our university?").sort()).toEqual(["major", "why-us"]);
  });

  it("reads a parenthesised short word limit as a short answer", () => {
    for (const t of ["What inspires you? (35 words or fewer)", "What is the most significant challenge that society faces today? (50 words)", "What brings you joy? (50 words)", "Describe yourself. (up to 10 words)"]) expect(rules(d, t), t).toContain("short");
    for (const t of ["Tell us about yourself. (100-150 words)", "Tell us about yourself. (150 words)", "Tell us about yourself. (200-250 words)", "Tell us about yourself. (250 words)"]) expect(rules(d, t), t).not.toContain("short");
  });
  it("review fixes: hard-wrapped letters, why-us studying prompts, code in letters, Sir or Madam, great fits", () => {
    const cl = load("cover-letter-length-checker");
    const d = load("supplemental-essay-decoder");
    expect(rules(d, "Why are you interested in studying at Columbia?")).toContain("why-us");
    expect(rules(d, "Why are you interested in studying computer science?")).toEqual(["major"]);
    expect(rules(d, "What activity are you most interested in pursuing in college?")).not.toContain("major");
    expect(rules(cl, "I rebuilt our <DataTable> component in React and wrapped it in <Suspense>. Our JS used `${userId}` too.")).not.toContain("placeholder");
    expect(rules(cl, "Dear <Company Name> team, I am applying.")).toContain("placeholder");
    expect(rules(cl, "Dear Sir or Madam.\nI am applying.")).toContain("dear-sir");
    expect(rules(cl, "We would be great fits for each other.")).toContain("great-fit");
  });
  it("counts a hard-wrapped letter with blank lines between paragraphs by its blank lines", () => {
    const t = "Dear Ms. Lopez,\n\nI was excited to see the Data Analyst opening at Northwind Health. Your\nwork on hospital readmissions is the problem I have spent two years on.\nI would like to bring that experience to your team.\n\nAt Contoso Clinic I cleaned claims data from three systems. I wrote the\nSQL behind our weekly readmission report and cut its run time from four\nhours to twenty minutes. Follow-up calls to the patients it flagged\nlowered thirty-day readmissions by 9 percent last quarter. The care team\nnow uses it every Monday.\n\nBefore that, I spent a year as a research assistant in a public health\nlab. I built the survey pipeline for a study of 2,000 patients. I also\ntaught two interns to use R. Both now work as analysts.\n\nI would welcome the chance to talk about how I could help your team.\nThank you for your time and consideration.\n\nSincerely,\nJane Doe";
    expect(paragraphCount(t)).toBe(4);
    const t0 = Date.now();
    paragraphCount(")".repeat(50000) + "\nx");
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
