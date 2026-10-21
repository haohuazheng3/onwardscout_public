import { describe, expect, it } from "vitest";
import { renderConfirmation, renderForm, SANDBOX_FIELD_ORDER, validateSubmission } from "@/app/sandbox/form/render";
import { detectBlockers, forbiddenPlatform, hostAllowed, jsOnlyFormHost } from "@/lib/channels/detect";
import {
  buildFormEntries,
  formToRequirements,
  multipartBody,
  parseHtmlForms,
  pickMainForm,
  questionsOf,
  readResponse,
  urlencodedBody,
  type Entry,
} from "@/lib/channels/html-form";
import type { LoadedFile } from "@/lib/channels/types";

/*
 * Our own sandbox form (/sandbox/form) is the plain-HTML target CH2 must handle perfectly:
 * parse it like a third-party form, build the submission, and let the sandbox's own validator
 * accept it — all offline.
 */
const BASE = "https://onwardscout.com/sandbox/form?app=app_k3v9q2m8t7";
const APP = "app_k3v9q2m8t7";

const ANSWERS: Record<string, string> = {
  full_name: "Amara Okafor",
  email: "amara@example.com",
  phone: "+44 20 7946 0958",
  location: "Lagos, Nigeria",
  profile_url: "https://amara.example.com",
  motivation: "I want to grow the repair café network I started into a program other cities can copy.",
  proud_project: "I built an inventory tool for 14 repair cafés; volunteers now log 300 repairs a month with it.",
  availability: "Within 2 weeks",
  consent: "yes",
};

function toFormData(entries: Entry[]): FormData {
  const fd = new FormData();
  for (const [n, v] of entries) {
    if (typeof v === "string") fd.append(n, v);
    else fd.append(n, new File([v.bytes as BlobPart], v.filename, { type: v.contentType }));
  }
  return fd;
}

describe("parsing the sandbox form", () => {
  const forms = parseHtmlForms(renderForm({ applicationId: APP }), BASE);
  const form = pickMainForm(forms)!;

  it("finds the one form with its action, method and encoding", () => {
    expect(forms).toHaveLength(1);
    expect(form.action).toBe("https://onwardscout.com/sandbox/form");
    expect(form.hasAction).toBe(true);
    expect(form.method).toBe("POST");
    expect(form.enctype).toBe("multipart/form-data");
    expect(form.hidden).toEqual([["application_id", APP]]);
    expect(form.submitLabel).toBe("Submit application");
  });

  it("reads every field in order with labels, types and required flags", () => {
    expect(form.fields.map((f) => f.name)).toEqual(SANDBOX_FIELD_ORDER);
    const by = Object.fromEntries(form.fields.map((f) => [f.name, f]));
    expect(by.full_name).toMatchObject({ label: "Full name", type: "text", required: true, maxLength: 120 });
    expect(by.email).toMatchObject({ type: "email", required: true });
    expect(by.phone).toMatchObject({ label: "Phone", type: "tel", required: false });
    expect(by.phone.help).toMatch(/country code/);
    expect(by.profile_url).toMatchObject({ label: "LinkedIn or portfolio URL", type: "url", required: false });
    expect(by.resume).toMatchObject({ type: "file", required: true });
    expect(by.resume.accept).toContain(".pdf");
    expect(by.motivation).toMatchObject({ type: "textarea", required: true, maxLength: 3000, section: "Your answers" });
    expect(by.availability.type).toBe("select");
    expect(by.availability.options?.map((o) => o.value)).toEqual(["immediately", "2-weeks", "1-month", "1-3-months", "later"]);
    expect(by.consent).toMatchObject({ type: "checkbox", required: true, checkedValue: "yes" });
  });

  it("produces requirements: semantic keys, the consent box as the person's, long answers as questions", () => {
    const req = formToRequirements(form);
    const by = Object.fromEntries(req.map((f) => [f.name, f]));
    expect(by.full_name).toMatchObject({ key: "full_name", profilePath: "/identity/name" });
    expect(by.email).toMatchObject({ key: "email", profilePath: "/identity/email" });
    expect(by.consent.userOnly).toBe(true);
    expect(by.motivation.question).toBe(true);
    expect(by.proud_project.question).toBe(true);
    expect(by.availability.options).toEqual(["Immediately", "Within 2 weeks", "Within a month", "In 1 to 3 months", "Later than 3 months"]);
    const qs = questionsOf(req);
    expect(qs.map((q) => q.id)).toEqual(["motivation", "proud_project"]);
    expect(qs[0].maxWords).toBeGreaterThan(100);
  });
});

describe("building a submission the sandbox accepts", () => {
  const form = pickMainForm(parseHtmlForms(renderForm({ applicationId: APP }), BASE))!;
  const resume: LoadedFile = { field: "resume", filename: "Amara-Okafor.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4\n% practice résumé\n") };

  it("maps choice labels to option values and ticks the consent box only with the person's yes", () => {
    const built = buildFormEntries(form, ANSWERS, [resume]);
    expect(built.missing).toEqual([]);
    const map = new Map(built.entries.map(([n, v]) => [n, v]));
    expect(map.get("application_id")).toBe(APP);
    expect(map.get("availability")).toBe("2-weeks");
    expect(map.get("consent")).toBe("yes");
    expect(typeof map.get("resume")).toBe("object");
    const noConsent = buildFormEntries(form, { ...ANSWERS, consent: "" }, [resume]);
    expect(noConsent.missing).toEqual([expect.stringMatching(/^I confirm that the information/)]);
  });

  it("is accepted by the sandbox's own validator (multipart with the résumé)", async () => {
    const built = buildFormEntries(form, ANSWERS, [resume]);
    const result = validateSubmission(toFormData(built.entries));
    expect(result.ok).toBe(true);
    const { body, contentType } = await multipartBody(built.entries);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    const text = new TextDecoder().decode(body);
    expect(text).toContain('name="resume"; filename="Amara-Okafor.pdf"');
    expect(text).toContain("Amara Okafor");
  });

  it("is accepted urlencoded too (no file), and reports what is missing", () => {
    const built = buildFormEntries(form, ANSWERS, []);
    expect(built.missing).toEqual(["Résumé / CV"]);
    const body = urlencodedBody(built.entries);
    const fd = new FormData();
    for (const [k, v] of new URLSearchParams(body)) fd.append(k, v);
    expect(validateSubmission(fd, { requireFile: false }).ok).toBe(true);
  });

  it("refuses answers longer than the form allows and choices that don't exist", () => {
    const built = buildFormEntries(form, { ...ANSWERS, full_name: "x".repeat(121), availability: "next decade" }, [resume]);
    expect(built.tooLong).toEqual(["Full name"]);
    expect(built.unmatched).toEqual(["When could you start?"]);
  });
});

describe("reading the response page", () => {
  it("finds the sandbox confirmation reference", () => {
    const r = readResponse(renderConfirmation({ ref: "SBX-7KQ2M9", name: "Amara Okafor", email: "amara@example.com" }), SANDBOX_FIELD_ORDER);
    expect(r).toMatchObject({ confirmed: true, ref: "SBX-7KQ2M9", formAgain: false });
    expect(r.confirmationText).toMatch(/^Application received/);
  });

  it("recognises a rejected submission (the form again, with errors)", () => {
    const page = renderForm({ values: { full_name: "A" }, errors: { full_name: "Enter your full name.", email: "Enter your email address." } });
    const r = readResponse(page, SANDBOX_FIELD_ORDER);
    expect(r.confirmed).toBe(false);
    expect(r.formAgain).toBe(true);
    expect(r.errors.join(" ")).toMatch(/Enter your full name/);
  });

  it("reads a generic confirmation with a reference number", () => {
    const r = readResponse("<html><body><h1>Thank you for applying</h1><p>Your confirmation number is AB-20391.</p></body></html>");
    expect(r).toMatchObject({ confirmed: true, ref: "AB-20391" });
  });
});

describe("what blocks automation", () => {
  it("finds no blocker on the sandbox", () => {
    expect(detectBlockers(renderForm())).toEqual({ captcha: false, login: false, payment: false, markers: [] });
  });

  it("detects CAPTCHA markers", () => {
    expect(detectBlockers('<div class="g-recaptcha" data-sitekey="x"></div>').captcha).toBe(true);
    expect(detectBlockers('<script src="https://www.google.com/recaptcha/api.js"></script>').markers).toContain("recaptcha");
    expect(detectBlockers('<div class="h-captcha" data-sitekey="y"></div>').markers).toEqual(expect.arrayContaining(["h-captcha", "data-sitekey"]));
    expect(detectBlockers('<div class="cf-turnstile"></div>').markers).toContain("cf-turnstile");
    expect(detectBlockers('<script>window.__appData = {"recaptchaPublicSiteKey":"z"}</script>').captcha).toBe(true);
  });

  it("detects login and payment fields", () => {
    expect(detectBlockers('<form><input type="password" name="pw"></form>').login).toBe(true);
    expect(detectBlockers('<input autocomplete="cc-number" name="n">').payment).toBe(true);
    expect(detectBlockers('<script src="https://js.stripe.com/v3"></script>').payment).toBe(true);
  });

  it("treats forms without an action as JavaScript-driven", () => {
    const form = pickMainForm(parseHtmlForms('<form id="apply"><label for="n">Name</label><input id="n" name="n" required><textarea name="why" aria-label="Why us?"></textarea></form>', "https://example.org/apply"))!;
    expect(form.hasAction).toBe(false);
    expect(form.fields.map((f) => [f.name, f.label, f.required])).toEqual([
      ["n", "Name", true],
      ["why", "Why us?", false],
    ]);
  });

  it("reads radio groups, checkbox groups and question text outside <label>", () => {
    const html = `<form action="/apply" method="post">
      <fieldset><legend>Track *</legend><label><input type="radio" name="track" value="a" required> Design</label><label><input type="radio" name="track" value="b"> Engineering</label></fieldset>
      <div class="q"><div class="text">Interests</div><ul><li><label><input type="checkbox" name="i[]" value="ai"> AI</label></li><li><label><input type="checkbox" name="i[]" value="climate"> Climate</label></li></ul></div>
      <div class="field"><span class="label">Company name</span><input name="company"></div>
      <button>Apply</button></form>`;
    const form = pickMainForm(parseHtmlForms(html, "https://example.org/x"))!;
    expect(form.action).toBe("https://example.org/apply");
    const [track, interests, company] = form.fields;
    expect(track).toMatchObject({ name: "track", label: "Track", type: "select", required: true, options: [{ value: "a", label: "Design" }, { value: "b", label: "Engineering" }] });
    expect(interests).toMatchObject({ name: "i[]", label: "Interests", type: "multiselect" });
    expect(company).toMatchObject({ name: "company", label: "Company name" });
    const built = buildFormEntries(form, { track: "Engineering", "i[]": "AI; Climate", company: "Kite" }, []);
    expect(built.entries).toEqual([
      ["track", "b"],
      ["i[]", "ai"],
      ["i[]", "climate"],
      ["company", "Kite"],
    ]);
  });

  it("prefers the application form over a search box", () => {
    const html = `<form role="search" action="/s"><input name="q"></form><form action="/apply" method="post"><input name="email" type="email"><textarea name="why"></textarea></form>`;
    expect(pickMainForm(parseHtmlForms(html, "https://example.org/"))?.action).toBe("https://example.org/apply");
  });
});

describe("platform rules", () => {
  it("never automates platforms that forbid it", () => {
    expect(forbiddenPlatform("https://www.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(forbiddenPlatform("https://acme.wd5.myworkdayjobs.com/x")).toBe("workday");
    expect(forbiddenPlatform("https://www.commonapp.org/")).toBe("common_app");
    expect(forbiddenPlatform("https://openreview.net/group?id=x")).toBe("openreview");
    expect(forbiddenPlatform("https://www.grants.gov/x")).toBe("government");
    expect(forbiddenPlatform("https://www.zhipin.com/job_detail/x")).toBe("boss");
    expect(forbiddenPlatform("https://example.org/apply", "linkedin")).toBe("linkedin");
    expect(forbiddenPlatform("https://onwardscout.com/sandbox/form")).toBeNull();
    expect(forbiddenPlatform("https://evangel.co/apply")).toBeNull();
  });
  it("knows JavaScript-only form builders and the host allow-list", () => {
    expect(jsOnlyFormHost("https://acme.typeform.com/to/abc")).toBe("typeform");
    expect(jsOnlyFormHost("https://tally.so/r/abc")).toBe("tally");
    expect(jsOnlyFormHost("https://form.jotform.com/123")).toBe("jotform");
    expect(jsOnlyFormHost("https://example.org/form")).toBeNull();
    expect(hostAllowed("https://job-boards.greenhouse.io/x", "job-boards.greenhouse.io")).toBe(true);
    expect(hostAllowed("https://evil.example/x", "job-boards.greenhouse.io")).toBe(false);
    expect(hostAllowed("https://a.b.example.org/x", "example.org")).toBe(true);
    expect(hostAllowed("https://notexample.org/x", "example.org")).toBe(false);
  });
});
