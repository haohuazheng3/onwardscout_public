import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fieldKey, localMapFormFields, localPlanBrowserStep, parseAxTree, pickOption } from "@/lib/llm/local/forms";
import { localExtractProfile } from "@/lib/llm/local/extract";
import type { FactRef } from "@/lib/llm/types";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const out = localExtractProfile({ documents: [{ id: "doc_en", kind: "resume", filename: "r.txt", text: fx("resume-en.txt") }], locale: "en", now: "2026-10-21" });
const facts: FactRef[] = out.facts.map((f, i) => ({ id: `fct_${i}`, path: f.path, claim: f.claim, value: f.value, confidence: f.confidence }));

/** The fields of our own sandbox form (/sandbox/form). */
const SANDBOX_FIELDS = [
  { name: "full_name", label: "Full name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "location", label: "Where are you based?", type: "text" },
  { name: "portfolio_url", label: "Portfolio or website", type: "url" },
  { name: "resume", label: "Résumé (PDF)", type: "file", required: true },
  { name: "why_this", label: "Why do you want to join this practice program?", type: "textarea", required: true },
  { name: "proud_project", label: "Tell us about a project you're proud of", type: "textarea" },
  { name: "availability", label: "When could you start?", type: "select", options: ["Immediately", "Within a month", "In 1–3 months", "Later"] },
  { name: "consent", label: "I agree to the privacy policy", type: "checkbox", required: true },
];

describe("mapFormFields on the sandbox form", () => {
  const answers = { why_this: "I want to see the whole flow end to end before applying for real.", proud_project: "Pocket Pantry, a meal-planning app for food banks.", availability: "Within a month" };
  const mapped = localMapFormFields({ fields: SANDBOX_FIELDS, profile: out.profile, facts, answers, documents: [{ id: "gen_resume1", kind: "resume_variant", filename: "Avery-Quinn-resume.pdf" }], language: "en" });
  const by = Object.fromEntries(mapped.map((m) => [m.name, m]));

  it("fills identity fields from facts, citing them", () => {
    expect(by.full_name).toMatchObject({ value: "Avery Quinn", source: "profile", key: "full_name", needsUser: false });
    expect(by.full_name.factIds).toEqual([facts.find((f) => f.path === "/identity/name")!.id]);
    expect(by.email).toMatchObject({ value: "avery.quinn@example.com", source: "profile" });
    expect(by.phone).toMatchObject({ value: "(512) 555-0142" });
    expect(by.location).toMatchObject({ value: "Austin, TX", key: "location" });
    expect(by.portfolio_url).toMatchObject({ value: "https://averyquinn.example.com", key: "portfolio_url" });
  });

  it("attaches the prepared résumé document to the file field", () => {
    expect(by.resume).toMatchObject({ value: "gen_resume1", source: "document", key: "resume" });
  });

  it("uses prepared answers for open questions and picks select option values", () => {
    expect(by.why_this).toMatchObject({ value: answers.why_this, source: "answer", factIds: ["answer:why_this"] });
    expect(by.proud_project).toMatchObject({ value: answers.proud_project, source: "answer" });
    expect(by.availability).toMatchObject({ value: "Within a month", key: "availability" });
  });

  it("never ticks consent: that is the person's own tap", () => {
    expect(by.consent).toMatchObject({ value: null, source: "user", key: "consent", needsUser: true });
  });

  it("flags required fields it can't fill", () => {
    const m = localMapFormFields({ fields: SANDBOX_FIELDS, profile: out.profile, facts, language: "en" });
    const b = Object.fromEntries(m.map((x) => [x.name, x]));
    expect(b.why_this).toMatchObject({ value: null, needsUser: true });
    expect(b.resume).toMatchObject({ value: null, needsUser: true });
  });
});

describe("field recognition", () => {
  it.each([
    [{ name: "applicant_given_name", label: "First name" }, "first_name"],
    [{ name: "q12", label: "姓名" }, "full_name"],
    [{ name: "q13", label: "手机号码" }, "phone"],
    [{ name: "linkedin", label: "LinkedIn profile" }, "linkedin_url"],
    [{ name: "eeo_gender", label: "Gender" }, "eeo"],
    [{ name: "vet", label: "Are you a protected veteran?" }, "eeo"],
    [{ name: "sponsor", label: "Will you now or in the future require visa sponsorship?" }, "sponsorship"],
    [{ name: "auth", label: "Are you legally authorized to work in the United States?" }, "work_authorization"],
    [{ name: "sig", label: "Electronic signature" }, "signature"],
  ])("%o → %s", (field, key) => {
    expect(fieldKey({ ...field, placeholder: null })?.key).toBe(key);
  });

  it("picks options by value, label or yes/no meaning", () => {
    const opts = [{ value: "y", label: "Yes" }, { value: "n", label: "No" }];
    expect(pickOption(opts, "Yes")).toBe("y");
    expect(pickOption(opts, "true")).toBe("y");
    expect(pickOption(["Within a month", "Later"], "within a month")).toBe("Within a month");
    expect(pickOption(["A", "B"], "Z")).toBeNull();
  });
});

describe("planBrowserStep (local)", () => {
  const ax = (lines: string[]) => lines.join("\n");
  const values = { "Full name": "Avery Quinn", Email: "avery.quinn@example.com", "When could you start?": "Within a month" };

  it("parses Playwright aria snapshots", () => {
    const nodes = parseAxTree(ax(['- heading "Apply" [level=1]', '- textbox "Full name": Avery', '- checkbox "I agree" [checked]', '- button "Submit"']));
    expect(nodes.map((n) => [n.role, n.name, n.value])).toEqual([
      ["heading", "Apply", null],
      ["textbox", "Full name", "Avery"],
      ["checkbox", "I agree", null],
      ["button", "Submit", null],
    ]);
    expect(nodes[2].attrs).toContain("checked");
  });

  it("fills empty fields in order with prepared values", () => {
    const step = localPlanBrowserStep({ goal: "Fill the practice form", pageSummary: "Practice application", axTree: ax(['- textbox "Full name"', '- textbox "Email"', '- button "Submit application"']), values });
    expect(step).toMatchObject({ action: "fill", target: 'textbox "Full name"', value: "Avery Quinn", done: false, needsUser: false });
  });

  it("skips fields already holding the right value and selects options", () => {
    const step = localPlanBrowserStep({ goal: "g", pageSummary: "", axTree: ax(['- textbox "Full name": Avery Quinn', '- textbox "Email": avery.quinn@example.com', '- combobox "When could you start?"', '- button "Submit"']), values });
    expect(step).toMatchObject({ action: "select", target: 'combobox "When could you start?"', value: "Within a month" });
  });

  it("does not submit without the person's confirmation", () => {
    const step = localPlanBrowserStep({ goal: "g", pageSummary: "", axTree: ax(['- textbox "Full name": Avery Quinn', '- checkbox "I agree to the privacy policy"', '- button "Submit"']), values });
    expect(step).toMatchObject({ action: "stop", done: true, needsUser: false });
    const allowed = localPlanBrowserStep({ goal: "g", pageSummary: "", axTree: ax(['- textbox "Full name": Avery Quinn', '- button "Submit"']), values, allowSubmit: true });
    expect(allowed).toMatchObject({ action: "submit", target: 'button "Submit"' });
  });

  it("never ticks a consent box itself", () => {
    const step = localPlanBrowserStep({ goal: "g", pageSummary: "", axTree: ax(['- checkbox "I agree to the privacy policy"', '- button "Submit"']), values: { "I agree to the privacy policy": "yes" }, allowSubmit: false });
    expect(step.action).not.toBe("check");
  });

  it("hands CAPTCHAs, logins and payments to the person", () => {
    expect(localPlanBrowserStep({ goal: "g", pageSummary: "Please verify you are human", axTree: ax(['- iframe "reCAPTCHA"']), values })).toMatchObject({ action: "stop", needsUser: true });
    expect(localPlanBrowserStep({ goal: "g", pageSummary: "Sign in", axTree: ax(['- textbox "Email"', '- textbox "Password"', '- button "Sign in"']), values })).toMatchObject({ action: "stop", needsUser: true });
    expect(localPlanBrowserStep({ goal: "g", pageSummary: "Checkout", axTree: ax(['- textbox "Card number"', '- button "Pay"']), values })).toMatchObject({ action: "stop", needsUser: true });
  });

  it("stops when the page leaves the application host", () => {
    const step = localPlanBrowserStep({ goal: "g", pageSummary: "", axTree: ax(['- textbox "Full name"']), values, allowedHost: "apply.example.org", currentUrl: "https://evil.example.net/form" });
    expect(step).toMatchObject({ action: "stop", needsUser: true });
  });

  it("recognises the confirmation page after submitting", () => {
    const step = localPlanBrowserStep({ goal: "g", pageSummary: "Thank you for applying! Your application has been received. Reference SBX-4821", axTree: ax(['- heading "Thank you"']), values, history: [{ action: "submit", target: 'button "Submit"', ok: true }], allowSubmit: true });
    expect(step).toMatchObject({ action: "stop", done: true, needsUser: false });
  });
});
