import { describe, expect, it } from "vitest";
import { applyInfoSchema } from "@/lib/core/types";
import { buildHandoff, buildMailtoHandoff, displayValue, splitMulti } from "@/lib/channels/handoff";
import { handoffReason, resolveChannelId, withNote } from "@/lib/channels/select";
import type { FieldRequirement, Requirements } from "@/lib/channels/types";

const apply = (over: Partial<Parameters<typeof applyInfoSchema.parse>[0]> = {}) => applyInfoSchema.parse({ channel: "CH6", ...over });

const OPP = {
  name: "Spring 2027 cohort",
  orgName: "Northlight Accelerator",
  url: "https://northlight.example/program",
  apply: apply({ url: "https://apply.northlight.example/form", requiresAccount: true }),
  deadline: new Date("2027-01-15T23:59:00Z"),
  rolling: false,
};

const FIELDS: FieldRequirement[] = [
  { name: "company", label: "Company name", type: "text", required: true },
  { name: "stage", label: "Stage", type: "select", required: true, options: ["Idea", "Pre-seed", "Seed"], choices: [{ value: "1", label: "Idea" }, { value: "2", label: "Pre-seed" }, { value: "3", label: "Seed" }] },
  { name: "deck", label: "Pitch deck", type: "file", required: true },
  { name: "problem", label: "What problem are you solving?", type: "textarea", required: true, question: true },
  { name: "gender", label: "Gender (optional)", type: "select", required: false, userOnly: true, options: ["Woman", "Man", "Non-binary"] },
  { name: "traction", label: "Traction", type: "text", required: true },
  { name: "terms", label: "I agree to the program terms", type: "checkbox", required: true, userOnly: true },
];

const REQ: Requirements = { channel: "CH6", fields: FIELDS, materials: ["pitch_deck"], questions: [], requiresAccount: true, requiresPayment: true, captchaLikely: true, notes: ["The form saves drafts for 7 days."] };

describe("buildHandoff", () => {
  const h = buildHandoff(OPP, REQ, { company: "Kite", stage: "2", problem: "Small freight shippers lose 18% of loads to paperwork errors.".repeat(3) }, [{ field: "deck", filename: "Kite-deck.pdf", generatedDocumentId: "gen_9" }]);

  it("links to the exact application page", () => {
    expect(h.url).toBe("https://apply.northlight.example/form");
  });

  it("keeps the form's order, shows choice labels and marks long answers", () => {
    expect(h.fields).toEqual([
      { label: "Company name", value: "Kite" },
      { label: "Stage", value: "Pre-seed" },
      { label: "What problem are you solving?", value: expect.any(String), long: true },
    ]);
  });

  it("lists files to download, and numbered steps for account, files, CAPTCHA, payment, the person's own answers and gaps", () => {
    expect(h.files).toEqual([{ name: "Kite-deck.pdf", generatedDocumentId: "gen_9" }]);
    const text = h.steps.map((s) => s.text);
    expect(h.steps.map((s) => s.n)).toEqual(text.map((_, i) => i + 1));
    expect(text[0]).toMatch(/Northlight Accelerator — Spring 2027 cohort on apply\.northlight\.example/);
    expect(text.some((t) => /Sign in or create your account/.test(t))).toBe(true);
    expect(text.some((t) => /Attach Kite-deck\.pdf/.test(t))).toBe(true);
    expect(text.some((t) => /CAPTCHA/.test(t))).toBe(true);
    expect(text.some((t) => /Pay the application fee/.test(t))).toBe(true);
    expect(text.some((t) => /Answer these yourself.*Gender.*I agree to the program terms/.test(t))).toBe(true);
    expect(text.some((t) => /We don't have an answer for: Traction/.test(t))).toBe(true);
    expect(text[text.length - 1]).toMatch(/I submitted it/);
  });

  it("adds honest notes: deadline, the requirement's own notes", () => {
    expect(h.notes).toContain("Deadline: 2027-01-15. Check the official page for the time zone.");
    expect(h.notes).toContain("The form saves drafts for 7 days.");
  });

  it("explains forbidden platforms and quotes organiser instructions as data", () => {
    const li = buildHandoff({ ...OPP, apply: apply({ url: "https://www.linkedin.com/jobs/view/42", instructions: "Apply with your LinkedIn profile." }), deadline: null, rolling: true }, { ...REQ, requiresAccount: false, requiresPayment: false, captchaLikely: false, notes: [] }, {}, []);
    expect(li.notes[0]).toMatch(/LinkedIn does not allow automated submissions/);
    expect(li.notes).toContain("Rolling admissions: earlier applications are usually read first.");
    expect(li.notes).toContain("The organiser says: “Apply with your LinkedIn profile.”");
  });

  it("speaks Chinese when asked", () => {
    const zh = buildHandoff(OPP, REQ, { company: "Kite" }, [], "zh");
    expect(zh.steps[0].text).toMatch(/打开「Northlight Accelerator · Spring 2027 cohort」的官方申请页面/);
    expect(zh.steps[zh.steps.length - 1].text).toMatch(/我已提交/);
  });

  it("uses document steps for CH5", () => {
    const docs = buildHandoff(OPP, { ...REQ, channel: "CH5", fields: [] }, {}, [{ field: "cv", filename: "CV.pdf", generatedDocumentId: "gen_1" }]);
    expect(docs.steps.map((s) => s.text)).toEqual([expect.stringMatching(/Download the documents/), expect.stringMatching(/I used them/)]);
  });

  it("adds a leading note once", () => {
    const once = withNote(h, "Automatic form filling is switched off right now.");
    expect(withNote(once, "Automatic form filling is switched off right now.").notes.filter((n) => /switched off/.test(n))).toHaveLength(1);
    expect(once.notes[0]).toMatch(/switched off/);
  });
});

describe("mailto handoff", () => {
  it("prefills recipient, subject and body (encoded) and shows them as copyable fields", () => {
    const h = buildMailtoHandoff({ to: "partner@fund.example", subject: "Kite — pre-seed & climate logistics", body: "Hi Sam,\nKite cuts freight paperwork errors.\n\nMei" }, []);
    expect(h.url).toBe(
      `mailto:partner@fund.example?subject=${encodeURIComponent("Kite — pre-seed & climate logistics")}&body=${encodeURIComponent("Hi Sam,\nKite cuts freight paperwork errors.\n\nMei")}`,
    );
    expect(h.fields.map((f) => f.label)).toEqual(["To", "Subject", "Message"]);
    expect(h.fields[2].long).toBe(true);
    expect(h.steps).toHaveLength(3);
  });
});

describe("display values", () => {
  it("shows labels for choice values, multi-selects and ticks", () => {
    expect(displayValue({ type: "select", choices: [{ value: "749879740", label: "Yes" }] }, "749879740")).toBe("Yes");
    expect(displayValue({ type: "select", choices: [{ value: "1", label: "Yes" }] }, "Maybe")).toBe("Maybe");
    expect(displayValue({ type: "multiselect", choices: [{ value: "ai", label: "AI" }, { value: "c", label: "Climate" }] }, '["ai","c"]')).toBe("AI, Climate");
    expect(displayValue({ type: "checkbox" }, "yes")).toBe("✓");
    expect(displayValue({ type: "checkbox" }, "no")).toBe("");
    expect(splitMulti("AI; Climate\nHealth")).toEqual(["AI", "Climate", "Health"]);
  });
});

describe("channel routing", () => {
  const opp = (type: string, a: Parameters<typeof apply>[0], url: string | null = null) => ({ type, url, apply: apply(a) });

  it("always hands off platforms that forbid automation", () => {
    expect(resolveChannelId(opp("job", { channel: "CH3", url: "https://www.linkedin.com/jobs/view/1" }))).toBe("CH6");
    expect(resolveChannelId(opp("job", { channel: "CH1", url: "https://acme.wd1.myworkdayjobs.com/en-US/x" }))).toBe("CH6");
    expect(resolveChannelId(opp("degree_program", { channel: "CH2", url: "https://apply.commonapp.org/" }))).toBe("CH6");
  });

  it("uses CH1 for recognisable ATS postings and the browser otherwise", () => {
    expect(resolveChannelId(opp("job", { channel: "CH1", url: "https://job-boards.greenhouse.io/figma/jobs/1" }))).toBe("CH1");
    expect(resolveChannelId(opp("job", { channel: "CH1", ats: { provider: "lever", board: "x", postingId: "y" } }))).toBe("CH1");
    expect(resolveChannelId(opp("job", { channel: "CH1", url: "https://careers.acme.example/apply/1" }))).toBe("CH3");
    expect(resolveChannelId(opp("job", { channel: "CH1" }))).toBe("CH6");
  });

  it("sends JavaScript-only form builders to the browser, and link-less forms to the handoff", () => {
    expect(resolveChannelId(opp("accelerator", { channel: "CH2", url: "https://acme.typeform.com/to/x" }))).toBe("CH3");
    expect(resolveChannelId(opp("accelerator", { channel: "CH2", url: "https://docs.google.com/forms/d/e/x/viewform" }))).toBe("CH2");
    expect(resolveChannelId(opp("accelerator", { channel: "CH2" }))).toBe("CH6");
  });

  it("keeps email, documents and the practice sandbox on their channels", () => {
    expect(resolveChannelId(opp("investor", { channel: "CH4", email: "hello@fund.example" }))).toBe("CH4");
    expect(resolveChannelId(opp("visa_pathway", { channel: "CH5" }))).toBe("CH5");
    expect(resolveChannelId(opp("practice", { channel: "CH2", url: "https://onwardscout.com/sandbox/form" }))).toBe("CH2");
  });

  it("names why a handoff needs the person", () => {
    expect(handoffReason(opp("job", { url: "https://www.linkedin.com/jobs/view/1" }))).toBe("blocked");
    expect(handoffReason(opp("grant", { url: "https://portal.example/apply", requiresAccount: true }))).toBe("login");
    expect(handoffReason(opp("grant", { url: "https://portal.example/apply", requiresPayment: true }))).toBe("payment");
    expect(handoffReason(opp("grant", { url: "https://portal.example/apply", captchaLikely: true }))).toBe("captcha");
    expect(handoffReason(opp("grant", { url: "https://portal.example/apply" }))).toBe("unsupported");
  });
});
